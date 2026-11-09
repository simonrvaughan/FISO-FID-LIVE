/* DEV467: display-only map codes and primary communication frequency. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FISO_AIRFIELD_MAP_LABELS=factory();})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function code(a){const v=String(a.icao||a.ident||a.name||'AF').trim();return /^EG[A-Z0-9]{2}$/i.test(v)?v.slice(2).toUpperCase():a.icao?v.toUpperCase():v;}
 function channel(value){for(const m of String(value||'').matchAll(/\b(\d{3}(?:\.\d{1,3})?)\b/g)){const n=Number(m[1]);if(n>=118&&n<137)return n.toFixed(3);}return '';}
 function frequency(a,aip){
  const direct=channel(a.freq||a.frequency||a.channel);if(direct)return direct;
  const rows=Array.isArray(aip&&aip.freqs)?aip.freqs:[];
  const rank=r=>/TOWER/i.test(r.callsign||'')?0:r.service==='TWR'&&!/GROUND/i.test(r.callsign||'')?1:/AFIS|RADIO|AIR.?GROUND/i.test(r.callsign||'')?2:r.service==='APP'?3:/ATIS|FIRE|EMERGENCY/i.test((r.service||'')+' '+(r.callsign||''))?9:5;
  for(const r of rows.slice().sort((a,b)=>rank(a)-rank(b))){if(rank(r)>=9)continue;const v=channel(r.channel||r.freq);if(v)return v;}return '';
 }
 function html(a,aip){const f=frequency(a,aip);return '<span class="airfield-hover-code">'+esc(code(a))+'</span><span class="airfield-hover-frequency">'+esc(f||'—')+'</span>';}
 return {code,frequency,html};
});
