/* DEV461: ordered published TDA boundaries; WGS84 arcs, never Q-line circles. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./vendor/geographiclib-geodesic.min.js'));
  else root.FFAPP_TDA_GEOMETRY=factory(root.geodesic);
})(typeof window==='undefined'?globalThis:window,function(geo){
  'use strict';
  const earth=geo.Geodesic.WGS84;
  const pair='(\\d{6}(?:\\.\\d+)?[NS])\\s+(\\d{7}(?:\\.\\d+)?[EW])';
  function coordinate(lat,lon){
    function part(value,digits){
      const m=value.match(new RegExp('^(\\d{'+digits+'})(\\d{2})(\\d{2}(?:\\.\\d+)?)([NSEW])$'));
      if(!m||+m[2]>=60||+m[3]>=60)return null;
      const n=+m[1]+(+m[2])/60+(+m[3])/3600;
      if(n>(digits===2?90:180))return null;
      return /[SW]/.test(m[4])?-n:n;
    }
    const a=part(lat,2),b=part(lon,3);
    return a===null||b===null?null:{lat:a,lon:b};
  }
  function equal(a,b){return Math.abs(a.lat-b.lat)<1e-10&&Math.abs(a.lon-b.lon)<1e-10;}
  function boundary(text){
    const src=String(text||'').toUpperCase().replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\s+/g,' ');
    const start=src.search(/\bAREA BOUNDED BY\b/);
    if(start<0)return null; // Circular/activation-only TDAs retain their existing handling.
    const body=src.slice(start).split(/\b(?:UAS|BEYOND VISUAL|ACTIVITY WILL|FOR INFO)\b/)[0];
    const arc='((?:ANTI[ -]?|COUNTER[ -]?)?CLOCKWISE)\\s+(?:BY\\s+THE\\s+)?ARC\\s+(?:OF\\s+A\\s+CIRCLE\\s+)?(?:RADIUS\\s+)?(\\d+(?:\\.\\d+)?)\\s*NM\\s+CENT(?:RED|ERED)\\s+ON\\s+'+pair+'\\s+TO\\s+'+pair;
    const tokens=new RegExp(arc+'|'+pair,'g');
    const points=[],segments=[];
    let m,lastIndex=0,arcCount=0;
    function append(p){if(!points.length||!equal(points[points.length-1],p))points.push(p);}
    while((m=tokens.exec(body))){
      const between=body.slice(lastIndex,m.index);
      if(/\bARC\b/.test(between))throw Error('Unsupported published TDA arc');
      if(m[1]){
        if(!points.length)throw Error('TDA arc has no start');
        const center=coordinate(m[3],m[4]),end=coordinate(m[5],m[6]),radius=+m[2]*1852;
        if(!center||!end||!(radius>0))throw Error('Invalid TDA arc');
        const from=points[points.length-1],a=earth.Inverse(center.lat,center.lon,from.lat,from.lon),b=earth.Inverse(center.lat,center.lon,end.lat,end.lon);
        // Published endpoints are authoritative; rounded radii may differ slightly.
        if(Math.abs(a.s12-radius)>100||Math.abs(b.s12-radius)>100)throw Error('TDA arc endpoints disagree with published radius');
        const clockwise=!/ANTI|COUNTER/.test(m[1]);
        const sweep=clockwise?(b.azi1-a.azi1+360)%360:-((a.azi1-b.azi1+360)%360);
        const steps=Math.max(1,Math.ceil(Math.abs(sweep)/Math.min(1,Math.sqrt(8/radius)*180/Math.PI)));
        const first=points.length-1;
        for(let i=1;i<steps;i++){
          const p=earth.Direct(center.lat,center.lon,a.azi1+sweep*i/steps,radius);
          append({lat:p.lat2,lon:p.lon2});
        }
        append(end);arcCount++;
        segments.push({kind:'arc',center,radius,clockwise,sweep,first,last:points.length-1});
      }else{
        const end=coordinate(m[7],m[8]);
        if(!end)throw Error('Invalid TDA coordinate');
        const from=points[points.length-1];
        if(from&&!equal(from,end)){
          const latitude=/\bLINE OF LATITUDE\b/.test(between);
          if(latitude&&Math.abs(from.lat-end.lat)>1e-10)throw Error('Invalid TDA latitude segment');
          const inv=earth.Inverse(from.lat,from.lon,end.lat,end.lon),steps=Math.max(1,Math.ceil(inv.s12/1000));
          for(let i=1;i<steps;i++){
            const p=latitude?{lat2:from.lat,lon2:from.lon+(end.lon-from.lon)*i/steps}:earth.Direct(from.lat,from.lon,inv.azi1,inv.s12*i/steps);
            append({lat:p.lat2,lon:p.lon2});
          }
          segments.push({kind:latitude?'latitude':'line',from,to:end});
        }
        append(end);
      }
      lastIndex=tokens.lastIndex;
      if(points.length>10000)throw Error('TDA boundary exceeds geometry limit');
    }
    if(/\bARC\b/.test(body.slice(lastIndex)))throw Error('Unsupported published TDA arc');
    if(points.length<3)throw Error('Incomplete published TDA boundary');
    if(!equal(points[0],points[points.length-1]))append({...points[0]});
    return {points,segments,arcCount};
  }
  return {coordinate,boundary};
});
