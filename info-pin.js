/* DEV459: independent INFO PIN. No PIN, reset token or unlock state is persisted in the browser. */
(()=>{'use strict';
 const pinEndpoint=location.hostname==='fisofid.online'?'/.netlify/functions/dev459-info-pin':'/.netlify/functions/dev463-airfield-info';
 const side=document.getElementById('side'),handle=document.getElementById('infoCollapseHandle');if(!side||!handle)return;
 let grant=null,uid=null,idToken=null,busy=false,epoch=0,nonce=makeNonce();
 function makeNonce(){return Array.from(crypto.getRandomValues(new Uint8Array(24)),n=>n.toString(16).padStart(2,'0')).join('')}
 const dialog=document.createElement('dialog');dialog.id='infoPinDialog';dialog.setAttribute('aria-labelledby','infoPinTitle');dialog.innerHTML='<form><h3 id="infoPinTitle">Unlock INFO</h3><label for="infoPinInput">Administrator PIN</label><input id="infoPinInput" type="password" inputmode="numeric" pattern="[0-9]{6,12}" minlength="6" maxlength="12" autocomplete="off" required><p id="infoPinMessage" role="status" aria-live="polite"></p><button type="submit">Unlock</button><button type="button" data-close>Close</button><br><button type="button" class="pin-link" data-forgot>Forgot PIN?</button></form>';document.body.appendChild(dialog);
 const input=dialog.querySelector('input'),message=dialog.querySelector('[role=status]');
 function conceal(){side.setAttribute('data-info-pin-locked','');side.inert=true;side.setAttribute('aria-hidden','true');side.classList.remove('open');document.querySelector('main')?.classList.add('info-collapsed');handle.querySelector('span').textContent='Unlock INFO';handle.title='Unlock INFO with administrator PIN';handle.setAttribute('aria-label','Unlock INFO')}
 function lock(){const old={grant,nonce},token=idToken;epoch++;grant=null;uid=null;idToken=null;nonce=makeNonce();input.value='';message.textContent='';dialog.close();conceal();window.dispatchEvent(new Event('ffapp-info-pin-changed'));if(old.grant&&token)fetch(pinEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({op:'lock',...old}),keepalive:true}).catch(()=>{})}
 async function call(op,data={}){const user=window.firebase?.auth().currentUser;if(!user||user.isAnonymous)throw Error('Sign in using User 001 to unlock INFO.');const token=await user.getIdToken();idToken=token;const r=await fetch(pinEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({op,nonce,...data}),signal:AbortSignal.timeout(15000)});const result=await r.json();if(!r.ok)throw Error(r.status===429?'Too many attempts. Please wait five minutes.':r.status===403?'Incorrect PIN or access denied.':'INFO PIN service unavailable. Please try again.');return{result,user}}
 function show(){input.value='';message.textContent='';if(!dialog.open)dialog.showModal();input.focus()}
 document.addEventListener('click',e=>{if(e.target.closest('#infoCollapseHandle,#panelToggle')&&!grant){e.preventDefault();e.stopImmediatePropagation();show()}},true);
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{input.value='';message.textContent=''});
 dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;const ticket=epoch;const pin=input.value;input.value='';message.textContent='Checking PIN…';try{const{result,user}=await call('unlock',{pin});if(ticket!==epoch||window.firebase.auth().currentUser?.uid!==user.uid)return;if(!result.ok||!result.grant)throw Error('Incorrect PIN or access denied.');grant=result.grant;uid=user.uid;side.removeAttribute('data-info-pin-locked');side.inert=false;side.removeAttribute('aria-hidden');handle.querySelector('span').textContent='INFO';handle.title='Show / hide info panel';handle.setAttribute('aria-label','Show or hide info panel');dialog.close();window.dispatchEvent(new Event('ffapp-info-pin-changed'));handle.click()}catch(e){if(ticket===epoch)message.textContent=e.message}finally{busy=false}};
 dialog.querySelector('[data-forgot]').onclick=async()=>{if(busy)return;busy=true;const ticket=epoch;message.textContent='Requesting reset…';try{await call('request')}catch{}finally{if(ticket===epoch)message.textContent='If the request can be processed, a reset link will be sent to the administrator.';busy=false}};
 new MutationObserver(()=>{if(!grant&&(side.classList.contains('open')||!document.querySelector('main')?.classList.contains('info-collapsed')))conceal()}).observe(side,{attributes:true,attributeFilter:['class']});
 window.firebase?.auth().onAuthStateChanged(user=>{if(grant&&(!user||user.uid!==uid))lock()});
 window.addEventListener('pagehide',lock);window.addEventListener('focus',async()=>{if(!grant)return;const ticket=epoch;try{const{result}=await call('validate',{grant});if(ticket===epoch&&!result.ok)lock()}catch{if(ticket===epoch)lock()}});
 const canEdit=()=>!!grant&&window.firebase?.auth().currentUser?.uid===uid&&!window.firebase.auth().currentUser.isAnonymous;
 async function airfieldRequest(data){
  if(!canEdit())throw Error('Unlock INFO with your administrator PIN before saving airfield information.');
  const ticket=epoch,user=window.firebase.auth().currentUser,token=await user.getIdToken();
  if(ticket!==epoch||!canEdit())throw Error('INFO has been locked. Unlock it again to save.');
  const r=await fetch('/.netlify/functions/dev463-airfield-info',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({...data,grant,nonce}),signal:AbortSignal.timeout(20000)});
  const result=await r.json();
  if(ticket!==epoch||!canEdit())throw Error('INFO has been locked.');
  if(r.status===401||r.status===403){lock();throw Error('INFO authorisation expired. Unlock INFO again before saving.');}
  if(!r.ok)throw Error(r.status===409?'This airfield changed on another device. Refresh and reopen it before saving.':r.status===400?'Check the airfield name, code, coordinates and field lengths.':'Airfield information could not be saved. Please try again.');
  return result;
 }
 window.FISO_INFO_PIN=Object.freeze({lock,canEdit,airfieldRequest});conceal();
})();
