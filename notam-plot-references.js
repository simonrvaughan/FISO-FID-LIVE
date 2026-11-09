/* DEV466: confirmed shared references override presentation, never plot identity/geometry. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FISO_NOTAM_PLOT_REFS=factory();})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 function canonical(value){const m=String(value||'').trim().toUpperCase().match(/^([A-Z])(\d{3,4})\/(\d{2})$/);return m?m[1]+m[2].padStart(4,'0')+'/'+m[3]:'';}
 function notamId(h){let value=canonical(h&&h.notamId)||canonical(h&&h.autoKey);if(!value){const m=String(h&&h.notam||'').match(/\b[A-Z]\d{3,4}\/\d{2}\b/);value=m?canonical(m[0]):'';}return value;}
 function isAuto(h){return !!(h&&(h.autoManaged===true||h.autoSource==='PIB'||h.autoRule));}
 function create(){
  const records=new Map();
  return {
   accept(rows){let changed=false;for(const row of rows||[]){const id=canonical(row.notamId);if(!id)continue;const old=records.get(id);if(old&&(old.version||0)>(row.version||0))continue;const signature=r=>JSON.stringify([r.pin,r.page,!!r.pinSet,!!r.pageSet]);if(!old||signature(old)!==signature(row))changed=true;records.set(id,row);}return changed;},
   forNotam(value){const row=records.get(canonical(value));return {pin:row&&row.pinSet&&String(row.pin||'').trim().toUpperCase()!=='NEW'?String(row.pin||'').trim():'',page:row&&row.pageSet?String(row.page||'').trim():''};},
   forPlot(h){const manual=isAuto(h)?this.forNotam(notamId(h)):{pin:'',page:''},generated=h?(h.pinRef||h.ref):'';return {pin:manual.pin||(generated==null?'':String(generated)),page:manual.page,manualPin:!!manual.pin};}
  };
 }
 return {create,notamId,isAuto,canonical};
});
