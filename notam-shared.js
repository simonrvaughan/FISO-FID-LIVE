/* DEV465: authenticated shared plotting references; one field per conditional save. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(root);else root.FISO_NOTAM_SHARED=factory(root);})(typeof window==='undefined'?globalThis:window,function(root){
 'use strict';
 const changed=new Map();let scheduled=false;
 function announce(record){
  if(typeof root.dispatchEvent!=='function'||typeof root.CustomEvent!=='function')return;
  changed.set(record.notamId,record);if(scheduled)return;scheduled=true;
  queueMicrotask(()=>{scheduled=false;const records=[...changed.values()];changed.clear();root.dispatchEvent(new root.CustomEvent('ffapp-notam-numbers-changed',{detail:{records}}));});
 }
 function create({getToken,fetcher=fetch}){
  const versions=new Map(),records=new Map(),loaded=new Set();let editable=false,scope='';
  async function request(body){
   const token=await getToken();if(!token)throw Error('Sign in to load shared NOTAM numbers.');
   const r=await fetcher('/.netlify/functions/dev465-notam-numbers',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
   const value=await r.json();if(!r.ok){const e=Error(r.status===409?'Another user changed this number. Your entry is not saved. Check the latest value, then edit again to retry.':r.status===403?'This account has read-only access.':r.status===401?'Sign in again to save shared numbers.':'Shared numbers are unavailable. Your entry is not confirmed saved.');e.record=value.record;e.status=r.status;throw e;}return value;
  }
  function apply(record){const old=records.get(record.notamId);if(!old||(record.version||0)>=(old.version||0)){records.set(record.notamId,record);announce(record);}}
  return {
   async load(ids){const value=await request({op:'read',ids});if(!value.ok||!Array.isArray(value.records))throw Error('Invalid shared-number response');value.records.forEach(record=>{apply(record);for(const field of ['pin','page'])versions.set(record.notamId+'|'+field,record.versions?.[field]||0);});ids.forEach(id=>loaded.add(id));editable=value.canEdit===true;scope=value.scope;return value;},
   async save(id,field,value){
    if(!loaded.has(id)||!editable)throw Error('Load shared numbers with an operational account before editing.');
    const expectedVersion=versions.get(id+'|'+field)||0;
    try{const result=await request({op:'save',notamId:id,field,value,expectedVersion});apply(result.record);versions.set(id+'|'+field,result.record.versions?.[field]||0);return result.record;}
    catch(e){if(e.record){apply(e.record);versions.set(id+'|'+field,e.record.versions?.[field]||0);e.message+=' Latest shared value: '+(e.record[field]||'(blank)')+'.';if(e.record[field]===value&&e.record[field+'Set'])return e.record;}throw e;}
   },
   read:id=>records.get(id)||{notamId:id,pin:'',page:'',pinSet:false,pageSet:false,versions:{pin:0,page:0},version:0},
   has:id=>loaded.has(id),get canEdit(){return editable;},get scope(){return scope;}
  };
 }
 return {create};
});
