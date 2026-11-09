/* DEV465: shared plotting references in the native NOTAM report popup. */
(function(){
  'use strict';
  function mount(root,options){
  options=options||{};
  const $=id=>root.querySelector('#'+id),groups=['Parachuting','GLIDING','Display','Danger areas / TDAs / RATs','Miscellaneous / everything else','Aerial Surveys'];
  const printMode=options.printMode===true||(root===document&&new URLSearchParams(location.search).get('print')==='1'),store=window.FISO_NOTAM_ANNOTATIONS;
  const blocked=new Set(),pending=new Map(),timers=new Map(),inflight=new Map();let report,queued=null,sharedReady=printMode,loadingShared=false,lastSharedCheck=0,disposed=false;
  const shared=!printMode&&options.getToken&&window.FISO_NOTAM_SHARED?window.FISO_NOTAM_SHARED.create({getToken:options.getToken}):null;
  const controller={hasUnsavedChanges:()=>pending.size>0};
  function isEditing(){const active=root.activeElement||document.activeElement;return !!(active&&active.matches('.manual input'));}
  function status(message,error){$('saveStatus').textContent=message;$('saveStatus').classList.toggle('warning',!!error);}
  function save(id,field,value){
    const k=id+'|'+field;blocked.delete(k);pending.set(k,{id,field,value});clearTimeout(timers.get(k));
    status('Saving shared numbers…',false);timers.set(k,setTimeout(()=>flushField(k),500));
  }
  async function flushField(k){
    clearTimeout(timers.get(k));timers.delete(k);
    if(blocked.has(k))return;
    if(inflight.has(k))return inflight.get(k);
    const edit=pending.get(k);if(!edit)return;
    const job=(async()=>{
      try{if(!shared)throw Error('Open this report from the signed-in app.');await shared.save(edit.id,edit.field,edit.value);if(pending.get(k)===edit)pending.delete(k);if(!pending.size)status(shared.scope==='preview'?'Saved to this dev preview. Production numbers are unchanged.':'Saved and shared with other users.',false);}
      catch(e){if(e.status===409)blocked.add(k);status('NOT SAVED: '+e.message,true);}
      finally{inflight.delete(k);if(pending.has(k)&&pending.get(k)!==edit)flushField(k);if(!pending.size&&!disposed)applyQueued();}
    })();inflight.set(k,job);return job;
  }
  async function flush(){for(const k of pending.keys())await flushField(k);await Promise.all([...inflight.values()]);}
  function updateNumbers(){
    $('printReport').disabled=loadingShared||!sharedReady;
    root.querySelectorAll('tr.notam').forEach(tr=>{const n=report.rows.find(r=>r.id===tr.dataset.notamId),record=shared.read(n.id);tr.querySelectorAll('input').forEach((input,index)=>{
      const field=index===0?'pin':'page';input.disabled=loadingShared||!sharedReady||!shared.canEdit||!shared.has(n.id);
      if(!pending.has(n.id+'|'+field)&&!isEditing()){input.value=field==='pin'&&n.isNew&&!n.cancelledBy&&!record.pinSet?'NEW':record[field];tr.querySelectorAll('.print-number')[index].textContent=input.value;}
    });});
  }
  async function refreshShared(force){
    if(!shared||printMode||disposed||loadingShared||pending.size||isEditing()||!force&&Date.now()-lastSharedCheck<30000)return;
    loadingShared=true;updateNumbers();
    try{
      await shared.load(report.rows.map(r=>r.id));sharedReady=true;lastSharedCheck=Date.now();
      // Import old device-only references only into fields nobody has assigned.
      const imports=[];
      if(shared.canEdit)for(const n of report.rows){
        let legacy,hasPin;try{legacy=store.read(localStorage,n.id);hasPin=store.hasPin(localStorage,n.id);}catch(e){continue;}
        for(const field of ['pin','page'])if((field==='pin'?hasPin:!!legacy[field])&&!shared.read(n.id)[field+'Set'])imports.push({id:n.id,field,value:legacy[field]});
      }
      if(imports.length){
        status('Copying previous device numbers into empty shared fields…',false);
        const worker=async()=>{while(imports.length&&!disposed){const item=imports.shift();try{await shared.save(item.id,item.field,item.value);if(!disposed)updateNumbers();}catch(e){if(e.status!==409)throw e;}}};
        await Promise.all([worker(),worker()]);
      }
      if(!disposed){updateNumbers();status(shared.canEdit?(shared.scope==='preview'?'Shared preview numbers loaded. Saves stay separate from production.':'Shared numbers loaded. Changes save automatically for other users.'):'Shared numbers loaded — this account is read-only.',false);}
    }catch(e){if(!disposed)status('Shared numbers could not be loaded. '+e.message,true);}
    finally{loadingShared=false;if(!disposed&&sharedReady)updateNumbers();}
  }
  function fallbackPrint(){
    if(root===document){window.print();return;}
    const tab=window.open('about:blank','_blank');
    if(!tab){status('Allow this site to open a new tab, then press Print again. Your entries remain in this popup.',true);return;}
    tab.opener=null;tab.document.title='Today’s NOTAMs — A4';
    const style=tab.document.createElement('style');style.textContent=root.querySelector('style').textContent;
    const copy=root.querySelector('main').cloneNode(true);copy.querySelectorAll('input,header button').forEach(el=>el.remove());
    tab.document.head.appendChild(style);tab.document.body.className='print-view';tab.document.body.appendChild(copy);
    tab.requestAnimationFrame(()=>setTimeout(()=>tab.print(),250));
  }
  function cell(row,text,tag){const el=document.createElement(tag||'td');el.textContent=text;row.appendChild(el);return el;}
  function valid(value){return value&&value.version===1&&Array.isArray(value.rows)&&/^\d{4}-\d{2}-\d{2}$/.test(value.date);}
  function freshness(){
    const today=new Date().toISOString().slice(0,10),age=Date.now()-Date.parse(report.checked),issuedAge=Date.now()-Date.parse(report.issued);
    $('warning').hidden=!(report.feedWarning||report.date!==today||!Number.isFinite(age)||age>30*60000||!Number.isFinite(issuedAge)||issuedAge>6*3600000);
    $('warning').textContent=(report.feedWarning?report.feedWarning+' ':'')+'Check data freshness: this report uses the loaded PIB. Confirm the live PIB is current. Missing notices are not assumed cancelled without explicit cancellation evidence.';
  }
  function draw(value){
    report=value;queued=null;$('notamRows').replaceChildren();
    $('reportMeta').textContent=report.date+' | '+report.rows.length+' notices | UTC | PIB issued: '+(report.issued||'not available')+' | Checked: '+(report.checked||'not available');
    if(root===document)document.title='NOTAMs '+report.date+' — FISOFID';
    freshness();
    let previous=-1;
    const fragment=document.createDocumentFragment();
    report.rows.forEach(n=>{
      if(n.group!==previous){const tr=document.createElement('tr');tr.className='section group-'+n.group;const th=cell(tr,groups[n.group]||groups[4],'th');th.colSpan=5;th.scope='rowgroup';fragment.appendChild(tr);previous=n.group;}
      const tr=document.createElement('tr');tr.className='notam'+(n.cancelledBy?' cancelled':'')+(n.missing?' missing':'');tr.dataset.notamId=n.id;
      let saved={pin:'',page:''},hasPin=false;
      try{if(shared){const r=shared.read(n.id);saved={pin:r.pin,page:r.page};hasPin=r.pinSet;}else{saved=store.read(localStorage,n.id);hasPin=store.hasPin(localStorage,n.id);}}catch(e){status('Unable to read saved numbers.',true);}
      if(n.isNew&&!n.cancelledBy&&!hasPin)saved.pin='NEW';
      const manual=label=>{
        const field=label==='Pin No'?'pin':'page',td=cell(tr,'');td.className='manual';
        const text=document.createElement('span');text.className='print-number';text.textContent=saved[field];
        if(!printMode){const input=document.createElement('input');input.type='text';input.maxLength=12;input.inputMode='numeric';input.autocomplete='off';input.value=saved[field];input.setAttribute('aria-label',label+' for '+n.id);input.disabled=!shared||!sharedReady||!shared.canEdit||!shared.has(n.id);input.addEventListener('input',()=>{text.textContent=input.value;save(n.id,field,input.value);});input.addEventListener('blur',()=>flushField(n.id+'|'+field));input.addEventListener('focus',()=>{if(field==='pin'&&input.value==='NEW')input.select();});td.appendChild(input);}
        td.appendChild(text);
      };
      manual('Pin No');const description=cell(tr,'');description.className='notam-description';description.title=n.source;
      const content=document.createElement('span');content.className='description-content';content.textContent=n.description;description.appendChild(content);
      const detail=document.createElement('span');detail.className='detail';detail.textContent=n.id+' | '+n.coordinates;description.appendChild(detail);
      if(n.cancelledBy){const mark=document.createElement('strong');mark.className='cancellation-mark';mark.textContent='canceled · '+n.cancelledBy;description.appendChild(mark);}
      else if(n.missing){const mark=document.createElement('span');mark.className='missing-note';mark.textContent='Not in current PIB — cancellation not confirmed';description.appendChild(mark);}
      cell(tr,n.levels);cell(tr,n.times);manual('Page No');fragment.appendChild(tr);
    });
    $('notamRows').appendChild(fragment);$('notamTable').hidden=!report.rows.length;$('empty').hidden=!!report.rows.length;
    $('review').hidden=!(report.review&&report.review.length);
    $('review').replaceChildren();
    if(!$('review').hidden){
      const heading=document.createElement('h2');heading.textContent='Manual intervention required';$('review').appendChild(heading);
      for(const r of report.review){
        const item=document.createElement('article');item.className='manual-review-item';
        const title=document.createElement('strong');title.textContent=r.id+' — '+r.reason;item.appendChild(title);
        for(const value of [r.description,r.source,[r.levels,r.times,r.coordinates].filter(Boolean).join(' | ')])if(value){const line=document.createElement('p');line.textContent=value;item.appendChild(line);}
        $('review').appendChild(item);
      }
    }
    $('printReport').disabled=!printMode&&!sharedReady;$('ackChanges').disabled=false;
    $('liveStatus').textContent=printMode?'':('Automatic updates use the app’s existing feed. New notices show NEW; confirmed cancellations remain on the list.');
    if(printMode&&report.printNumbers)root.querySelectorAll('tr.notam').forEach((tr,i)=>{const values=report.printNumbers[report.rows[i].id];if(values){const cells=tr.querySelectorAll('.print-number');cells[0].textContent=values.pin||'';cells[1].textContent=values.page||'';}});
  }
  function applyQueued(){if(queued&&!pending.size&&!isEditing()){draw(queued);refreshShared(true);}}
  try{
    const key=options.key||location.hash.slice(1);
    if(!/^fiso_print_notams_\d+_[a-z0-9]+$/.test(key))throw Error('Open this page using Todays NOTAMs beside PARAS in the main app.');
    const initial=JSON.parse(localStorage.getItem(key)||'null');
    if(!valid(initial))throw Error('Report not found. Open a fresh report from the main app.');
    draw(initial);if(!printMode){status(shared?'Loading shared numbers…':'Open Today’s NOTAMs from the signed-in map to load shared numbers.',!shared);refreshShared(true);}
    $('ackChanges').addEventListener('click',()=>{
      applyQueued();
      try{localStorage.setItem('fiso_today_notams_ack_v1:'+report.date,String(report.changeRevision||0));if(options.onAck)options.onAck();else window.parent.postMessage('fiso-notams-ack',location.origin);$('liveStatus').textContent='Displayed changes acknowledged. A new change will make the button gently flash again.';}
      catch(e){$('liveStatus').textContent='Unable to save acknowledgement on this device. The change alert remains active.';}
    });
    $('printReport').addEventListener('click',()=>{
      if(printMode){window.print();return;}
      for(const k of pending.keys())flushField(k);
      applyQueued();
      const printReport={...report,printNumbers:{}};
      root.querySelectorAll('tr.notam').forEach((tr,i)=>{const inputs=tr.querySelectorAll('input');printReport.printNumbers[report.rows[i].id]={pin:inputs[0].value,page:inputs[1].value};});
      try{localStorage.setItem(key,JSON.stringify(printReport));}catch(e){status('Device storage is unavailable. Opening an A4 copy with your current entries.',true);fallbackPrint();return;}
      const tab=window.open('todays-notams.html?print=1#'+key,'_blank');
      if(tab)tab.opener=null;else{status('Allow this site to open a new tab, then press Print again. Your entries remain in this popup.',true);}
    });
    if(printMode){document.body.classList.add('print-view');$('saveStatus').hidden=true;$('liveStatus').hidden=true;$('ackChanges').hidden=true;requestAnimationFrame(()=>setTimeout(()=>window.print(),250));}
    controller.update=value=>{
      if(!valid(value))return;
      if(pending.size||isEditing()){queued=value;$('liveStatus').textContent='Updated NOTAMs are ready; finish editing to show them.';}
      else {draw(value);refreshShared(true);}
    };
    controller.flush=flush;
    controller.heartbeat=()=>{freshness();refreshShared(false);};
    controller.error=()=>{$('liveStatus').textContent='Automatic update unavailable. Last report retained; check the main app’s PIB status.';};
    const focusout=()=>setTimeout(applyQueued,0);
    const keydown=e=>{if(e.key==='Escape'&&options.onClose){e.preventDefault();options.onClose();}};
    const unload=e=>{if(pending.size){e.preventDefault();e.returnValue='';}};
    root.addEventListener('focusout',focusout);root.addEventListener('keydown',keydown);window.addEventListener('beforeunload',unload);
    controller.destroy=()=>{disposed=true;for(const timer of timers.values())clearTimeout(timer);root.removeEventListener('focusout',focusout);root.removeEventListener('keydown',keydown);window.removeEventListener('beforeunload',unload);};
  }catch(e){$('reportMeta').textContent=e.message;}
  return controller;
  }
  window.FISO_NOTAM_PAGE={mount};
  if(document.getElementById('notamRows'))window.FISO_NOTAM_EDITOR=mount(document,{});
})();
