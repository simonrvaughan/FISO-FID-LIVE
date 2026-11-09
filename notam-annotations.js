/* DEV464: persist plotting numbers per NOTAM; no backend or authentication changes. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FISO_NOTAM_ANNOTATIONS=factory();})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const prefix='fiso_notam_numbers_v1:';
  function key(id){if(typeof id!=='string'||!id||id.length>80)throw Error('Invalid NOTAM ID');return prefix+encodeURIComponent(id);}
  function clean(v){return typeof v==='string'?v.slice(0,12):'';}
  function read(storage,id){const raw=storage.getItem(key(id));let row;try{row=JSON.parse(raw||'null');}catch(e){throw Error('Saved NOTAM numbers could not be read');}return {pin:clean(row&&row.pin),page:clean(row&&row.page)};}
  function hasPin(storage,id){const row=JSON.parse(storage.getItem(key(id))||'null');return !!(row&&(row.pinSet||row.pin));}
  function save(storage,id,field,value){if(field!=='pin'&&field!=='page')throw Error('Invalid number field');const pinSet=field==='pin'||hasPin(storage,id),row=read(storage,id);row[field]=clean(value);storage.setItem(key(id),JSON.stringify({...row,pinSet}));return row;}
  return {read,save,hasPin,key};
});
