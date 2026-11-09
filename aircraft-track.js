/* DEV451 server-recorded tracks. No session recorder, extrapolation or operational writes. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else {root.FFAPP_SERVER_TRACKS=factory(root);root.FFAPP_SERVER_TRACKS.attach();}
})(typeof window==='object'?window:globalThis,function(browser){
  'use strict';
  const SCHEMA='fisofid-aircraft-track-v1',GAP=120000,MAX_PAGE=10000,MAX_POINTS=100000,MAX_BYTES=2*1024*1024;
  const validHex=hex=>typeof hex==='string'&&/^~?[0-9a-f]{6}$/.test(hex);
  function validatePage(value,hex,now=Date.now()){
    if(!value||value.schema!==SCHEMA||value.hex!==hex||!validHex(hex)||!Array.isArray(value.points)||value.points.length>MAX_PAGE||typeof value.source!=='string'||!value.source.trim()||value.source.length>300||!Number.isSafeInteger(value.availableFrom)||!Number.isSafeInteger(value.availableTo)||value.availableFrom<0||value.availableFrom>value.availableTo||value.availableTo>now+300000)throw Error('Invalid aircraft history response');
    if(value.nextCursor!==null&&(typeof value.nextCursor!=='string'||!value.nextCursor.length||value.nextCursor.length>512||!/^[A-Za-z0-9_-]+$/.test(value.nextCursor)))throw Error('Invalid aircraft history cursor');
    if(value.nextCursor!==null&&!value.points.length)throw Error('Empty history page cannot continue');
    let previous=-1;const points=value.points.map(p=>{
      if(!p||!Number.isSafeInteger(p.t)||p.t<value.availableFrom||p.t>value.availableTo||p.t<=previous||!Number.isFinite(p.lat)||Math.abs(p.lat)>90||!Number.isFinite(p.lon)||Math.abs(p.lon)>180||['stale','legStart','conflictingPosition'].some(k=>p[k]!==undefined&&typeof p[k]!=='boolean')||p.track!=null&&(!Number.isFinite(p.track)||p.track<0||p.track>360)||p.alt!=null&&p.alt!=='GND'&&!Number.isFinite(p.alt))throw Error('Invalid recorded position');
      previous=p.t;return{t:p.t,lat:p.lat,lon:p.lon,alt:p.alt??null,track:p.track??null,stale:p.stale===true,legStart:p.legStart===true,conflictingPosition:p.conflictingPosition===true,callsign:typeof p.callsign==='string'?p.callsign.slice(0,16):null,aircraftType:typeof p.aircraftType==='string'?p.aircraftType.slice(0,16):null,squawk:typeof p.squawk==='string'&&/^[0-7]{4}$/.test(p.squawk)?p.squawk:null,heading:typeof p.heading==='number'&&Number.isFinite(p.heading)&&p.heading>=0&&p.heading<=360?p.heading:null,source:typeof p.source==='string'?p.source.slice(0,80):value.source,providerTimestampSeconds:Number.isFinite(p.providerTimestampSeconds)?p.providerTimestampSeconds:null,sourceUrl:typeof p.sourceUrl==='string'?p.sourceUrl.slice(0,2048):null};
    });
    return{schema:SCHEMA,hex,source:value.source,availableFrom:value.availableFrom,availableTo:value.availableTo,nextCursor:value.nextCursor,points};
  }
  function pointAt(points,time){
    let lo=0,hi=points.length-1,found=-1;while(lo<=hi){const m=(lo+hi)>>>1;if(points[m].t<=time){found=m;lo=m+1}else hi=m-1;}
    const p=points[found],next=points[found+1];
    if(!p||p.conflictingPosition||time-p.t>GAP)return null;
    // A known recording gap is empty, not a stationary or interpolated aircraft.
    if(time>p.t&&next&&(next.stale||next.legStart||next.t-p.t>GAP||Math.abs(next.lon-p.lon)>180))return null;
    return p;
  }
  function segments(points,until=Infinity){
    const lines=[];let line=[],prev=null;
    const end=()=>{if(line.length>1)lines.push(line);line=[]};
    for(const p of points){if(p.t>until)break;if(p.conflictingPosition){end();prev=null;continue}if(p.stale||p.legStart||prev&&(p.t-prev.t>GAP||Math.abs(p.lon-prev.lon)>180))end();line.push([p.lat,p.lon]);prev=p;}
    end();return lines;
  }
  async function boundedJson(response,signal){
    if(!/application\/json/i.test(response.headers.get('content-type')||''))throw Error('Aircraft history is not JSON');
    const reader=response.body?.getReader();if(!reader)throw Error('Streaming aircraft history unavailable');
    const chunks=[];let size=0;try{while(true){if(signal?.aborted)throw Error('Aircraft history cancelled');const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw Error('Aircraft history page too large');chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}return JSON.parse(new TextDecoder().decode(bytes));
  }
  async function fetchPage({hex,cursor,signal},{fetcher=browser?.fetch?.bind(browser),getToken=async()=>browser.firebase.auth().currentUser?.getIdToken()}={}){
    let tokenTimer;const token=await Promise.race([getToken(),new Promise((_,reject)=>{tokenTimer=setTimeout(()=>reject(Error('Aircraft history authentication timed out')),5000)})]).finally(()=>clearTimeout(tokenTimer));if(!token)throw Error('Sign in before loading aircraft history');
    const url='/.netlify/functions/aircraft-history?hex='+encodeURIComponent(hex)+(cursor?'&cursor='+encodeURIComponent(cursor):'');
    const response=await fetcher(url,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},cache:'no-store',credentials:'same-origin',redirect:'error',signal});
    if(!response.ok)throw Error(response.status===503?'Server aircraft history is not configured or unavailable':response.status===401||response.status===403?'Aircraft history authentication failed':'Aircraft history request failed (HTTP '+response.status+')');
    return boundedJson(response,signal);
  }
  function createController({loadPage=fetchPage,render=()=>{},yieldTask=()=>new Promise(r=>setTimeout(r,0)),now=Date.now,flightOnly=false}={}){
    let selected=null,points=[],time=null,state='idle',message='',source='',complete=false,sequence=0,pending=null,abort=null,lastAttempt=0;
    let geometryPoints=null,geometryCount=-1,geometryEnd=-2,geometryLines=[];
    function frame(){
      const cutoff=time===null?now():Math.min(time,now());
      let lo=0,hi=points.length;while(lo<hi){const m=(lo+hi)>>>1;if(points[m].t<=cutoff)lo=m+1;else hi=m;}
      if(points!==geometryPoints||points.length!==geometryCount||lo!==geometryEnd){
        geometryPoints=points;geometryCount=points.length;geometryEnd=lo;
        var start=0;if(flightOnly)for(var i=0;i<lo;i++)if(points[i].legStart)start=i;
        geometryLines=segments(flightOnly?points.slice(start):points,cutoff);
      }
      return{hex:selected,mode:time===null?'live':'history',time,points,lines:geometryLines,position:time===null?null:pointAt(points,time),state,message,source,complete}}
    function refresh(){const f=frame();render(f);return f}
    function select(hex,{force=false}={}){
      if(hex!==null&&!validHex(hex))return Promise.reject(Error('Invalid aircraft identity'));
      if(hex===selected&&(pending||!force&&(state==='ready'||state==='error')&&now()-lastAttempt<30000))return pending||Promise.resolve(refresh());
      abort?.abort();const id=++sequence;selected=hex;points=[];source='';complete=false;message='';state=hex?'loading':'idle';refresh();
      if(!hex){pending=null;return Promise.resolve(frame())}
      lastAttempt=now();abort=new AbortController();const signal=abort.signal;
      const timer=setTimeout(()=>abort?.signal===signal&&abort.abort(),20000);
      pending=(async()=>{
        const cursors=new Set();let cursor=null,bounds=null;
        do{
          const page=validatePage(await loadPage({hex,cursor,signal}),hex,now());
          if(signal.aborted||id!==sequence)return frame();
          const signature=JSON.stringify([page.source,page.availableFrom,page.availableTo]);if(bounds&&bounds!==signature)throw Error('Aircraft history changed during pagination; retry');bounds=signature;
          if(points.length&&page.points.length&&page.points[0].t<=points[points.length-1].t)throw Error('Aircraft history pages overlap or are out of order');
          if(points.length+page.points.length>MAX_POINTS)throw Error('Aircraft history exceeds display limit; available track is incomplete');
          points.push(...page.points);source=page.source;cursor=page.nextCursor;
          if(cursor&&cursors.has(cursor))throw Error('Aircraft history pagination repeated');if(cursor)cursors.add(cursor);
          complete=cursor===null;state=complete?'ready':'loading';message=complete?(points.length?'':'No server-recorded positions available'):'Loading full recorded track…';refresh();await yieldTask();
        }while(cursor!==null);
        return frame();
      })().catch(error=>{if(id===sequence){state='error';complete=false;message=signal.aborted?'Aircraft history timed out; retry by reselecting the aircraft':error.message;refresh()}return frame()}).finally(()=>{clearTimeout(timer);if(id===sequence)pending=null});
      return pending;
    }
    return{select,seek(ms){if(!Number.isFinite(ms)||ms<0||ms>now())return{applied:false,message:'Choose a recorded UTC time, not a future time'};time=Math.round(ms);refresh();return{applied:true,message:'Showing server-recorded aircraft only; gaps remain empty'}},live(){time=null;return refresh()},refresh,frame};
  }
  function createMapController({map=browser.FISO_FID_MAP,L=browser.L,loadPage=fetchPage,onFrame=()=>{},setRecordedMode=mode=>browser.ffappSetRecordedTimeMode?.(mode),synthetic=false,flightOnly=false}={}){
    const layer=L.layerGroup().addTo(map);
    if(!map.getPane('recordedTrackPane')){map.createPane('recordedTrackPane');map.getPane('recordedTrackPane').style.zIndex=940;map.getPane('recordedTrackPane').style.pointerEvents='none';}
    if(!map.getPane('recordedAircraftPane')){map.createPane('recordedAircraftPane');map.getPane('recordedAircraftPane').style.zIndex=955;}
    let lastPoints=null,lastTime=undefined,lastCount=-1,lastLines=null;
    const controller=createController({loadPage,flightOnly,render:f=>{
      onFrame(f);
      setRecordedMode(f.mode==='history');
      if(f.points===lastPoints&&f.points.length===lastCount&&f.time===lastTime&&f.lines===lastLines&&f.state==='ready')return;lastPoints=f.points;lastCount=f.points.length;lastTime=f.time;lastLines=f.lines;
      layer.clearLayers();
      if(f.lines.length)L.polyline(f.lines,{pane:'recordedTrackPane',color:'#39ff14',weight:2,opacity:1,interactive:false,smoothFactor:0,noClip:false}).addTo(layer);
      if(f.mode==='history'&&f.position){
        const marker=L.marker([f.position.lat,f.position.lon],{pane:'recordedAircraftPane',icon:L.divIcon({className:'recorded-aircraft',html:(typeof synthetic==='function'?synthetic():synthetic)?'<span class="dev456-demo-marker">DEMO ✈</span>':'<span aria-hidden="true">✈</span>',iconSize:[24,24],iconAnchor:[12,12]})}).addTo(layer);
        marker.bindTooltip(((typeof synthetic==='function'?synthetic():synthetic)?'SYNTHETIC FIXTURE · ':'')+f.hex.toUpperCase()+' · recorded '+new Date(f.position.t).toISOString(),{direction:'top'});
        marker.on('click',()=>controller.select(f.hex));
      }
    }});
    return controller;
  }
  function attach(){
    if(!browser?.FISO_FID_MAP||browser.FFAPP_AIRCRAFT_TRACK_CONTROLLER)return;
    const map=browser.FISO_FID_MAP;
    map.attributionControl?.addAttribution('Aircraft history: <a href="https://www.adsb.lol/" target="_blank" rel="noopener">adsb.lol</a> · <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL 1.0</a>');
    const controller=createMapController();
    browser.FFAPP_AIRCRAFT_TRACK_CONTROLLER=controller;
    browser.ffappSelectRecordedAircraft=(hex,options)=>{const value=typeof hex==='string'?hex.toLowerCase():null;return controller.select(value===null||validHex(value)?value:null,options)};
    browser.ffappSetAircraftPreviewTime=ms=>controller.seek(Number(ms));
    browser.ffappResetAircraftPreview=()=>controller.live();
    browser.dispatchEvent(new browser.CustomEvent('ffapp-server-tracks-ready'));
  }
  return{SCHEMA,GAP,MAX_PAGE,MAX_POINTS,MAX_BYTES,validHex,validatePage,pointAt,segments,boundedJson,fetchPage,createController,createMapController,attach};
});
