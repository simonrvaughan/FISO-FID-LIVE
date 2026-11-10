/* Compact map-local information, independent of Leaflet popup autopanning. */
(function(){
  'use strict';
  let control=null,current=null,owner=null;
  function close(){
    const previous=current;current=null;
    if(control)control.remove();control=null;owner=null;
    if(previous&&previous.onClose)previous.onClose();
  }
  function bodyFor(html){
      const body=document.createElement('div');body.className='ffapp-area-info-body';
      const template=document.createElement('template');template.innerHTML=html;
      const content=template.content.firstElementChild;
      if(content){
        content.querySelector('h3')?.remove();
        const overview=document.createElement('details');overview.open=true;
        const summary=document.createElement('summary');summary.textContent='Overview · UTC';overview.append(summary);
        const original=content.querySelector('.notam-e');if(original)original.remove();
        const sections=[...content.querySelectorAll(':scope > .hazdam-popup-section')];sections.forEach(section=>section.remove());
        while(content.firstChild)overview.append(content.firstChild);body.append(overview);
        sections.forEach(section=>{
          const details=document.createElement('details'),heading=document.createElement('summary'),label=section.querySelector(':scope > b');
          heading.textContent=label?.textContent||'Information';if(label)label.remove();details.append(heading,section);body.append(details);
        });
        if(original){const details=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Original NOTAM';details.append(heading,original);body.append(details);}
      }
    return body;
  }
  function update(key,html){
    if(!current||current.key!==key||current.html===html||!control)return;
    const box=control.getContainer(),old=box.querySelector('.ffapp-area-info-body');
    const opened=new Set([...old.querySelectorAll('details[open]')].map(d=>d.querySelector('summary').textContent));
    const body=bodyFor(html);body.querySelectorAll('details').forEach(d=>d.open=opened.has(d.querySelector('summary').textContent));
    const scroll=old.scrollTop;old.replaceWith(body);body.scrollTop=scroll;current.html=html;
  }
  function show(map,options){
    if(current&&current.key!==options.key)close();
    else if(control){control.remove();control=null;}
    map.closePopup();owner=map;current=options;
    control=L.control({position:'topleft'});
    control.onAdd=function(){
      const box=L.DomUtil.create('section','ffapp-area-info');box.setAttribute('aria-label','Selected area information');
      const header=document.createElement('header'),title=document.createElement('strong'),button=document.createElement('button');
      title.textContent=options.title;button.type='button';button.textContent='×';button.setAttribute('aria-label','Close area information');button.onclick=close;
      header.append(title,button);box.append(header);
      const body=bodyFor(options.html);
      box.append(body);
      L.DomEvent.disableClickPropagation(box);L.DomEvent.disableScrollPropagation(box);
      box.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}});
      return box;
    };
    control.addTo(map);
  }
  window.FISO_AREA_INFO={show,close,update,key:()=>current&&current.key};
})();
