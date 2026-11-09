/* DEV464: read-only, date-specific printable NOTAM report. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./notam-schedule.js'),require('./notam-history.js'));
  else root.FFAPP_TODAYS_NOTAMS=factory(root.FFAPP_NOTAM_SCHEDULE,root.FFAPP_NOTAM_HISTORY);
})(typeof window==='undefined'?globalThis:window,function(schedule,history){
  'use strict';
  const groups=['Parachuting','GLIDING','Display','Danger areas / TDAs / RATs','Miscellaneous / everything else','Aerial Surveys'];
  function altitude(value,q){
    const v=String(value||'').trim().toUpperCase().replace(/,/g,'');
    if(!v&&/^\d{3}$/.test(String(q)))return altitude(Number(q)===0?'SFC':'FL'+q);
    if(/^(SFC|GND|GROUND|SURFACE)$/.test(v))return {feet:0,text:'SFC'};
    if(/^(UNL|UNLIMITED|FL999)$/.test(v))return {feet:Infinity,text:'UNL'};
    let m=v.match(/^FL\s*(\d{1,3})$/);
    if(m)return {feet:Number(m[1])*100,text:'FL'+m[1].padStart(3,'0')};
    m=v.match(/^(\d+(?:\.\d+)?)\s*(FT|FEET|M)\s*(AMSL|MSL|AGL|AAL)$/);
    if(!m)return null;
    const feet=Number(m[1])*(m[2]==='M'?3.280839895:1);
    return {feet,text:/^(AMSL|MSL)$/.test(m[3])?(feet/1000).toFixed(1)+'A':Math.round(feet).toLocaleString('en-GB')+' ft '+m[3]};
  }
  function field(n,letter){
    const m=String(n.raw||'').match(new RegExp('^'+letter+'\\)\\s*([^\\r\\n]+)','m'));
    return m?m[1].trim():n[letter.toLowerCase()];
  }
  function coords(n){
    const m=String(n.qLine||'').match(/\/(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])\d{3}(?:\s|$)/);
    return m?'Lat '+m[1]+'°'+m[2]+'′'+m[3]+'  Lon '+m[4]+'°'+m[5]+'′'+m[6]+' (Q centre)':'Coordinates not stated';
  }
  function latitude(n,c){
    const q=String(n.qLine||'').match(/\/(\d{2})(\d{2})([NS])\d{3}\d{2}[EW]\d{3}(?:\s|$)/);
    if(q&&Number(q[1])<=90&&Number(q[2])<60)return (Number(q[1])+Number(q[2])/60)*(q[3]==='S'?-1:1);
    if(Number.isFinite(n.lat)&&Math.abs(n.lat)<=90)return n.lat;
    return c&&Number.isFinite(c.lat)&&Math.abs(c.lat)<=90?c.lat:null;
  }
  function inScope(row){
    if(/\bEG\s*D\s*789[A-Z]?\b/i.test([row.description,row.source].join(' ')))return false;
    let lat=row.latitude;
    if(!Number.isFinite(lat)){
      // Migrate already-saved daily rows using their published Q-centre display.
      const m=String(row.coordinates||'').match(/Lat\s+(\d{1,2})°(\d{2})′([NS])/);
      if(m)lat=(Number(m[1])+Number(m[2])/60)*(m[3]==='S'?-1:1);
    }
    return Number.isFinite(lat)&&lat<=56;
  }
  function group(c,label){
    const t=String(c&&c.type||'').toLowerCase(),s=String(label||'').toLowerCase();
    if(t==='parachute'||/parachut/.test(s))return 0;
    if(t==='gliding'||/glid|paraglid/.test(s))return 1;
    if(/display|bbmf|redarrows/.test(t)||/display|flypast|red arrows|bbmf/i.test(s))return 2;
    if(/^(tda|rat)$/.test(t)||/danger area|\btda\b|ra\(t\)/i.test(s))return 3;
    if(/aerial survey/i.test(s))return 5;
    return 4;
  }
  function build(classified,options){
    const now=Number(options.now||Date.now()),d=new Date(now),day=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()),end=day+86400000;
    const rows=[],review=[],seen=new Set(),areas=options.areas||{};
    for(const r of classified){
      const n=r.notam||{},c=r.candidate,p=(r.dangers||[]).filter(x=>x.action!=='deactivate');
      const id=n.notamId||n.id,text=String(n.eText||'');
      const potential=!!(c||p.length||r.error||/\/Q[WR][A-Z]{3}\//i.test(n.qLine||'')||/\b(?:PARACHUT|PJE|GLIDING|AIR DISPLAYS?|JAMMING|AIR EXERCISE|AERIAL SURVEY)\b/i.test(text));
      if(!id||seen.has(id)||r.ignored||!potential)continue;
      seen.add(id);
      if(/^(?:NOTAM)?C$/i.test(n.type||'')||history.verifyCancellation(n).verified)continue;
      if(/\bEGD098[A-Z]?\b/.test(text)||id==='R2484/26'||/\bCANCELLED\b|\bDEACTIVATED\b/i.test(text))continue;
      const begin=schedule.timestamp(n.b,false),finish=schedule.timestamp(n.c,true);
      const reviewRow=reason=>review.push({id,reason,description:(r.label||'Unclassified activity')+(r.location?' — '+r.location:''),coordinates:coords(n),levels:[lower?lower.text:field(n,'F')||n.lower||'?',upper?upper.text:field(n,'G')||n.upper||'?'].join(' - '),times:(Number.isFinite(begin)?new Date(begin).toISOString().slice(0,16).replace('T',' '):n.b||'?')+' - '+(Number.isFinite(finish)?new Date(finish).toISOString().slice(0,16).replace('T',' '):n.c||'?')+' UTC'+(n.d?' | D) '+n.d:''),source:text});
      if(Number.isFinite(begin)&&(Number.isFinite(finish)||finish===Infinity)&&!(begin<end&&finish>day))continue;
      const upper=altitude(field(n,'G')||c&&c.upper||p[0]&&p[0].upper,n.upper),lower=altitude(field(n,'F')||c&&c.lower||p[0]&&p[0].lower,n.lower);
      if(upper&&!(upper.feet>1000))continue;
      const lat=latitude(n,c);
      if(lat>56||/\bEG\s*D\s*789[A-Z]?\b/i.test([text,r.label,c&&c.displayLabel].join(' ')))continue;
      if(!Number.isFinite(begin)||!((Number.isFinite(finish)||finish===Infinity)&&finish>begin)){reviewRow('Validity times uncertain — check original NOTAM');continue;}
      if(!upper||!lower){reviewRow('Check published altitude limits');continue;}
      if(lat===null){reviewRow('Location unverified — cannot apply 56°N limit');continue;}
      const win=schedule.windows(n,day,end,options.solar?(_,date,rise)=>options.solar(n,c,date,rise):undefined);
      if(win.state!=='recognised'){reviewRow('Schedule uncertain — check original NOTAM');continue;}
      const intervals=(win.intervals||[]).map(x=>[Math.max(day,x[0]),Math.min(end,x[1])]).filter(x=>x[1]>x[0]);
      if(!intervals.length)continue;
      if(r.error||!c&&!p.length){reviewRow(r.error||'APN activity or geometry not recognised');continue;}
      if(c&&c.areaStyle==='GNSS_JAMMING'&&!(c.points&&c.points.length>1)&&!(c.radiusNm>0)){reviewRow('Affected jamming radius not verified');continue;}
      const fmt=t=>t===end?'24:00':new Date(t).toISOString().slice(11,16);
      const times=/\bSR\b|\bSS\b/.test(n.d||'')?n.d+' (solar)':intervals.map(x=>fmt(x[0])+' - '+fmt(x[1])).join('; ');
      let label=r.label||'Danger area activation',location=r.location||c&&c.location||'';
      if(/\bAERIAL\s+SURVEY\b/i.test(text))label='Aerial survey';
      if(!location&&p.length)location=p.map(x=>x.areaId+' '+((areas[x.areaId]||{}).name||'')).join(', ');
      if(!location){const m=text.match(/\(([^()]{3,100})\)/);if(m)location=m[1];}
      const g=group(c,label);
      rows.push({id,description:label+(location?' — '+location.replace(/^BTN /,''):''),levels:lower.text+' - '+upper.text,times,coordinates:coords(n),latitude:lat,group:g,start:intervals[0][0],source:text});
    }
    rows.sort((a,b)=>a.group-b.group||a.start-b.start||a.description.localeCompare(b.description));
    return {version:1,date:new Date(day).toISOString().slice(0,10),generated:new Date(now).toISOString(),issued:options.issued||'',checked:options.checked||'',rows,review};
  }
  // Never infer cancellation from a missing record or an E) narrative mention.
  function reconcile(report,previous,options){
    options=options||{};
    const old=previous&&previous.date===report.date&&Array.isArray(previous.rows)?previous:null;
    const before=new Map((old?old.rows:[]).filter(inScope).map(r=>[r.id,r])),rows=new Map(),cancellations=new Map(),newIds=new Set();
    const records=options.records||[],changes=options.changes||[];
    for(const n of records.concat(changes.map(c=>c.n||{}))){
      const proof=history.verifyCancellation(n);
      if(proof.verified)cancellations.set(proof.cancelledNotamId,proof.cancellationNotamId);
    }
    for(const change of changes)if(change.kind==='NEW'&&change.n&&!/^(?:NOTAM)?C$/i.test(change.n.type||''))newIds.add(history.reference(change.n.notamId));
    for(const row of report.rows){
      const prior=before.get(row.id);
      rows.set(row.id,{...row,isNew:!!(prior?prior.isNew:old||newIds.has(history.reference(row.id)))});
    }
    // Recover a cancelled original from the already-loaded central history when
    // the user did not have this popup open before its cancellation arrived.
    for(const row of options.originals||[])if(cancellations.has(history.reference(row.id))&&!rows.has(row.id))rows.set(row.id,{...row,isNew:false});
    const present=new Set(records.map(n=>history.reference(n.notamId)));
    const manualIds=new Set((report.review||[]).map(r=>r.id));
    for(const prior of before.values())if(!rows.has(prior.id)&&!manualIds.has(prior.id))rows.set(prior.id,{...prior,missing:!present.has(history.reference(prior.id))});
    for(const row of rows.values()){
      const prior=before.get(row.id),by=cancellations.get(history.reference(row.id))||prior&&prior.cancelledBy;
      if(by){row.cancelledBy=by;row.isNew=false;row.missing=false;}
      else if(present.has(history.reference(row.id)))row.missing=false;
    }
    const sorted=Array.from(rows.values()).filter(inScope).sort((a,b)=>a.group-b.group||a.start-b.start||a.description.localeCompare(b.description));
    const signature=r=>JSON.stringify([r.description,r.levels,r.times,r.coordinates,r.source,r.cancelledBy||'',!!r.missing]);
    const reviewChanged=!!old&&JSON.stringify(report.review||[])!==JSON.stringify(old.review||[]);
    const changed=reviewChanged||(old?sorted.some(r=>!before.has(r.id)||signature(r)!==signature(before.get(r.id))):sorted.some(r=>r.isNew||r.cancelledBy));
    return {...report,rows:sorted,changeRevision:(old&&Number(old.changeRevision)||0)+(changed?1:0),changedAt:changed?report.generated:old&&old.changedAt||''};
  }
  return {build,reconcile,groups,altitude};
});
