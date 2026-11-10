/* DEV461: shared chart labels for the eight requested temporary/permanent areas. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./notam-schedule.js'));
  else root.FISO_AREA_LABELS=factory(root.FFAPP_NOTAM_SCHEDULE);
})(typeof window==='undefined'?globalThis:window,function(schedule){
  'use strict';
  const targets=new Set(['D290A','D290B','D290C','D324A','D324B','D388','D220A','D220B']);
  function ref(value){const m=String(value||'').toUpperCase().match(/\b(?:EG)?(D\d{3}[A-Z]?)\b/);return m?m[1]:'';}
  function applies(value){return targets.has(ref(value));}
  function escape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  const dateFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'2-digit',month:'short'});
  function date(t){return dateFormatter.format(new Date(t)).toUpperCase();}
  function clock(t){return new Date(t).toISOString().slice(11,16).replace(':','');}
  function range(a,b){return date(a)+' '+clock(a)+'–'+(schedule.midnight(a)===schedule.midnight(b)?'':date(b)+' ')+clock(b)+'Z';}
  function timing(record,now,solar){
    const parsed=schedule.compile(record);
    if(parsed.state==='uncertain')return record.b||record.startISO||record.validStartISO?'CHECK NOTAM':'BY NOTAM';
    const d=String(record.scheduleD??record.d??'').trim();
    if(!d){
      if(!Number.isFinite(parsed.finish))return 'FROM '+date(parsed.begin)+' '+clock(parsed.begin)+'Z';
      return (now<parsed.begin?'NEXT ':now>=parsed.finish?'ENDED ':'')+range(parsed.begin,parsed.finish);
    }
    const day=schedule.midnight(Math.max(now,parsed.begin));
    const value=schedule.windows(record,day,day+86400000,solar);
    if(value.state==='uncertain')return 'CHECK NOTAM';
    const intervals=value.intervals||[];
    const current=intervals.find(([a,b])=>now>=a&&now<b),next=intervals.find(([a])=>a>now);
    const chosen=current||next||intervals.at(-1);
    if(!chosen)return now>=parsed.finish?'ENDED — CHECK NOTAM':'NO WINDOW TODAY';
    return (current?'':next?'NEXT ':'ENDED ')+range(chosen[0],chosen[1]);
  }
  function html(id,upper,lower,time,state,selected){
    return '<div class="hazdam-label ffapp-area-label '+escape(state||'')+(selected?' hazdam-label-selected':'')+'" data-area-ref="'+escape(ref(id))+'"><div class="hazdam-label-id">'+escape(ref(id))+'</div><div class="hazdam-label-limits"><span class="ffapp-area-upper">'+escape(upper||'—')+'</span><br><span class="ffapp-area-lower">'+escape(lower||'—')+'</span></div><div class="ffapp-area-label-time">'+escape(time)+'</div></div>';
  }
  function layout(id,points){
    const lat=points.map(p=>p.lat),lon=points.map(p=>p.lon),south=Math.min(...lat),north=Math.max(...lat),west=Math.min(...lon),east=Math.max(...lon);
    const dy=Math.max(.025,north-south),dx=Math.max(.04,east-west),mid=(south+north)/2;
    // Fan out the stacked Holbeach bands; keep the large EGD388 label north.
    const positions={D290A:[south+dy*.78,west-dx*.22],D290B:[south+dy*.2,west-dx*.22],D290C:[mid,east+dx*.65],D388:[north+dy*.16,(west+east)/2]};
    const label=positions[ref(id)]||[north+dy*.2,east+dx*.2];
    const anchor=points.reduce((best,p)=>{
      const distance=q=>Math.hypot(q.lat-label[0],(q.lon-label[1])*Math.cos(mid*Math.PI/180));
      return distance(p)<distance(best)?p:best;
    },points[0]);
    return {label,anchor:[anchor.lat,anchor.lon]};
  }
  // Screen-space layout: one readable column east of the visible areas.
  // Recompute after pan/zoom; marker locations never alter stored geometry.
  function column(items,width,height){
    const mobile=width<=600,margin=mobile?24:12,labelWidth=108,rowHeight=44;
    const rows=items.map(item=>{
      const xs=item.points.map(p=>p.x),ys=item.points.map(p=>p.y);
      return {...item,west:Math.min(...xs),east:Math.max(...xs),north:Math.min(...ys),south:Math.max(...ys)};
    }).filter(item=>item.east>=0&&item.west<=width&&item.south>=0&&item.north<=height);
    if(!rows.length)return [];
    const x=Math.max(margin,Math.min(width-labelWidth-margin,Math.max(...rows.map(r=>r.east))+28));
    rows.forEach(row=>{
      const middle=(row.north+row.south)/2;
      row.anchor=row.points.reduce((best,p)=>Math.hypot(p.x-x,p.y-middle)<Math.hypot(best.x-x,best.y-middle)?p:best,row.points[0]);
    });
    const groups=new Map();
    rows.forEach(row=>{row.group=row.ref.replace(/[A-Z]$/,'');const values=groups.get(row.group)||[];values.push(row.anchor.y);groups.set(row.group,values);});
    const groupY=row=>groups.get(row.group).reduce((a,b)=>a+b,0)/groups.get(row.group).length;
    rows.sort((a,b)=>groupY(a)-groupY(b)||a.ref.localeCompare(b.ref));
    const top=mobile?94:32,bottom=height-(mobile?64:32);
    const gap=Math.min(rowHeight,(bottom-top)/Math.max(1,rows.length-1));
    const desired=rows.reduce((sum,r)=>sum+r.anchor.y,0)/rows.length;
    const start=Math.max(top,Math.min(bottom-gap*(rows.length-1),desired-gap*(rows.length-1)/2));
    return rows.map((row,i)=>({...row,label:{x,y:start+i*gap},knee:{x:x-14,y:start+i*gap}}));
  }
  const bound=new WeakSet(),pending=new WeakSet();
  function refresh(map){
    if(!map)return;
    if(!bound.has(map)){bound.add(map);map.on('moveend zoomend resize',()=>refresh(map));}
    if(pending.has(map))return;
    pending.add(map);
    requestAnimationFrame(()=>{
      pending.delete(map);
      const items=[];
      map.eachLayer(marker=>{
        const info=marker.__ffappAreaLayout,el=marker.getElement&&marker.getElement();
        if(!info||!el)return;
        if(el.style.display==='none')return;
        el.style.visibility='hidden';
        if(info.stalk._path){info.stalk._path.style.visibility='hidden';info.stalk._path.classList.add('ffapp-area-column-stalk');}
        items.push({...info,marker,points:info.points.map(p=>map.latLngToContainerPoint([p.lat,p.lon]))});
      });
      const size=map.getSize();
      column(items,size.x,size.y).forEach(row=>{
        row.marker.setLatLng(map.containerPointToLatLng(row.label));
        row.marker.getElement().style.visibility='';
        row.stalk.setLatLngs([row.anchor,row.knee,row.label].map(p=>map.containerPointToLatLng(p)));
        if(row.stalk._path)row.stalk._path.style.visibility='';
      });
    });
  }
  return {ref,applies,timing,html,layout,column,refresh};
});
