/* DEV456: on-demand genuine routes; no history panel, browser recording or polling. */
(function(){
 'use strict';
 const map=window.FISO_FID_MAP,T=window.FFAPP_SERVER_TRACKS;
 if(!map||!T)return;
 const endpoint='/.netlify/functions/dev456-history-recorded';
 let selected=null,expiryTimer=null;
 async function read(path,signal){
  const user=window.firebase?.auth().currentUser;
  if(!user)throw Error('Authentication required');
  const token=await user.getIdToken();
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  const response=await fetch(endpoint+path,{signal,method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},cache:'no-store',credentials:'same-origin',redirect:'error'});
  if(!response.ok)throw Error('Historical source unavailable (HTTP '+response.status+')');
  const value=await T.boundedJson(response,signal);
  if(value.dataMode!=='recorded'||value.points.some(p=>p.source!=='adsb.lol'))throw Error('Unverified historical source');
  return value;
 }
 function expire(){
  clearTimeout(expiryTimer);expiryTimer=null;
  const f=controller.frame();if(!selected||!f.points.length)return;
  const remaining=f.points[0].t+30*86400000-Date.now();
  if(remaining<=0){selected=null;controller.select(null);return;}
  expiryTimer=setTimeout(expire,Math.min(86400000,remaining));
 }
 const controller=T.createMapController({map,flightOnly:true,loadPage:({hex,cursor,signal})=>read('?hex='+hex+(cursor?'&cursor='+encodeURIComponent(cursor):''),signal)});
 // Clear the original gateway controller before taking sole ownership of the highlighted route.
 window.FFAPP_AIRCRAFT_TRACK_CONTROLLER?.select(null);
 window.FFAPP_AIRCRAFT_TRACK_CONTROLLER=controller;
 window.FFAPP_DEV456_PREVIEW={controller,get active(){return selected!==null}};
 window.ffappSelectRecordedAircraft=async function(hex,options={}){
  const value=typeof hex==='string'&&T.validHex(hex.toLowerCase())?hex.toLowerCase():null;
  // Live aircraft redraws must never trigger provider reads or replace the selection.
  if(value&&!options.force)return controller.frame();
  clearTimeout(expiryTimer);expiryTimer=null;selected=value;
  const frame=await controller.select(value,options);
  if(selected===value&&value&&frame.state==='ready'){
   if(window.ffappIsTestTime?.())controller.seek(window.ffappNowMs());
   expire();
  }
  return frame;
 };
 window.ffappSetAircraftPreviewTime=ms=>controller.seek(Number(ms));
 window.ffappResetAircraftPreview=()=>controller.live();
 window.addEventListener('ffapp-operational-time-change',()=>{
  if(!selected)return;
  if(window.ffappIsTestTime?.())controller.seek(window.ffappNowMs());else controller.live();
 });
 window.firebase?.auth().onAuthStateChanged(user=>{if(!user)window.ffappSelectRecordedAircraft(null)});
})();
