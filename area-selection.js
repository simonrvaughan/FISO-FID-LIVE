/* DEV461: display-only selection feedback; no operational state changes. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else{
    const api=factory();
    root.FISO_AREA_SELECTION=api.create({
      now:()=>performance.now(),delay:(fn,ms)=>setTimeout(fn,ms),cancel:id=>clearTimeout(id),
      draw:source=>{
        if(!source||!source._map)return null;
        const options={color:'#ff6565',weight:2.5,opacity:.8,fill:false,interactive:false,keyboard:false,className:'ffapp-area-selection-outline'};
        const overlay=typeof source.getRadius==='function'
          ?root.L.circle(source.getLatLng(),{...options,radius:source.getRadius()})
          :root.L.polygon(source.getLatLngs(),options);
        return overlay.addTo(source._map);
      }
    });
  }
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  function create({now,delay,cancel,draw}){
    let key=null,resolve=null,deadline=0,timer=null,source=null,overlay=null;
    function remove(){if(overlay)overlay.remove();overlay=null;source=null;}
    function stop(){if(timer!==null)cancel(timer);timer=null;remove();key=null;resolve=null;deadline=0;}
    function refresh(){
      if(!resolve)return;
      if(now()>=deadline){stop();return;}
      const current=resolve();
      if(current!==source || current&&!overlay){remove();source=current;if(source)overlay=draw(source);}
      if(overlay&&overlay.bringToFront)overlay.bringToFront();
    }
    function start(id,resolver){
      stop();key=id;resolve=resolver;deadline=now()+10000;refresh();
      timer=delay(stop,10000);
    }
    return {start,refresh,stop,selected:()=>key};
  }
  return {create};
});
