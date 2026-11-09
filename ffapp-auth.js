(function(){
"use strict";

const $=id=>document.getElementById(id);
const REGION="europe-west1";
const FIREBASE_CONFIG={
  apiKey:"AIzaSyD4ctwB-BD-J_a7HRF_OM-pbjt68aCLMlw",
  authDomain:"fisofid.firebaseapp.com",
  databaseURL:"https://fisofid-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:"fisofid",
  storageBucket:"fisofid.firebasestorage.app",
  messagingSenderId:"66716831190",
  appId:"1:66716831190:web:40a9b1537cbd3662296877"
};

let fbApp=null,auth=null,functions=null,currentClaims=null,operationalLoaded=false,loadingOperational=false,signInInProgress=false;
let manageModal=null,viewOnlySession=false;
let authenticatedUser=null,viewRequested=false,sessionEpoch=0,authBusy=false;
// DEV458 bootstrap state: independent of the approved operational map.
let authBootstrapPromise=null,authBootstrapAbort=null,authBootstrapEpoch=0;
let authUnsubscribe=null,authObserverEpoch=0,authWatchdog=null,restoreSessionAllowed=true,authMutation=null,authStateKnown=false;
window.FFAPP_AUTH_BUILD_VERSION="458";
// END DEV458 bootstrap state.

function setMessage(text,type){
  const el=$("ffauthMessage"); if(!el)return;
  el.textContent=text||""; el.className="ffauth-message "+(type||"");
}
function startupShow(text,pct,detail){
  try{window.ffappStartup?.show(text,pct,detail)}catch(e){}
}
function startupUpdate(text,pct,detail){
  try{window.ffappStartup?.update(text,pct,detail)}catch(e){}
}
function startupHide(){
  try{window.ffappStartup?.hide()}catch(e){}
}
function showOverlay(show){
  const o=$("loginOverlay"); if(!o)return;
  o.style.display=show?"flex":"none";
  o.setAttribute("aria-hidden",show?"false":"true");
}

function gateAllowed(){return !!(viewRequested&&authenticatedUser&&auth&&auth.currentUser&&auth.currentUser.uid===authenticatedUser.uid);}
function assertEntry(){if(!gateAllowed())throw new Error('Firebase authentication and explicit VIEW are required.');}
function readyForView(user){
  if(!user||!auth?.currentUser||auth.currentUser.uid!==user.uid)throw new Error('Authentication is no longer available.');
  authenticatedUser=user;viewRequested=false;
  const view=$('ffauthViewBtn');if(view){view.hidden=false;view.disabled=false;view.textContent=user.isAnonymous?'VIEW APP':'ENTER FISO FID APP';}
  if($('ffauthBeforeViewLogoutBtn'))$('ffauthBeforeViewLogoutBtn').hidden=false;
  ['ffauthLoginBtn','ffauthViewOnlyBtn'].forEach(id=>{if($(id))$(id).hidden=true;});
  showOverlay(true);startupHide();performance.mark('ffapp-auth-ready');
  setMessage('Signed in. Click '+(user.isAnonymous?'VIEW APP':'ENTER FISO FID APP')+' when ready.','ok');
}
function closeEntry(){
  window.FISO_INFO_PIN?.lock();
  sessionEpoch++;authenticatedUser=null;currentClaims=null;viewRequested=false;
  viewOnlySession=false;window.FISO_VIEW_ONLY_AUTHENTICATED_READ=false;
  const mount=$('workspaceMount');if(mount){mount.hidden=true;mount.inert=true;}
  if($('ffauthViewBtn')){$('ffauthViewBtn').hidden=true;$('ffauthViewBtn').disabled=true;}
  if($('ffauthBeforeViewLogoutBtn'))$('ffauthBeforeViewLogoutBtn').hidden=true;
  ['ffauthLoginBtn','ffauthViewOnlyBtn'].forEach(id=>{if($(id))$(id).hidden=false;});
  showOverlay(true);startupHide();
}
async function enterOperations(){
  if(!authenticatedUser||auth?.currentUser?.uid!==authenticatedUser.uid){setMessage('Sign in before opening the app.','err');return;}
  if(loadingOperational)return;
  if(operationalStartupFailed){window.FISO_STARTUP_RECOVERY?.reloadFresh();return;}
  viewRequested=true;const epoch=sessionEpoch;performance.mark('ffapp-view-click');
  $('ffauthViewBtn').disabled=true;
  try{
    await loadOperationalApp();assertEntry();if(epoch!==sessionEpoch)throw new Error('Session changed during startup.');
    applyCurrentRoleToApp();const mount=$('workspaceMount');if(mount){mount.hidden=false;mount.inert=false;}
    showOverlay(false);startupHide();performance.mark('ffapp-interface-visible');
    window.FISO_STARTUP_RECOVERY?.ready();
    window.FISO_FID_MAP?.invalidateSize({pan:false,animate:false});
    requestAnimationFrame(()=>requestAnimationFrame(()=>{if(gateAllowed()){
      window.FFAPP_PIB_SNAPSHOT?.start();loadDeferredOperationalModules();
    }}));
  }catch(error){
    setMessage('Unable to open the app. '+friendlyAuthError(error),'err');showOverlay(true);startupHide();
    if($('ffauthViewBtn'))$('ffauthViewBtn').disabled=false;
    if(epoch===sessionEpoch&&gateAllowed()){operationalStartupFailed=true;window.FISO_STARTUP_RECOVERY?.retryOnce();}
  }
}

function cleanNumber(v){return String(v||"").replace(/\D/g,"").slice(0,10)}
function emailForNumber(n){return `${n}@fisofid.internal`}
function legacyEmailForNumber(n){return `${n}@fisofid.local`}
function roleFromClaims(claims){
  const r=String(claims&&claims.role||"").toLowerCase();
  if(r==="viewonly"||r==="viewer"||r==="vieweredit")return "viewer";
  return (r==="admin"||claims&&claims.admin===true)?"admin":"operator";
}
function friendlyAuthError(err){
  const c=String(err&&err.code||"");
  if(c.includes("invalid-credential")||c.includes("wrong-password")||c.includes("user-not-found"))return "Incorrect user number or password.";
  if(c.includes("user-disabled"))return "This account has been disabled. Contact an administrator.";
  if(c.includes("too-many-requests"))return "Too many failed attempts. Try again later.";
  if(c.includes("network-request-failed"))return "Network error. Check your internet connection.";
  if(c.includes("timeout")||String(err&&err.message||"").toLowerCase().includes("timed out"))return "Secure sign-in timed out. Please try again; the app will not remain stuck on the loading screen.";
  return (err&&err.message)?err.message:"Unable to sign in.";
}
// Account-management code is fetched only when a callable is actually used.
function callable(name){return async function(data){
  // DEV461 draft review must not log sign-ins or mutate production accounts.
  if (/--fisofid\.netlify\.app$/i.test(location.hostname)) {
    if (name === "recordLogin") return {data:{}};
    throw new Error("Account changes are disabled in this isolated preview. Use the live site for account management.");
  }
  await loadExternalScriptOnce("https://www.gstatic.com/firebasejs/9.23.0/firebase-functions-compat.js",()=>typeof firebase!=="undefined"&&typeof firebase.app(fbApp.name).functions==="function");
  if(!functions)functions=firebase.app(fbApp.name).functions(REGION);
  return functions.httpsCallable(name)(data);
}}
function withTimeout(promise,ms,label){
  let timer;
  return Promise.race([
    promise,
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label||"Operation timed out")),ms);})
  ]).finally(()=>clearTimeout(timer));
}

async function initFirebase(){
  if(typeof firebase==="undefined")throw new Error("Firebase SDK failed to load.");
  fbApp=(firebase.apps&&firebase.apps.length)?firebase.app():firebase.initializeApp(FIREBASE_CONFIG);
  window.FISO_FIREBASE_CONFIG=FIREBASE_CONFIG;
  window.FISO_FIREBASE_APP=fbApp;
  auth=firebase.auth(fbApp);
  // Persistence failure must not strand sign-in on browsers with restricted storage.
  try{await withTimeout(auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL),1000,"Saved sign-in storage is slow");}
  catch(error){console.warn("FISO FID: saved sign-in storage unavailable; Firebase session authentication is still required.");}
  // Operational assets are requested only after authenticated explicit entry.
}

function makePassword(len=18){
  const alpha="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const arr=new Uint32Array(len); crypto.getRandomValues(arr);
  return Array.from(arr,n=>alpha[n%alpha.length]).join("");
}

const _ffExternalScriptPromises=new Map();
function loadExternalScriptOnce(src,testFn,options={}){
  if(options.signal?.aborted)return Promise.reject(new Error("Secure sign-in connection cancelled"));
  try{if(testFn&&testFn())return Promise.resolve(true)}catch(e){}
  if(_ffExternalScriptPromises.has(src))return _ffExternalScriptPromises.get(src);
  const p=new Promise((resolve,reject)=>{
    const el=document.createElement("script");let settled=false,timer;
    function finish(error){
      if(settled)return;settled=true;clearTimeout(timer);
      options.signal?.removeEventListener("abort",cancel);el.onload=el.onerror=null;
      if(error){el.remove();reject(error)}else resolve(true);
    }
    function cancel(){finish(new Error("Secure sign-in connection cancelled"));}
    options.signal?.addEventListener("abort",cancel,{once:true});
    timer=setTimeout(()=>finish(new Error("Secure sign-in library timed out")),options.timeout||12000);
    if(options.authSource){
      // Fetch can be aborted; a removed external <script> can still leave a
      // coalesced network request pending, or execute after a later retry.
      const url=src+(src.includes("?")?"&":"?")+"ffapp_auth_attempt="+options.attempt;
      fetch(url,{signal:options.signal,credentials:"omit",cache:"no-store"}).then(async response=>{
        if(!response.ok||!/(?:java|ecma)script/i.test(response.headers.get("content-type")||""))throw new Error("Secure sign-in library download failed");
        const code=await response.text();
        if(settled||options.signal?.aborted)return;
        if(code.length>1024*1024)throw new Error("Secure sign-in library response too large");
        el.textContent=code;document.head.appendChild(el);
        if(testFn&&!testFn())throw new Error("Secure sign-in library unavailable after loading");
        finish();
      }).catch(finish);
    }else{
      el.src=src;el.async=true;el.crossOrigin="anonymous";
      el.onload=()=>{try{if(testFn&&!testFn())throw new Error("Loaded but dependency unavailable: "+src);finish()}catch(e){finish(e)}};
      el.onerror=()=>finish(new Error("Failed to load "+src));
      document.head.appendChild(el);
    }
  }).catch(err=>{if(_ffExternalScriptPromises.get(src)===p)_ffExternalScriptPromises.delete(src);throw err});
  _ffExternalScriptPromises.set(src,p);return p;
}
function ensureOperationalRuntime(){
  return Promise.all([
    loadExternalScriptOnce("https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js",()=>typeof firebase!=="undefined"&&typeof firebase.database==="function"),
    loadExternalScriptOnce("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",()=>typeof window.L!=="undefined"&&typeof window.L.map==="function")
  ]);
}
window.ffappLoadFirebaseMessaging=function(){
  return Promise.reject(new Error("Push notifications are suspended in Release 315"));
};
window.ffappLoadXlsx=function(){
  return loadExternalScriptOnce("https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js",()=>typeof window.XLSX!=="undefined");
};
window.ffappLoadGeoTiff=function(){
  return loadExternalScriptOnce("https://unpkg.com/geotiff@2.1.3/dist-browser/geotiff.js",()=>typeof window.GeoTIFF!=="undefined");
};
const FFAPP_BUILD_VERSION="456";
window.FFAPP_BUILD_VERSION=FFAPP_BUILD_VERSION;
const CHANGED_OPERATIONAL_ASSETS=new Set(["app.js","aircraft-track.js","hazdam.js","notam-schedule.js","dev456-history-ui.js"]);
function buildAsset(name){ if(name==="aviationdata.js"||name==="hazdam.js")return name+"?v=dev461-2"; if(name==="app.js")return name+"?v=dev461-1"; if(name==="notam-schedule.js")return name+"?v=472"; return name + "?v=" + (CHANGED_OPERATIONAL_ASSETS.has(name)?FFAPP_BUILD_VERSION:(name==="notamengine.js"?"468":"447")); }
const CORE_OPERATIONAL_SOURCES=[
  // Only code required to draw and operate the initial map blocks first paint.
  buildAsset("notam-history.js"),buildAsset("aip_airfields_20260903.js"),buildAsset("notamengine.js"),buildAsset("metarengine.js"),buildAsset("laas_airfields_2017.js"),buildAsset("notam-schedule.js"),"todays-notams.js?v=472","notam-annotations.js?v=472","notam-shared.js?v=472","notam-plot-references.js?v=472","airfield-map-labels.js?v=472","todays-notams-page.js?v=472","info-pin.js?v=463","airfield-info.js?v=463","vendor/geographiclib-geodesic.min.js?v=2.2.0","tda-geometry.js?v=dev461-1",buildAsset("app.js")
];
const DEFERRED_OPERATIONAL_SOURCES=[
  "dev457-dashboard.js?v=1",
  // Server-track viewing has no dependency on heavier operational secondary modules.
  buildAsset("aircraft-track.js"),buildAsset("dev456-history-ui.js"),
  // Static DA data and conflict/HAZDAM functionality load immediately after first paint.
  buildAsset("aviationdata.js"),buildAsset("geometry.js"),buildAsset("conflictengine.js"),buildAsset("hazdam.js"),buildAsset("data/uk-cas-vector.js"),
  // Editing/library helpers are useful but do not need to delay the initial map.
  buildAsset("customlocations.js"),buildAsset("flightroutes.js")
];
const OPERATIONAL_SOURCES=CORE_OPERATIONAL_SOURCES.concat(DEFERRED_OPERATIONAL_SOURCES);
let operationalWarmStarted=false;
let deferredOperationalPromise=null;
function warmOperationalAssets(){
  assertEntry();
  if(operationalWarmStarted)return;operationalWarmStarted=true;
  CORE_OPERATIONAL_SOURCES.forEach(src=>{const l=document.createElement('link');l.rel='preload';l.as='script';l.href=window.FISO_STARTUP_RECOVERY?.assetUrl(src)||src;document.head.appendChild(l);});
}
function loadClassicScript(src,timeoutMs){
  assertEntry();
  timeoutMs=timeoutMs||12000;
  return new Promise((resolve,reject)=>{
    const el=document.createElement("script");
    let settled=false;
    const executionError=event=>{
      if(settled||event.filename!==el.src)return;
      settled=true;clearTimeout(timer);window.removeEventListener('error',executionError);
      const error=new Error('Startup code could not finish: '+src);error.requiresFreshPage=true;reject(error);
    };
    window.addEventListener('error',executionError);
    const timer=setTimeout(()=>{
      if(settled)return;settled=true;window.removeEventListener('error',executionError);
      try{el.remove();}catch(e){}
      const error=new Error("Timed out loading "+src);error.requiresFreshPage=true;reject(error);
    },timeoutMs);
    el.src=window.FISO_STARTUP_RECOVERY?.assetUrl(src)||src;el.async=false;
    el.onload=()=>{if(settled)return;settled=true;clearTimeout(timer);window.removeEventListener('error',executionError);try{assertEntry();resolve(src)}catch(e){reject(e)}};
    el.onerror=()=>{if(settled)return;settled=true;clearTimeout(timer);window.removeEventListener('error',executionError);el.remove();reject(new Error("Failed to load "+src));};
    document.body.appendChild(el);
  });
}
async function loadScriptWithRetry(src){
  try{return await loadClassicScript(src,10000);}
  catch(firstErr){
    if(firstErr.requiresFreshPage)throw firstErr;
    console.warn("FISO FID script load retry",src,firstErr);
    const sep=src.indexOf("?")>=0?"&":"?";
    return loadClassicScript(src+sep+"retry="+Date.now(),12000);
  }
}
async function loadScriptsSequentially(sources,onProgress,offset,total){
  offset=offset||0; total=total||sources.length;
  for(let i=0;i<sources.length;i++){
    const src=sources[i];
    // Yield between background modules so touch input and map rendering can run on mobile.
    if(offset>0)await new Promise(resolve=>{
      if(typeof requestIdleCallback==="function")requestIdleCallback(resolve,{timeout:200});
      else setTimeout(resolve,0);
    });
    if(onProgress)onProgress(offset+i,total,src,"loading");
    await loadScriptWithRetry(src);
    if(onProgress)onProgress(offset+i+1,total,src,"loaded");
  }
}

function waitForOperationalMap(timeoutMs){
  timeoutMs=timeoutMs||3200;
  const started=performance.now();
  return new Promise(resolve=>{
    (function check(){
      try{
        const m=window.FISO_FID_MAP;
        const c=document.getElementById("map");
        if(m && c && c.querySelector(".leaflet-map-pane")){
          try{m.invalidateSize({pan:false,animate:false});}catch(_e){}
          return resolve(true);
        }
      }catch(_e){}
      if(performance.now()-started>=timeoutMs)return resolve(false);
      setTimeout(check,90);
    })();
  });
}

function loadDeferredOperationalModules(){
  if(!gateAllowed())return Promise.resolve(false);
  if(deferredOperationalPromise)return deferredOperationalPromise;
  deferredOperationalPromise=loadScriptsSequentially(DEFERRED_OPERATIONAL_SOURCES,function(done,total,src,state){
    console.info("FISO FID deferred module",state,src,done+"/"+total);
  },CORE_OPERATIONAL_SOURCES.length,OPERATIONAL_SOURCES.length).then(function(){
    try{window.dispatchEvent(new CustomEvent("ffapp-deferred-modules-ready"));}catch(e){}
    try{window.renderControlledAirspaceReference?.();}catch(e){console.warn("CAS deferred render failed",e)}
    return true;
  }).catch(function(err){
    // Do not strand the application at login if a secondary module cannot load.
    console.error("Deferred operational module load failed",err);
    deferredOperationalPromise=null;
    return false;
  });
  return deferredOperationalPromise;
}
let workspacePromise=null;
const workspaceStylePromises=new Map();
function loadWorkspaceStyle(href){
  if(workspaceStylePromises.has(href))return workspaceStylePromises.get(href);
  const promise=new Promise((resolve,reject)=>{
    const el=document.createElement("link");el.rel="stylesheet";el.href=window.FISO_STARTUP_RECOVERY?.assetUrl(href)||href;
    const timer=setTimeout(()=>{el.remove();reject(new Error("Workspace stylesheet timed out"));},10000);
    el.onload=()=>{clearTimeout(timer);resolve();};
    el.onerror=()=>{clearTimeout(timer);el.remove();reject(new Error("Workspace stylesheet unavailable"));};
    document.head.appendChild(el);
  }).catch(error=>{workspaceStylePromises.delete(href);throw error;});
  workspaceStylePromises.set(href,promise);return promise;
}
function ensureWorkspace(){
  assertEntry();
  if(workspacePromise)return workspacePromise;
  workspacePromise=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const htmlPromise=fetch(window.FISO_STARTUP_RECOVERY?.assetUrl("workspace.html?v=472")||"workspace.html?v=472",{signal:controller.signal,cache:"no-store"}).then(response=>{
        if(!response.ok)throw new Error("Workspace HTTP "+response.status);return response.text();
      });
      const [html]=await Promise.all([htmlPromise,
        loadWorkspaceStyle("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"),
        loadWorkspaceStyle("styles.css?v=472"),loadWorkspaceStyle("workspace.css?v=451")]);
      if(!html.includes('id="map"')||/<script\b/i.test(html))throw new Error("Invalid operational workspace");
      assertEntry();$("workspaceMount").innerHTML=html;
      wireWorkspaceUi();
      performance.mark("ffapp-workspace-ready");
    }finally{clearTimeout(timer);}
  })().catch(error=>{workspacePromise=null;throw error;});
  return workspacePromise;
}

let operationalLoadPromise=null,operationalStartupFailed=false;
function loadOperationalApp(){
  assertEntry();
  if(operationalLoaded)return Promise.resolve();
  if(operationalLoadPromise)return operationalLoadPromise;
  operationalLoadPromise=performOperationalLoad().finally(()=>{operationalLoadPromise=null;});
  return operationalLoadPromise;
}
async function performOperationalLoad(){
  loadingOperational=true;
  const t0=performance.now();
  performance.mark("ffapp-authorised-start");
  try{
    setMessage("Preparing map…","");
    startupShow("Preparing operational map…",12,"Loading map and shared-data services");
    assertEntry();warmOperationalAssets();
    await Promise.all([ensureWorkspace(),ensureOperationalRuntime()]);
    const tDeps=performance.now();
    startupUpdate("Operational services connected",28,"Loading core FISO FID map");
    setMessage("Loading FISO FID… 0%","");
    await loadScriptsSequentially(CORE_OPERATIONAL_SOURCES,(done,total,src,state)=>{
      const ratio=done/CORE_OPERATIONAL_SOURCES.length;
      const pct=Math.round(28+(ratio*58));
      const label=src?src.split("?")[0].replace(".js",""):"core";
      setMessage("Loading FISO FID… "+Math.round(ratio*100)+"% · "+label,"");
      startupUpdate("Loading "+label+"…",pct,"Preparing operational map and controls");
    },0,CORE_OPERATIONAL_SOURCES.length);
    startupUpdate("Finalising operational map…",90,"Checking map engine and initial layout");
    const mapReady=await waitForOperationalMap(3200);
    if(!mapReady)throw new Error("Map did not initialise. Please retry entry.");
    try{sessionStorage.removeItem("ffapp_map_coldstart_recovery_v1");}catch(_e){}
    assertEntry();operationalLoaded=true;
    startupUpdate("Rendering operational workspace…",92,"Applying user permissions and map layout");
    setMessage("FISO FID ready","ok");
    applyCurrentRoleToApp();
    console.info("FISO FID startup timing",{dependenciesMs:Math.round(tDeps-t0),coreScriptsMs:Math.round(performance.now()-tDeps),totalToFirstPaintMs:Math.round(performance.now()-t0)});
  }finally{loadingOperational=false}
}

function applyCurrentRoleToApp(){
  const role=roleFromClaims(currentClaims);
  try{sessionStorage.setItem("ffapp_simple_role_v1",role)}catch(e){}
  window.setFFAppAuthenticatedRole?.(role);
  const toggle=$("adminAccessToggle");
  const isViewer=role==="viewer"||role==="vieweredit";
  if(toggle){toggle.hidden=isViewer;toggle.dataset.authManaged="true";toggle.textContent=role==="admin"?"ADMIN":(isViewer?"VIEW":"OPERATOR")}
  const hn=$("ffauthHeaderNumber"),hr=$("ffauthHeaderRole"),ma=$("ffauthManageUsersBtn"),ha=$("headerSessionActions"),hl=$("headerRoleLabel");
  if(hn)hn.textContent=isViewer?"Viewer":(currentClaims&&currentClaims.userNumber?`User ${currentClaims.userNumber}`:"Signed in");
  if(hr)hr.textContent=role==="admin"?"ADMIN":(isViewer?"VIEWER":"OPERATIONAL");
  if(ma)ma.hidden=role!=="admin";
  if(ha)ha.hidden=false;
  if(hl)hl.textContent=role==="admin"?"ADMIN":(isViewer?"VIEWER":"OPERATOR");
  window.dispatchEvent(new CustomEvent("ffapp-role-change",{detail:{role,userNumber:currentClaims&&currentClaims.userNumber||null}}));
}

async function recordLogin(user,claims){
  try{
    await callable("recordLogin")({
      userNumber:claims.userNumber,
      userAgent:navigator.userAgent,
      appVersion:String(window.FISOFID_DEV_RELEASE||"290"),
      language:navigator.language||"",
      screen:screen&&screen.width?`${screen.width}x${screen.height}`:""
    });
  }catch(e){console.warn("Login audit notification failed",e)}
}

async function requirePasswordChange(user,claims){
  return new Promise((resolve,reject)=>{
    const wrap=document.createElement("div");wrap.className="ffauth-user-modal";
    wrap.innerHTML=`<div class="ffauth-user-dialog" style="width:min(520px,96vw)">
      <div class="ffauth-user-title"><h2>CHANGE TEMPORARY PASSWORD</h2></div>
      <p class="small">Choose a new private password before entering FISO FID.</p>
      <label>NEW PASSWORD</label><input id="ffauthNewPw1" type="password" autocomplete="new-password">
      <label>CONFIRM PASSWORD</label><input id="ffauthNewPw2" type="password" autocomplete="new-password">
      <div class="ffauth-actions"><button class="btn primary" id="ffauthChangePwBtn">SAVE NEW PASSWORD</button><button class="btn" id="ffauthChangePwLogout">LOG OUT</button></div>
      <p class="ffauth-message" id="ffauthChangePwMsg"></p></div>`;
    document.body.appendChild(wrap);
    const msg=wrap.querySelector("#ffauthChangePwMsg");
    wrap.querySelector("#ffauthChangePwLogout").onclick=async()=>{await auth.signOut();wrap.remove();reject(new Error("Signed out"))};
    wrap.querySelector("#ffauthChangePwBtn").onclick=async e=>{
      const btn=e.currentTarget,p1=wrap.querySelector("#ffauthNewPw1").value,p2=wrap.querySelector("#ffauthNewPw2").value;
      if(p1.length<10){msg.textContent="Use at least 10 characters.";msg.className="ffauth-message err";return}
      if(p1!==p2){msg.textContent="Passwords do not match.";msg.className="ffauth-message err";return}
      btn.disabled=true;msg.textContent="Saving…";
      try{
        await user.updatePassword(p1);
        await callable("completeFirstLoginPasswordChange")({});
        await user.getIdToken(true);
        wrap.remove();resolve();
      }catch(err){msg.textContent=friendlyAuthError(err);msg.className="ffauth-message err";btn.disabled=false}
    };
  });
}

async function handleSignedIn(user,{freshLogin=false,epoch=sessionEpoch}={}){
  // Permission checks never fetch or execute operational assets.

  async function readClaims(force){
    const token=await withTimeout(user.getIdTokenResult(!!force),6500,"Account permission check timed out");
    const claims=token.claims||{};
    if(!claims.userNumber){
      const m=String(user.email||"").match(/^(\d{3,10})@fisofid\.(?:internal|local)$/i);
      if(m)claims.userNumber=m[1];
    }
    if(!claims.role){
      if(claims.admin===true)claims.role="Admin";
      else if(claims.operational===true)claims.role="Operational";
    }
    return claims;
  }
  viewOnlySession=false;window.FISO_VIEW_ONLY_AUTHENTICATED_READ=false;
  currentClaims=await readClaims(false);
  // Only pay for an extra token network refresh when role claims are genuinely absent.
  if(!currentClaims.userNumber||!currentClaims.role)currentClaims=await readClaims(true);
  if(!currentClaims.userNumber||!currentClaims.role){
    await auth.signOut(); throw new Error("This account has no FISO FID role. Contact an administrator.");
  }
  if(currentClaims.forcePasswordChange===true){
    await requirePasswordChange(user,currentClaims);
    currentClaims=await readClaims(true);
  }
  if(epoch!==sessionEpoch)throw new Error('Sign-in attempt expired.');
  readyForView(user);
  if(freshLogin)recordLogin(user,currentClaims);

}

async function enterViewOnly(){
  if(authenticationBusy())return;
  authBusy=true;restoreSessionAllowed=false;
  const epoch=++sessionEpoch;performance.mark('ffapp-auth-start');setAuthControlsReady(false);
  setMessage('Signing in as viewer…','');
  try{
    await ensureAuthReady();if(epoch!==sessionEpoch)throw new Error('Sign-in attempt expired.');
    const cred=await runAuthMutation(async()=>{
      if(auth.currentUser&&!auth.currentUser.isAnonymous)await auth.signOut();
      return auth.signInAnonymously();
    },epoch,'Viewer sign-in timed out. Please retry.');
    if(epoch!==sessionEpoch||!cred?.user?.isAnonymous)throw new Error('Viewer authentication did not complete.');
    viewOnlySession=true;currentClaims={role:'ViewOnly',userNumber:'VIEW'};
    window.FISO_VIEW_ONLY_AUTHENTICATED_READ=true;readyForView(cred.user);
  }catch(error){if(epoch===sessionEpoch){closeEntry();setMessage(friendlyAuthError(error),'err');await clearFailedAuthSession();}}
  finally{authBusy=false;setAuthControlsReady(true);}
}

async function signIn(){
  const n=cleanNumber($("ffauthUserNumber")?.value),pw=$("ffauthPassword")?.value||"";
  if(!/^\d{3,10}$/.test(n)){setMessage("Enter your allocated user number.","err");return}
  if(!pw){setMessage("Enter your password.","err");return}
  if(authenticationBusy())return;
  restoreSessionAllowed=false;signInInProgress=true;setAuthControlsReady(false);
  const epoch=++sessionEpoch;performance.mark("ffapp-auth-start");setMessage("Signing in…","");
  try{
    await ensureAuthReady();if(epoch!==sessionEpoch)throw new Error('Sign-in attempt expired.');
    let result;
    try{result=await runAuthMutation(()=>auth.signInWithEmailAndPassword(emailForNumber(n),pw),epoch,"Secure sign-in timed out");}
    catch(primaryErr){
      const code=String(primaryErr&&primaryErr.code||"");
      const canTryLegacy=code.includes("invalid-credential")||code.includes("wrong-password")||code.includes("user-not-found");
      if(!canTryLegacy||epoch!==sessionEpoch)throw primaryErr;
      result=await runAuthMutation(()=>auth.signInWithEmailAndPassword(legacyEmailForNumber(n),pw),epoch,"Secure sign-in timed out");
    }
    if(epoch!==sessionEpoch)throw new Error('Sign-in attempt expired.');
    startupUpdate("Account verified…",22,"Loading account permissions");
    await withTimeout(handleSignedIn(result.user,{freshLogin:true,epoch}),22000,"FISO FID startup timed out");
    if($("ffauthPassword"))$("ffauthPassword").value="";
  }catch(error){if(epoch===sessionEpoch){closeEntry();setMessage(friendlyAuthError(error),"err");startupHide();await clearFailedAuthSession();}}
  finally{signInInProgress=false;setAuthControlsReady(true);}
}

async function requestReset(){
  const n=cleanNumber($("ffauthUserNumber")?.value);
  if(!/^\d{3,10}$/.test(n)){setMessage("Enter your user number first.","err");return}
  setMessage("Sending reset request…","");
  try{await ensureAuthReady();await callable("requestPasswordReset")({userNumber:n});setMessage("Reset request sent to the FISO FID administrator.","ok")}
  catch(e){setMessage("Unable to send the reset request.","err")}
}

async function logout(){
  const hadOperations=operationalLoaded||loadingOperational;restoreSessionAllowed=false;closeEntry();
  setAuthControlsReady(false);
  try{
    if(authMutation){authMutation.expired=true;await withTimeout(authMutation.promise,10000,"Previous sign-in is still completing").catch(()=>{});}
    await clearFailedAuthSession();
  }finally{
    currentClaims=null;setAuthControlsReady(true);
    const pop=$("adminAccessPopover");if(pop)pop.hidden=true;
    const ha=$("headerSessionActions");if(ha)ha.hidden=true;
    showOverlay(true);if(hadOperations)window.location.reload();
  }
}

function buildManageModal(){
  if(manageModal)return manageModal;
  const modal=document.createElement("div");modal.className="ffauth-user-modal";modal.hidden=true;
  modal.innerHTML=`<div class="ffauth-user-dialog">
    <div class="ffauth-user-title"><h2>FISO FID USERS</h2><button id="ffauthUsersClose" aria-label="Close">&times;</button></div>
    <div class="ffauth-user-form">
      <div><label>USER NUMBER</label><input id="ffauthEditNumber" inputmode="numeric" maxlength="10"></div>
      <div><label>NAME</label><input id="ffauthEditName"></div>
      <div><label>ROLE</label><select id="ffauthEditRole"><option value="Operational">Operational</option><option value="Admin">Admin</option></select></div>
      <div><label>TEMP PASSWORD (new/reset only)</label><div class="ffauth-password-row"><input id="ffauthEditPassword"><button id="ffauthGeneratePw">GENERATE</button></div></div>
    </div>
    <label class="ffauth-check"><input type="checkbox" id="ffauthForcePw" checked> Force password change on next login</label>
    <div class="ffauth-actions"><button class="btn primary" id="ffauthSaveUser">ADD / UPDATE USER</button><button class="btn" id="ffauthClearUser">CLEAR</button></div>
    <p id="ffauthUsersMsg" class="ffauth-message"></p>
    <div id="ffauthUserList" class="ffauth-user-list"></div>
  </div>`;
  document.body.appendChild(modal);manageModal=modal;
  modal.querySelector("#ffauthUsersClose").onclick=()=>modal.hidden=true;
  modal.querySelector("#ffauthClearUser").onclick=clearUserForm;
  modal.querySelector("#ffauthGeneratePw").onclick=e=>{e.preventDefault();modal.querySelector("#ffauthEditPassword").value=makePassword()};
  modal.querySelector("#ffauthSaveUser").onclick=saveManagedUser;
  return modal;
}
function clearUserForm(){
  if(!manageModal)return;
  ["ffauthEditNumber","ffauthEditName","ffauthEditPassword"].forEach(id=>manageModal.querySelector("#"+id).value="");
  manageModal.querySelector("#ffauthEditRole").value="Operational";manageModal.querySelector("#ffauthForcePw").checked=true;
}
function usersMessage(text,type=""){const el=manageModal&&manageModal.querySelector("#ffauthUsersMsg");if(el){el.textContent=text;el.className="ffauth-message "+type}}
async function openManageUsers(){
  if(roleFromClaims(currentClaims)!=="admin")return;
  const m=buildManageModal();m.hidden=false;usersMessage("Loading…");
  try{const r=await callable("listUsers")({});renderUsers(r.data.users||[]);usersMessage("")}
  catch(e){usersMessage("Unable to load users: "+friendlyAuthError(e),"err")}
}
function renderUsers(users){
  const list=manageModal.querySelector("#ffauthUserList");
  if(!users.length){list.innerHTML='<p class="small">No users found.</p>';return}
  list.innerHTML=users.map(u=>`<div class="ffauth-user-row" data-user="${String(u.userNumber).replace(/[^0-9]/g,"")}">
    <strong>${u.userNumber}</strong><span>${String(u.name||"").replace(/[&<>]/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[s]))}</span><span>${u.role||"Operational"}</span><span>${u.enabled===false?"DISABLED":"ENABLED"}</span>
    <span><button data-a="edit">EDIT</button><button data-a="reset">RESET PASSWORD</button><button data-a="toggle">${u.enabled===false?"ENABLE":"DISABLE"}</button><button data-a="delete">DELETE</button></span></div>`).join("");
  list.querySelectorAll(".ffauth-user-row").forEach((row,i)=>{
    const u=users[i];
    row.querySelector('[data-a="edit"]').onclick=()=>{manageModal.querySelector("#ffauthEditNumber").value=u.userNumber;manageModal.querySelector("#ffauthEditName").value=u.name||"";manageModal.querySelector("#ffauthEditRole").value=u.role==="Admin"?"Admin":"Operational";manageModal.querySelector("#ffauthEditPassword").value=""};
    row.querySelector('[data-a="reset"]').onclick=()=>resetManagedPassword(u.userNumber);
    row.querySelector('[data-a="toggle"]').onclick=()=>toggleManagedUser(u.userNumber,u.enabled===false);
    row.querySelector('[data-a="delete"]').onclick=()=>deleteManagedUser(u.userNumber);
  });
}
async function refreshManagedUsers(){const r=await callable("listUsers")({});renderUsers(r.data.users||[])}
async function saveManagedUser(){
  const n=cleanNumber(manageModal.querySelector("#ffauthEditNumber").value),name=manageModal.querySelector("#ffauthEditName").value.trim(),role=manageModal.querySelector("#ffauthEditRole").value,password=manageModal.querySelector("#ffauthEditPassword").value,force=manageModal.querySelector("#ffauthForcePw").checked;
  if(!/^\d{3,10}$/.test(n)||!name){usersMessage("User number and name are required.","err");return}
  usersMessage("Saving…");
  try{await callable("upsertUser")({userNumber:n,name,role,password,forcePasswordChange:force});usersMessage("User saved.","ok");clearUserForm();await refreshManagedUsers()}
  catch(e){usersMessage(friendlyAuthError(e),"err")}
}
async function resetManagedPassword(n){
  const pw=makePassword();
  if(!confirm(`Reset password for ${n}? A new temporary password will be generated.`))return;
  try{await callable("adminResetPassword")({userNumber:n,newPassword:pw});await navigator.clipboard?.writeText(pw).catch(()=>{});alert(`Temporary password for ${n}:\n\n${pw}\n\nIt has also been copied to the clipboard where supported.`);await refreshManagedUsers()}
  catch(e){usersMessage(friendlyAuthError(e),"err")}
}
async function toggleManagedUser(n,enable){
  if(!confirm(`${enable?"Enable":"Disable"} user ${n}?`))return;
  try{await callable("setUserEnabled")({userNumber:n,enabled:enable});await refreshManagedUsers()}
  catch(e){usersMessage(friendlyAuthError(e),"err")}
}
async function deleteManagedUser(n){
  if(!confirm(`Permanently delete user ${n}?`))return;
  try{await callable("deleteUser")({userNumber:n});await refreshManagedUsers()}
  catch(e){usersMessage(friendlyAuthError(e),"err")}
}

function wireUi(){
  const user=$("ffauthUserNumber"),pw=$("ffauthPassword"),login=$("ffauthLoginBtn"),show=$("ffauthShowPassword"),reset=$("ffauthResetRequestBtn");
  if(user)user.addEventListener("input",()=>{user.value=cleanNumber(user.value);});
  if(user)user.addEventListener("keydown",e=>{if(e.key==="Enter")pw?.focus()});

  if(pw)pw.addEventListener("keydown",e=>{if(e.key==="Enter")signIn()});
  if(login)login.onclick=signIn;
  $("ffauthViewBtn")?.addEventListener("click",enterOperations);
  $("ffauthBeforeViewLogoutBtn")?.addEventListener("click",logout);
  $("ffauthViewOnlyBtn")?.addEventListener("click",enterViewOnly);
  if(show)show.onclick=()=>{pw.type=pw.type==="password"?"text":"password";show.textContent=pw.type==="password"?"SHOW":"HIDE"};
  if(reset)reset.onclick=requestReset;
}

function wireWorkspaceUi(){
  $("ffauthLogoutBtn")?.addEventListener("click",logout);$("ffauthHeaderLogoutBtn")?.addEventListener("click",logout);$("ffauthSwitchUserBtn")?.addEventListener("click",logout);
  $("ffauthManageUsersBtn")?.addEventListener("click",openManageUsers);
  const toggle=$("adminAccessToggle"),pop=$("adminAccessPopover");
  if(toggle)toggle.onclick=e=>{e.stopPropagation();if(pop)pop.hidden=!pop.hidden};
  if(pop)pop.onclick=e=>e.stopPropagation();document.addEventListener("click",()=>{if(pop)pop.hidden=true});
}

async function ensureSecureAuthSdk(signal){
  const options={signal,timeout:4000,authSource:true,attempt:authBootstrapEpoch};
  await loadExternalScriptOnce("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",()=>typeof firebase!=="undefined"&&typeof firebase.initializeApp==="function",options);
  await loadExternalScriptOnce("https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js",()=>typeof firebase!=="undefined"&&typeof firebase.auth==="function",options);
}
function setAuthControlsReady(ready){
  ["ffauthLoginBtn","ffauthViewOnlyBtn","ffauthResetRequestBtn"].forEach(id=>{if($(id))$(id).disabled=!ready;});
}
function authenticationBusy(){
  if(authBusy||signInInProgress||authMutation){
    if(authMutation?.expired)setMessage("Previous secure sign-in is still completing. Please wait or reload before retrying.","err");
    return true;
  }
  return false;
}
async function runAuthMutation(task,epoch,label){
  if(authMutation)throw new Error("Previous secure sign-in is still completing. Please wait before retrying.");
  const operation={expired:false,promise:null};authMutation=operation;
  operation.promise=(async()=>{
    try{
      const result=await task();
      if(operation.expired||epoch!==sessionEpoch){
        // Firebase credential requests cannot be aborted. Quarantine a late result
        // and finish sign-out before permitting another mutating auth request.
        if(auth.currentUser)await auth.signOut();
        throw new Error("Sign-in attempt expired. Please retry.");
      }
      return result;
    }finally{if(authMutation===operation)authMutation=null;}
  })();
  try{return await withTimeout(operation.promise,10000,label);}
  catch(error){operation.expired=true;throw error;}
}
async function clearFailedAuthSession(){
  if(authMutation||!auth?.currentUser)return;
  await runAuthMutation(()=>auth.signOut(),sessionEpoch,"Sign-out timed out. Please retry.").catch(()=>{});
}
function installAuthObserver(){
  if(authUnsubscribe)return;
  const observer=++authObserverEpoch;let resolved=false;authStateKnown=false;
  clearTimeout(authWatchdog);
  authWatchdog=setTimeout(()=>{
    if(resolved||observer!==authObserverEpoch||authBusy||signInInProgress)return;
    setMessage("Saved sign-in is taking longer than expected. You can sign in or use VIEW APP.","");
    showOverlay(true);startupHide();
    // A UI watchdog is not evidence of an invalid Firebase session.
  },3500);
  const unsubscribe=auth.onAuthStateChanged(async user=>{
    if(observer!==authObserverEpoch)return;
    resolved=true;authStateKnown=true;clearTimeout(authWatchdog);
    if(authBusy||signInInProgress||authMutation)return;
    if((user?.uid||null)!==(auth.currentUser?.uid||null))return;
    if(!user){const had=operationalLoaded||loadingOperational;closeEntry();if(had)window.location.reload();return;}
    if(authenticatedUser?.uid===user.uid)return;
    if(!restoreSessionAllowed){closeEntry();setMessage("Session changed. Please sign in or use VIEW APP.","");return;}
    const epoch=++sessionEpoch;authBusy=true;setAuthControlsReady(false);
    try{
      if(auth.currentUser?.uid!==user.uid)return;
      if(user.isAnonymous){viewOnlySession=true;currentClaims={role:'ViewOnly',userNumber:'VIEW'};window.FISO_VIEW_ONLY_AUTHENTICATED_READ=true;readyForView(user);}
      else await withTimeout(handleSignedIn(user,{freshLogin:false,epoch}),7000,'Saved session verification timed out.');
    }catch(error){if(epoch===sessionEpoch){closeEntry();setMessage(friendlyAuthError(error),'err');await clearFailedAuthSession();}}
    finally{authBusy=false;setAuthControlsReady(true);}
  },error=>{
    if(observer!==authObserverEpoch)return;
    ++authObserverEpoch;authStateKnown=false;clearTimeout(authWatchdog);authUnsubscribe?.();authUnsubscribe=null;
    closeEntry();setMessage("Secure session check unavailable. Please retry sign-in.","err");setAuthControlsReady(true);startupHide();
  });
  if(observer===authObserverEpoch)authUnsubscribe=unsubscribe;else unsubscribe?.();
}
function ensureAuthReady(){
  if(authBootstrapPromise)return authBootstrapPromise;
  if(auth){installAuthObserver();return authUnsubscribe?Promise.resolve(auth):Promise.reject(new Error("Secure session check unavailable. Please retry."));}
  const attempt=++authBootstrapEpoch,abort=new AbortController();authBootstrapAbort=abort;
  const promise=(async()=>{
    try{
      await withTimeout(ensureSecureAuthSdk(abort.signal),4500,"Secure sign-in libraries timed out. Please retry.");
      if(abort.signal.aborted||attempt!==authBootstrapEpoch)throw new Error("Secure sign-in attempt expired");
      await initFirebase();
      if(attempt!==authBootstrapEpoch)throw new Error("Secure sign-in attempt expired");
      installAuthObserver();if(!authUnsubscribe)throw new Error("Secure session check unavailable. Please retry.");return auth;
    }catch(error){abort.abort();throw error;}
    finally{if(authBootstrapPromise===promise)authBootstrapPromise=null;if(authBootstrapAbort===abort)authBootstrapAbort=null;}
  })();
  authBootstrapPromise=promise;return promise;
}
async function init(){
  wireUi();showOverlay(true);setAuthControlsReady(false);setMessage("Connecting secure sign-in…","");
  try{
    await ensureAuthReady();
    if(!authenticatedUser&&!authBusy&&!signInInProgress){
      if(authStateKnown)setMessage("Sign in or use SIGN IN AS VIEWER.","");
      else{setMessage("Checking secure session…","");startupUpdate("Checking secure session…",18,"Verifying saved sign-in");}
    }
  }catch(error){setMessage("Secure sign-in unavailable. Check your connection, then use SIGN IN or SIGN IN AS VIEWER to retry.","err");showOverlay(true);startupHide();}
  finally{if(!authBusy&&!signInInProgress)setAuthControlsReady(true);}
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
