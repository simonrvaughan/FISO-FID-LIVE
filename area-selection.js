/* DEV461: display-only selection feedback; no operational state changes. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else{
    const api=factory();
    root.FISO_AREA_SELECTION=api.create({
      now:()=>performance.now(),delay:(fn,ms)=>setTimeout(fn,ms),cancel:id=>clearTimeout(id),
      draw:source=>{
        if(!source||!source._map)return null;
        const options={color:'#ffe078',weight:4,opacity:1,fill:true,fillColor:'#ffe078',fillOpacity:.14,interactive:false,keyboard:false,className:'ffapp-area-selection-outline'};
        const overlay=typeof source.getRadius==='function'
          ?root.L.circle(source.getLatLng(),{...options,radius:source.getRadius()})
          :root.L.polygon(source.getLatLngs(),options);
        overlay.addTo(source._map);
        const started=performance.now(),remove=overlay.remove.bind(overlay);
        const animation=setInterval(()=>{
          const strength=(1+Math.cos((performance.now()-started)*Math.PI/1000))/2;
          overlay.setStyle({opacity:.25+.75*strength,fillOpacity:.03+.11*strength,weight:2.5+1.5*strength});
        },100);
        overlay.remove=function(){clearInterval(animation);return remove();};
        return overlay;
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
