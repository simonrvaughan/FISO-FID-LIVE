console.info("HAZDAM Release 236 loaded");
"use strict";
/****************************************************************************
 HAZDAM
 Hazard & Danger Area Management

 Version : 0.2.7-release027
 Build   : 2026-06-30
 Status  : Development / Firebase operational sync

 Changes
 --------
 • Added independent operational data for each D201 danger area.
 • Added polygon and label selection.
 • Added HAZDAM side-panel details.
 • Added ADMIN edit controls for state, levels, times, source and notes.
 • Added operator read-only view.
 • Added time-controlled effective states.
 • If valid start/end UTC times are entered, they override manual state.
 • Pending begins 15 minutes before start and flashes red once per second.
 • Active uses translucent red fill.
 • Fixed editor stability so the scheduler no longer overwrites the edit form.
 • Added edit-mode lock with Save and Cancel.
 • Added a working copy so Cancel discards changes safely.
 • Added basic validation for UTC times and level fields.
 • Added information popups when clicking a danger area polygon or label.
 • Popups include operational times, levels, notes and AIP reference information.
 • Build 019.1: Added Firebase Realtime Database operational sync via
   fiso/fisoradar_hazdam_state_v1/<EGD201x>.
 • Saves write only the selected danger area.
 • Remote Firebase updates update the local operational object and redraw HAZDAM.
 • No aircraft flashing, strip flashing or ACK logic is changed in this release.
 • Release 027: DEV test aircraft disabled; conflicts now use live radar traffic only.
****************************************************************************/
(function(){
  const VERSION = "0.4.0-release040";
  const LS_KEY = "hazdam_operational_v015";
  const LS_KEY_PREFS = "hazdam_user_preferences_v1";
  const HAZDAM_STATE = { INACTIVE:"inactive", PENDING:"pending", ACTIVE:"active" };
  const HAZDAM_CONFIG = {
    enabled: true,
    protectedSquawks: ["1177", "0027", "0030", "0037", "7400", "7500", "7600", "7700"],
    conflictBufferNm: 3.0,
    verticalToleranceFt: 500,
    pendingMinutes: 15,
    devTestAircraft: false,
    devTestScenario: "clear",
    devTestAreaId: "EGD201H",
    devTestSquawk: "1177",
    devTestAltitudeFt: 3000,
    devTestHeadingDeg: 270,
    devTestGroundspeedKt: 120
  };
  const FIREBASE_PATH = "fiso/fisoradar_hazdam_state_v1";

  function dmsToDecimal(token){
    const m = String(token).trim().match(/^(\d{2})(\d{2})(\d{2})([NS])(\d{3})(\d{2})(\d{2})([EW])$/i);
    if(!m) throw new Error("Invalid HAZDAM coordinate: " + token);
    let lat = Number(m[1]) + Number(m[2])/60 + Number(m[3])/3600;
    let lon = Number(m[5]) + Number(m[6])/60 + Number(m[7])/3600;
    if(m[4].toUpperCase()==="S") lat = -lat;
    if(m[8].toUpperCase()==="W") lon = -lon;
    return [lat, lon];
  }
  function ll(list){ return list.map(dmsToDecimal); }
  function samePoint(a,b){ return a && b && Math.abs(a[0]-b[0]) < 1e-9 && Math.abs(a[1]-b[1]) < 1e-9; }
  function safe(s){ return String(s ?? "").replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); }

  function getProtectedSquawks(){
    try {
      if (window.FFAPP_PROTECTED_SQUAWKS && typeof window.FFAPP_PROTECTED_SQUAWKS.get === "function") {
        const live = window.FFAPP_PROTECTED_SQUAWKS.get();
        if (Array.isArray(live) && live.length) return live;
      }
    } catch(e) {}
    return HAZDAM_CONFIG.protectedSquawks.slice();
  }
  function isProtectedSquawk(value){
    const sqk = String(value || "").replace(/\D/g, "").padStart(4, "0").slice(-4);
    return getProtectedSquawks().includes(sqk);
  }

  function clampPrefNumber(value, fallback, min, max){
    const n = Number(value);
    if(!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function applyConflictEnginePrefs(){
    try {
      if(window.FISO_CONFLICT_ENGINE && window.FISO_CONFLICT_ENGINE.config){
        window.FISO_CONFLICT_ENGINE.config.warningDistanceNm = HAZDAM_CONFIG.conflictBufferNm;
        window.FISO_CONFLICT_ENGINE.config.verticalToleranceFt = HAZDAM_CONFIG.verticalToleranceFt;
      }
    } catch(e) {}
  }

  function loadUserPreferences(){
    try {
      const raw = localStorage.getItem(LS_KEY_PREFS);
      if(!raw) { applyConflictEnginePrefs(); return; }
      const prefs = JSON.parse(raw);
      HAZDAM_CONFIG.enabled = prefs.enabled !== false;
      // Release212 operational standard supersedes older saved preferences.
      HAZDAM_CONFIG.conflictBufferNm = 3;
      HAZDAM_CONFIG.verticalToleranceFt = 500;
    } catch(e) {}
    HAZDAM_CONFIG.conflictBufferNm = 3;
    HAZDAM_CONFIG.verticalToleranceFt = 500;
    applyConflictEnginePrefs();
  }

  function saveUserPreferences(){
    try {
      localStorage.setItem(LS_KEY_PREFS, JSON.stringify({
        enabled: !!HAZDAM_CONFIG.enabled,
        conflictBufferNm: HAZDAM_CONFIG.conflictBufferNm,
        verticalToleranceFt: HAZDAM_CONFIG.verticalToleranceFt
      }));
    } catch(e) {}
    applyConflictEnginePrefs();
  }

  function parseHHMM(v){
    const m = String(v || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if(!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if(h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }

  function operationalNowMs(){ return window.ffappNowMs ? window.ffappNowMs() : Date.now(); }
  function operationalNowDate(){ return new Date(operationalNowMs()); }
  function utcMinutesNow(){
    const d = operationalNowDate();
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }

  function timeControlledState(op){
    const start = parseHHMM(op?.startUTC);
    const end = parseHHMM(op?.endUTC);
    if(start === null || end === null) return null;
    const now = utcMinutesNow();
    const pendingStart = (start - HAZDAM_CONFIG.pendingMinutes + 1440) % 1440;

    if(end >= start){
      if(now >= start && now < end) return HAZDAM_STATE.ACTIVE;
      if(start >= HAZDAM_CONFIG.pendingMinutes){
        if(now >= start - HAZDAM_CONFIG.pendingMinutes && now < start) return HAZDAM_STATE.PENDING;
      }else{
        if(now >= pendingStart || now < start) return HAZDAM_STATE.PENDING;
      }
      return HAZDAM_STATE.INACTIVE;
    }

    if(now >= start || now < end) return HAZDAM_STATE.ACTIVE;
    if(now >= pendingStart && now < start) return HAZDAM_STATE.PENDING;
    return HAZDAM_STATE.INACTIVE;
  }
const STATIC = window.FISO_DATA.dangerAreas || {};

// Release201: merge the complete ENR 5.1 metadata into every programmed
// Danger Area before HAZDAM calculates state, timing and vertical limits.
const ENR_META = window.FISO_ENR_DA_METADATA || {};
const ENR_MERGE_FIELDS = [
  "name", "authority", "activity", "service", "contact", "hours",
  "officialRemarks", "enrBoundary", "enrText", "enrSource", "lower", "upper"
];

for (const [id, area] of Object.entries(STATIC)) {
  const meta = ENR_META[id];
  if (!meta || !area) continue;

  for (const field of ENR_MERGE_FIELDS) {
    const value = meta[field];
    if (value != null && String(value).trim()) area[field] = value;
  }

  if (!area.source && meta.enrSource) area.source = meta.enrSource;
}

const DEFAULT_STATIC = {
    name: "UNKNOWN",
    authority: "",
    activity: "",
    service: "",
    contact: "",
    hours: "",
    officialRemarks: "",
    enrBoundary: "",
    enrText: "",
    enrSource: ""
};

for (const id of Object.keys(STATIC)) {
  STATIC[id] = { ...DEFAULT_STATIC, ...STATIC[id] };
}

  let OPERATIONAL = {};
  for (const id of Object.keys(STATIC)) OPERATIONAL[id] = defaultOp(id);

  let map = null;
  let layerGroup = null;
  let visible = true;
  let selectedId = null;
  let layersById = {};
  let currentConflicts = [];
  let lastTrafficCount = 0;
  let lastProtectedTrafficCount = 0;
  let editing = false;
  let editCopy = null;
  let fbDb = null;
  let fbReady = false;
  let fbWriting = false;
  let syncState = "local";
  let syncMessage = "Local only";
  let ackedConflicts = {};
  let devTestMarker = null;
  let conflictVectorGroup = null;

  function defaultOp(id){
    const st = STATIC[id] || {};
    const defaultState = Object.values(HAZDAM_STATE).includes(String(st.defaultState || "").toLowerCase())
      ? String(st.defaultState).toLowerCase()
      : HAZDAM_STATE.INACTIVE;
    const out = {
      state: defaultState,
      lower: st.lower || "",
      upper: st.upper || "",
      startUTC: "",
      endUTC: "",
      source: "FISFID ENR DA",
      feedMode: "auto",
      protectClear: false,
      notes: "",
      updatedBy: "",
      updatedAt: ""
    };

    // DEV419: no temporary NOTAM is seeded here. Expired temporary areas
    // are supplied only by the current PIB and disappear at Item C validity.
    return out;
  }

  function normaliseOp(id, incoming){
    const base = defaultOp(id);
    const src = incoming && typeof incoming === "object" ? incoming : {};
    const out = Object.assign(base, src);
    out.state = String(out.state || base.state).toLowerCase();
    if(!Object.values(HAZDAM_STATE).includes(out.state)) out.state = base.state;
    ["lower","upper","startUTC","endUTC","source","feedMode","notes","updatedBy","updatedAt","autoNotamId","autoSourcePage","autoValidB","autoValidC","autoScheduleD","autoNotamAction","notamId","notamSourcePage","notamB","notamC","notamD","notamText","notamAction"].forEach(k => {
      if(out[k] === null || typeof out[k] === "undefined") out[k] = base[k] || "";
      out[k] = String(out[k]);
    });
    // Dev329: one Danger Area can carry multiple PIB promulgations. Keep
    // these as structured records rather than flattening them into strings.
    out.autoActivations = Array.isArray(src.autoActivations) ? src.autoActivations.map(a => Object.assign({}, a || {})) : [];
    if(!out.source) out.source = "Manual";
    out.feedMode = String(out.feedMode || "manual").toLowerCase() === "auto" ? "auto" : "manual";
    out.protectClear = !!out.protectClear;
    return out;
  }

  function firebasePayload(id, op){
    const clean = normaliseOp(id, op);
    return {
      state: clean.state,
      lower: clean.lower,
      upper: clean.upper,
      startUTC: clean.startUTC,
      endUTC: clean.endUTC,
      source: clean.source || "Manual",
      feedMode: clean.feedMode || "manual",
      protectClear: !!clean.protectClear,
      notes: clean.notes || "",
      updatedBy: clean.updatedBy || "",
      updatedAt: clean.updatedAt || "",
      autoNotamId: clean.autoNotamId || "",
      autoSourcePage: clean.autoSourcePage || "",
      autoValidB: clean.autoValidB || "",
      autoValidC: clean.autoValidC || "",
      autoScheduleD: clean.autoScheduleD || "",
      autoNotamAction: clean.autoNotamAction || "",
      notamId: clean.notamId || "",
      notamSourcePage: clean.notamSourcePage || "",
      notamB: clean.notamB || "",
      notamC: clean.notamC || "",
      notamD: clean.notamD || "",
      notamText: clean.notamText || "",
      notamAction: clean.notamAction || "",
      autoActivations: Array.isArray(clean.autoActivations) ? clean.autoActivations : [],
      schema: 5
    };
  }

  function setSyncStatus(state, msg){
    syncState = state || "local";
    syncMessage = msg || syncMessage || "";
    const el = document.getElementById("hazdamSyncStatus");
    if(el) el.textContent = syncLabel();
  }

  function syncLabel(){
    if(syncState === "synced") return "🟢 Synced";
    if(syncState === "saving") return "🟠 Saving…";
    if(syncState === "offline") return "🔴 Offline";
    return "⚪ " + (syncMessage || "Local only");
  }

  function activePibContainsNotamId(notamId){
    var id=String(notamId||"").toUpperCase().trim();
    if(!id) return false;
    var set=window.FISO_ACTIVE_PIB_NOTAM_IDS;
    return !!(set && set[id]);
  }

  function clearAutoPibPromulgation(id, val){
    var base=Object.assign({}, val || {});
    var st=STATIC[id] || {};
    return Object.assign(base,{
      state:HAZDAM_STATE.INACTIVE, lower:st.lower||base.lower||"SFC", upper:st.upper||base.upper||"UNL",
      startUTC:"00:00", endUTC:"00:00", source:"FISFID ENR DA", feedMode:"auto",
      notes:st.hours ? ("ENR Hours: "+st.hours) : "",
      autoNotamId:"",autoSourcePage:"",autoValidB:"",autoValidC:"",autoScheduleD:"",autoNotamAction:"",
      notamId:"",notamSourcePage:"",notamB:"",notamC:"",notamD:"",notamText:"",notamAction:"",autoActivations:[]
    });
  }

  function applyRemoteOperational(id, val){
    if(!STATIC[id] || !val || typeof val !== "object") return;

    // Release275: Firebase can contain yesterday's AUTO PIB record. Never let
    // that record repopulate a Danger Area unless its NOTAM is present in the
    // single current uploaded PIB. ENR/manual geometry remains untouched.
    var remoteNotam=String(val.notamId||val.autoNotamId||"").toUpperCase().trim();
    var remoteAuto=/^AUTO PIB NOTAM\b/i.test(String(val.source||"")) || !!val.autoNotamId || String(val.updatedBy||"").toUpperCase()==="AUTO PLOT";
    if(remoteAuto && remoteNotam && !activePibContainsNotamId(remoteNotam)){
      val=clearAutoPibPromulgation(id,val);
    }

    // Release259: D129's live PIB promulgation is derived from the ACTIVE PIB,
    // not from whichever Firebase child happens to arrive last. Preserve the
    // dedicated D129 NOTAM across an ENR-only/stale remote update.
    if(id === "EGD129" && window.FISO_D129_NOTAM){
      var dn = window.FISO_D129_NOTAM;
      var cur = OPERATIONAL[id] || {};
      if(String(cur.notamId||cur.autoNotamId||"") === String(dn.notamId||"")){
        val = Object.assign({}, val, {
          lower:cur.lower||STATIC[id].lower, upper:cur.upper||STATIC[id].upper,
          startUTC:cur.startUTC||"00:00", endUTC:cur.endUTC||"00:00",
          source:cur.source||("AUTO PIB NOTAM "+dn.notamId+" — D129 ADDITIVE"), feedMode:"auto",
          notes:cur.notes||"D129 additive PIB activation.",
          autoNotamId:cur.autoNotamId||dn.notamId, autoSourcePage:cur.autoSourcePage||String(dn.sourcePage||""),
          autoValidB:cur.autoValidB||dn.b||"", autoValidC:cur.autoValidC||dn.c||"", autoScheduleD:cur.autoScheduleD||dn.d||"",
          notamId:cur.notamId||dn.notamId, notamSourcePage:cur.notamSourcePage||String(dn.sourcePage||""),
          notamB:cur.notamB||dn.b||"", notamC:cur.notamC||dn.c||"", notamD:cur.notamD||dn.d||"",
          notamText:cur.notamText||dn.raw||""
        });
      }
    }

    // A direct edit is a local operator transaction. Do not overwrite the
    // record underneath that form until SAVE/CANCEL releases the lock.
    if(directCardIsEditing(id)){
      return;
    }

    OPERATIONAL[id] = normaliseOp(id, val);
    saveOperational();
    if(layersById[id]) updateAreaLayer(id);
    if(selectedId === id && !editing){ renderPanel(); }
    checkConflicts();
  }

  function initFirebaseSync(){
    function connect(db){
      if(!db || fbReady) return;
      fbDb = db; fbReady = true;
      setSyncStatus("synced", "Firebase connected");
      const ref = fbDb.ref(FIREBASE_PATH);
      ref.on("child_added", snap => {
        applyRemoteOperational(snap.key, snap.val());
      }, err => { console.warn("HAZDAM Firebase child_added error", err); setSyncStatus("offline", "Firebase read error"); });
      ref.on("child_changed", snap => {
        applyRemoteOperational(snap.key, snap.val());
      }, err => { console.warn("HAZDAM Firebase child_changed error", err); setSyncStatus("offline", "Firebase read error"); });
      ref.on("child_removed", snap => {
        const id = snap.key;
        if(STATIC[id]){
          OPERATIONAL[id] = defaultOp(id);
          saveOperational();
          if(layersById[id]) updateAreaLayer(id);
          if(selectedId === id && !editing) renderPanel();
        }
      });
    }

    if(window.FISO_FIREBASE_DB) connect(window.FISO_FIREBASE_DB);
    else {
      setSyncStatus("local", "Waiting for Firebase");
      window.addEventListener("fiso-firebase-ready", ev => connect(ev.detail && ev.detail.db), { once:true });
      setTimeout(() => { if(!fbReady) setSyncStatus("offline", "Firebase unavailable"); }, 5000);
    }
  }

  function saveAreaToFirebase(id){
    if(!fbReady || !fbDb || !STATIC[id]){ setSyncStatus("offline", "Firebase unavailable"); return Promise.resolve(false); }
    fbWriting = true;
    setSyncStatus("saving", "Saving");
    return fbDb.ref(FIREBASE_PATH + "/" + id).set(firebasePayload(id, OPERATIONAL[id]))
      .then(() => { fbWriting = false; setSyncStatus("synced", "Saved"); return true; })
      .catch(err => { fbWriting = false; console.warn("HAZDAM Firebase save failed", err); setSyncStatus("offline", "Save failed"); return false; });
  }

  function loadOperational(){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if(raw){
        const parsed = JSON.parse(raw);
        Object.keys(STATIC).forEach(id => {
          var stored=Object.assign(defaultOp(id),parsed[id]||{});
          var src=String(stored.source||""), notes=String(stored.notes||"");
          // Release202: every programmed Danger Area is controlled by
          // FISFID ENR DA unless a current NOTAM supersedes the ENR data.
          var storedNotam=String(stored.notamId||stored.autoNotamId||"").toUpperCase().trim();
          var storedAuto=/^AUTO PIB NOTAM\b/i.test(src) || !!stored.autoNotamId || String(stored.updatedBy||"").toUpperCase()==="AUTO PLOT";
          if(storedAuto && storedNotam && !activePibContainsNotamId(storedNotam)){
            stored=clearAutoPibPromulgation(id,stored);
          } else {
            stored.feedMode="auto";
            stored.source="FISFID ENR DA";
          }
          OPERATIONAL[id]=normaliseOp(id,stored);
        });
      }
    }catch(e){ console.warn("HAZDAM: failed to load operational data", e); }
    // Immediately replace any stale saved state/times/levels with today's
    // effective ENR values. Current NOTAM promulgations are preserved.
    syncAllEffectiveEnrOperational();
  }
  function saveOperational(){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(OPERATIONAL)); }
    catch(e){ console.warn("HAZDAM: failed to save operational data", e); }
  }

  function isAdmin(){
    try{ return typeof userRole !== "undefined" && userRole === "admin"; }
    catch(e){ return false; }
  }

  function ensurePattern(){
    if(document.getElementById("hazdam-aip-pattern-defs")) return;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns,"svg");
    svg.setAttribute("id","hazdam-aip-pattern-defs");
    svg.setAttribute("width","0"); svg.setAttribute("height","0");
    svg.style.position = "absolute"; svg.style.pointerEvents = "none"; svg.style.overflow = "hidden";
    const defs = document.createElementNS(ns,"defs");

    function pattern(id, stroke, fill, width){
      const p = document.createElementNS(ns,"pattern");
      p.setAttribute("id",id); p.setAttribute("patternUnits","userSpaceOnUse");
      p.setAttribute("width","8"); p.setAttribute("height","8"); p.setAttribute("patternTransform","rotate(45)");
      const r = document.createElementNS(ns,"rect"); r.setAttribute("width","8"); r.setAttribute("height","8"); r.setAttribute("fill",fill);
      const l = document.createElementNS(ns,"line"); l.setAttribute("x1","0"); l.setAttribute("y1","0"); l.setAttribute("x2","0"); l.setAttribute("y2","8"); l.setAttribute("stroke",stroke); l.setAttribute("stroke-width",width);
      p.appendChild(r); p.appendChild(l); defs.appendChild(p);
    }
    pattern("hazdam-hatch-inactive", "rgba(255,0,0,0.18)", "rgba(255,0,0,0.018)", "0.9");
    pattern("hazdam-hatch-pending", "rgba(255,0,0,0.24)", "rgba(190,0,0,0.26)", "0.9");
    pattern("hazdam-hatch-active", "rgba(255,0,0,0.24)", "rgba(190,0,0,0.26)", "0.9");
    svg.appendChild(defs); document.body.appendChild(svg);
  }

  function polygonCentre(coords){
    const usable = coords.length > 1 && samePoint(coords[0], coords[coords.length - 1])
      ? coords.slice(0, -1)
      : coords;
    if (!usable.length) return [0, 0];

    let lat = 0;
    let lon = 0;
    for (const point of usable) {
      lat += Number(point[0]);
      lon += Number(point[1]);
    }
    return [lat / usable.length, lon / usable.length];
  }
  function stateText(s){ return String(s || "inactive").replace(/_/g," ").toUpperCase(); }
  function manualState(id){ return OPERATIONAL[id]?.state || HAZDAM_STATE.INACTIVE; }

  function statePriority(a,b){
    var rank={}; rank[HAZDAM_STATE.INACTIVE]=0; rank[HAZDAM_STATE.PENDING]=1; rank[HAZDAM_STATE.ACTIVE]=2;
    return (rank[b]||0)>(rank[a]||0)?b:a;
  }
  // DEV451: reuse formatters, never cache date-dependent schedule results.
  var ukWeekdayFormatter = null, ukMonthFormatter = null;
  function ukLocalWeekday(date){
    var d = date instanceof Date ? date : new Date();
    try{if(!ukWeekdayFormatter)ukWeekdayFormatter=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short"});return ukWeekdayFormatter.format(d).slice(0,3).toUpperCase();}
    catch(e){return ["SUN","MON","TUE","WED","THU","FRI","SAT"][d.getUTCDay()];}
  }
  function daySpecMatchesDate(spec,date,local){
    var today=local?ukLocalWeekday(date):["SUN","MON","TUE","WED","THU","FRI","SAT"][date.getUTCDay()], s=String(spec||"").toUpperCase().replace(/\./g,"").trim();
    if(!s) return true;
    if(/\b(?:DAILY|EVERY DAY)\b/.test(s)) return true;
    if(/\bWEEKDAYS?\b/.test(s)) return ["MON","TUE","WED","THU","FRI"].indexOf(today)!==-1;
    var days=["MON","TUE","WED","THU","FRI","SAT","SUN"];
    var rm=s.match(/\b(MON|TUE|WED|THU|FRI|SAT|SUN)\s*-\s*(MON|TUE|WED|THU|FRI|SAT|SUN)\b/);
    if(rm){var a=days.indexOf(rm[1]),b=days.indexOf(rm[2]),t=days.indexOf(today);return a<=b?(t>=a&&t<=b):(t>=a||t<=b);}
    var found=days.filter(function(d){return new RegExp("\\b"+d+"\\b").test(s);});
    return found.length?found.indexOf(today)!==-1:true;
  }
  function daySpecMatchesToday(spec){ return daySpecMatchesDate(spec, operationalNowDate()); }
  function ukLocalMonthIndex(date){
    var d=(date && typeof date.getTime==="function")?date:new Date();
    try{if(!ukMonthFormatter)ukMonthFormatter=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",month:"numeric"});return Number(ukMonthFormatter.format(d))-1;}catch(e){return d.getUTCMonth();}
  }
  function monthRangeMatchesDate(startMonth,endMonth,date,local){
    if(startMonth===null||typeof startMonth==="undefined"||endMonth===null||typeof endMonth==="undefined") return true;
    var m=local?ukLocalMonthIndex(date):date.getUTCMonth(), a=Number(startMonth), b=Number(endMonth);
    return a<=b ? (m>=a&&m<=b) : (m>=a||m<=b);
  }
  function enrSeasonBefore(raw,index){
    var names={JANUARY:0,FEBRUARY:1,MARCH:2,APRIL:3,MAY:4,JUNE:5,JULY:6,AUGUST:7,SEPTEMBER:8,OCTOBER:9,NOVEMBER:10,DECEMBER:11};
    var pre=String(raw||"").slice(Math.max(0,index-90),index).toUpperCase();
    var m=pre.match(/(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s*-\s*(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+INCLUSIVE\s*$/);
    return m?{startMonth:names[m[1]],endMonth:names[m[2]],seasonLabel:m[1]+" - "+m[2]+" inclusive"}:null;
  }
  function scheduleWindowState(startHHMM,endHHMM,window){
    if(window && Number.isFinite(window.startMs) && Number.isFinite(window.endMs)){
      var at=operationalNowDate().getTime();
      return at>=window.startMs&&at<window.endMs?HAZDAM_STATE.ACTIVE:at>=window.startMs-HAZDAM_CONFIG.pendingMinutes*60000&&at<window.startMs?HAZDAM_STATE.PENDING:HAZDAM_STATE.INACTIVE;
    }
    var s=String(startHHMM||""), e=String(endHHMM||"");
    var start=parseHHMM(s.replace(/^(\d{2})(\d{2})$/,"$1:$2")), end=parseHHMM(e.replace(/^(\d{2})(\d{2})$/,"$1:$2"));
    if(start===null||end===null) return HAZDAM_STATE.INACTIVE;
    var now=utcMinutesNow(), pending=(start-HAZDAM_CONFIG.pendingMinutes+1440)%1440;
    if(end>=start){
      if(now>=start&&now<end) return HAZDAM_STATE.ACTIVE;
      if(start>=HAZDAM_CONFIG.pendingMinutes){if(now>=start-HAZDAM_CONFIG.pendingMinutes&&now<start)return HAZDAM_STATE.PENDING;}
      else if(now>=pending||now<start)return HAZDAM_STATE.PENDING;
      return HAZDAM_STATE.INACTIVE;
    }
    if(now>=start||now<end)return HAZDAM_STATE.ACTIVE;
    if(now>=pending&&now<start)return HAZDAM_STATE.PENDING;
    return HAZDAM_STATE.INACTIVE;
  }
  // NATS Expressions of Time: unbracketed/bracketed hours are winter/summer UTC.
  // Only schedules explicitly labelled LOCAL use inverse Europe/London conversion.
  var londonClockFormatter=null;
  function londonParts(date){
    if(!londonClockFormatter)londonClockFormatter=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
    var p={};londonClockFormatter.formatToParts(date).forEach(function(x){p[x.type]=x.value;});
    return {day:Date.UTC(+p.year,+p.month-1,+p.day),minutes:+p.hour*60+ +p.minute};
  }
  function londonOffset(date){var p=londonParts(date);return (p.day+p.minutes*60000-Math.floor(date.getTime()/60000)*60000)/60000;}
  function localBoundaries(day,minutes){
    var offsets=new Set([-1,0,1].map(function(n){return londonOffset(new Date(day+n*86400000+12*3600000));})),candidates=[];
    offsets.forEach(function(offset){var t=day+(minutes-offset)*60000,p=londonParts(new Date(t));if(p.day===day&&p.minutes===minutes)candidates.push(t);});
    return candidates;
  }
  function localIntervals(day,start,end){
    var endDay=day+(end<start?86400000:0),starts=localBoundaries(day,start),ends=localBoundaries(endDay,end);
    // A nonexistent spring boundary is uncertain: never silently move it.
    if(!starts.length||!ends.length)return [];
    var lo=Math.min.apply(null,starts),hi=Math.max.apply(null,ends),cuts=starts.concat(ends),firstOffset=londonOffset(new Date(lo));
    if(londonOffset(new Date(hi-1))!==firstOffset){
      var left=lo/60000,right=hi/60000;
      while(right-left>1){var mid=Math.floor((left+right)/2);if(londonOffset(new Date(mid*60000))===firstOffset)left=mid;else right=mid;}
      cuts.push(right*60000);
    }
    cuts=Array.from(new Set(cuts)).sort(function(a,b){return a-b;});var out=[];
    for(var i=1;i<cuts.length;i++){
      var p=londonParts(new Date((cuts[i-1]+cuts[i])/2)),wall=p.day+p.minutes*60000;
      if(wall<day+start*60000||wall>=endDay+end*60000)continue;
      var previous=out[out.length-1];if(previous&&previous[1]===cuts[i-1])previous[1]=cuts[i];else out.push([cuts[i-1],cuts[i]]);
    }
    return out;
  }
  function enrScheduleWindows(hoursText,date,dayOffset){
    date=date||operationalNowDate();dayOffset=dayOffset||0;
    var raw=String(hoursText||"").toUpperCase().replace(/[\u2010-\u2014\u2212]/g,"-").replace(/\s+/g," ").trim(),out=[];
    if(!raw)return out;
    if(/\bH24\b/.test(raw))return [{days:"DAILY",start:"0000",end:"2359",h24:true}];
    var dayPattern="((?:DAILY|EVERY DAY|WEEKDAYS?|MON|TUE|WED|THU|FRI|SAT|SUN)(?:\\s*-\\s*(?:MON|TUE|WED|THU|FRI|SAT|SUN))?(?:\\s*,\\s*(?:MON|TUE|WED|THU|FRI|SAT|SUN))*)";
    var re=new RegExp(dayPattern+"\\s+(\\d{4})\\s*-\\s*(\\d{4})(?:\\s*\\((\\d{4})\\s*-\\s*(\\d{4})\\))?","g"),m;
    while((m=re.exec(raw))!==null){
      var summer=!!m[4],tail=raw.slice(re.lastIndex),prefix=raw.slice(0,m.index),explicitLocal=!summer&&(/^\s*(?:UK\s+)?(?:LOCAL(?:\s+TIME)?|EUROPE\/LONDON)\b/.test(tail)||/(?:UK\s+)?(?:LOCAL(?:\s+TIME)?|EUROPE\/LONDON)\s*:?\s*$/.test(prefix));
      var useSummer=summer&&londonOffset(date)!==0,start=useSummer?m[4]:m[2],end=useSummer?m[5]:m[3];
      var a=parseHHMM(start.replace(/^(\d{2})(\d{2})$/,"$1:$2")),b=parseHHMM(end.replace(/^(\d{2})(\d{2})$/,"$1:$2"));
      if(a===null||b===null)continue;
      var day=(explicitLocal?londonParts(date).day:Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()))+dayOffset*86400000,overnight=b<a;
      var intervals=explicitLocal?localIntervals(day,a,b):[[day+a*60000,day+(overnight?86400000:0)+b*60000]];
      function hm(ms){var d=new Date(ms);return String(d.getUTCHours()).padStart(2,"0")+String(d.getUTCMinutes()).padStart(2,"0");}
      intervals.forEach(function(interval){var startMs=interval[0],endMs=interval[1];out.push(Object.assign({days:m[1].trim(),start:hm(startMs),end:hm(endMs),startMs:startMs,endMs:endMs,dayDate:new Date(day+(explicitLocal?12*3600000:0)),explicitLocal:explicitLocal,explicitUtc:!explicitLocal,seasonalUtc:summer,publishedStart:m[2],publishedEnd:m[3],summerStart:m[4]||null,summerEnd:m[5]||null},enrSeasonBefore(raw,m.index)||{}));});
    }
    return out;
  }
  function isEnrH24(id){
    var st = STATIC[id] || {};
    return /\bH24\b/i.test(String(st.hours || ""));
  }

  function enrWindowForToday(id){
    var st = STATIC[id] || {};
    var hours = String(st.hours || "");

    if(!hours) return null;
    if(/\bH24\b/i.test(hours)){
      return {days:"DAILY", start:"0000", end:"2359", h24:true};
    }

    // Release238: ENR solar schedules are operational. D129 publishes
    // Mon-Fri SR-SS, so resolve today's sunrise/sunset at the programmed
    // danger-area position instead of falling back to 00:00-00:00.
    var solarWindow = enrSolarWindowForDate(id, operationalNowDate());
    if(solarWindow) return solarWindow;

    var viewedDate=operationalNowDate();
    var windows = enrScheduleWindows(hours,viewedDate).concat(enrScheduleWindows(hours,viewedDate,-1).filter(function(w){return w.endMs>viewedDate.getTime();})).filter(function(w){
      return daySpecMatchesDate(w.days,w.dayDate,w.explicitLocal) && monthRangeMatchesDate(w.startMonth,w.endMonth,w.dayDate,w.explicitLocal);
    });
    if(!windows.length) return null;

    // Prefer a currently ACTIVE window, then one that is PENDING, otherwise
    // return the first published period for today.
    return windows.find(function(w){
      return scheduleWindowState(w.start,w.end,w) === HAZDAM_STATE.ACTIVE;
    }) || windows.find(function(w){
      return scheduleWindowState(w.start,w.end,w) === HAZDAM_STATE.PENDING;
    }) || windows[0];
  }

  function enrScheduleState(id){
    var w = enrWindowForToday(id);
    if(!w) return HAZDAM_STATE.INACTIVE;
    if(w.h24) return HAZDAM_STATE.ACTIVE;
    return scheduleWindowState(w.start,w.end,w);
  }

  function daSolarUtcMinutes(date, lat, lon, sunrise){
    function rad(x){return x*Math.PI/180;} function deg(x){return x*180/Math.PI;} function norm(x,m){return ((x%m)+m)%m;}
    var y=date.getUTCFullYear(),mo=date.getUTCMonth(),da=date.getUTCDate();
    var n=Math.floor((Date.UTC(y,mo,da)-Date.UTC(y,0,0))/86400000), lh=lon/15, t=n+((sunrise?6:18)-lh)/24;
    var M=.9856*t-3.289, L=norm(M+1.916*Math.sin(rad(M))+.020*Math.sin(rad(2*M))+282.634,360);
    var RA=norm(deg(Math.atan(.91764*Math.tan(rad(L)))),360),Lq=Math.floor(L/90)*90,RAq=Math.floor(RA/90)*90; RA=(RA+(Lq-RAq))/15;
    var sd=.39782*Math.sin(rad(L)),cd=Math.cos(Math.asin(sd)),ch=(Math.cos(rad(90.833))-sd*Math.sin(rad(lat)))/(cd*Math.cos(rad(lat)));
    if(ch>1||ch<-1)return null; var H=(sunrise?360-deg(Math.acos(ch)):deg(Math.acos(ch)))/15;
    return Math.round(norm(H+RA-.06571*t-6.622-lh,24)*60)%1440;
  }
  function enrSolarWindowForDate(id,date){
    var st=STATIC[id]||{}, raw=String(st.hours||"").toUpperCase().replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g,"-").replace(/\s+/g," ").trim();
    var m=raw.match(/((?:DAILY|EVERY DAY|WEEKDAYS?|MON|TUE|WED|THU|FRI|SAT|SUN)(?:\s*-\s*(?:MON|TUE|WED|THU|FRI|SAT|SUN))?(?:\s*,\s*(?:MON|TUE|WED|THU|FRI|SAT|SUN))*)\s+(SR|SS)\s*-\s*(SR|SS)/);
    if(!m || !daySpecMatchesDate(m[1],date)) return null;
    var pos=Array.isArray(st.circleCenter)?st.circleCenter:null;
    if(!pos && Array.isArray(st.labelLatLng))pos=st.labelLatLng;
    if(!pos) return null;
    var start=daSolarUtcMinutes(date,Number(pos[0]),Number(pos[1]),m[2]==="SR");
    var finishDate=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+(m[2]==="SS"&&m[3]==="SR"?1:0),12));
    var end=daSolarUtcMinutes(finishDate,Number(pos[0]),Number(pos[1]),m[3]==="SR");
    if(start===null||end===null)return null;
    function hm(v){v=(v+1440)%1440;var h=String(Math.floor(v/60)).padStart(2,"0"),mn=String(v%60).padStart(2,"0");return h+mn;}
    return {days:m[1],start:hm(start),end:hm(end),solar:true,solarCode:m[2]+"-"+m[3]};
  }

  function solarStateForArea(op,id){
    var d=String(op && (op.notamD||op.autoScheduleD)||"").toUpperCase().replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g,"-"),m=d.match(/\b(SR|SS)\s*-\s*(SR|SS)\b/); if(!m)return null;
    var st=STATIC[id]||{},pos=Array.isArray(st.circleCenter)?st.circleCenter:null;
    if(!pos && Array.isArray(st.labelLatLng))pos=st.labelLatLng; if(!pos)return HAZDAM_STATE.INACTIVE;
    var now=operationalNowDate(), y=now.getUTCFullYear(),mo=now.getUTCMonth(),da=now.getUTCDate(),nowMs=operationalNowMs(),overnight=m[1]==="SS"&&m[2]==="SR";
    function at(off,tok){var dt=new Date(Date.UTC(y,mo,da+off,12));var mn=daSolarUtcMinutes(dt,Number(pos[0]),Number(pos[1]),tok==="SR");return mn===null?NaN:Date.UTC(dt.getUTCFullYear(),dt.getUTCMonth(),dt.getUTCDate())+mn*60000;}
    for(var i=0;i<(overnight?2:1);i++){var off=overnight?i-1:0,a=at(off,m[1]),b=at(off+(overnight?1:0),m[2]);if(isFinite(a)&&isFinite(b)&&nowMs>=a&&nowMs<b)return HAZDAM_STATE.ACTIVE;if(isFinite(a)&&nowMs>=a-30*60000&&nowMs<a)return HAZDAM_STATE.PENDING;}
    return HAZDAM_STATE.INACTIVE;
  }
  function notamScheduleStateForArea(op,id){
    if(!op) return HAZDAM_STATE.INACTIVE;
    var solar=solarStateForArea(op,id); if(solar!==null)return solar;

    // Release254: NOTAMs which have no D) schedule are active for their full
    // absolute B)-C) validity.  This is important for areas such as D117 and
    // the D217 complex, where AUTO PLOT previously persisted 00:00/00:00 and
    // therefore never reached PENDING/ACTIVE.  Use the operational/test clock
    // so ADMIN rewind/fast-forward exercises the same state machine.
    var dText=String(op.notamD||op.autoScheduleD||'').trim();
    var bMs=notamBcdUtcMs(op.notamB||op.autoValidB);
    var cMs=notamBcdUtcMs(op.notamC||op.autoValidC);
    if(!dText && isFinite(bMs) && isFinite(cMs)){
      var nowMs=operationalNowMs();
      if(nowMs>=bMs && nowMs<cMs) return HAZDAM_STATE.ACTIVE;
      if(nowMs>=bMs-HAZDAM_CONFIG.pendingMinutes*60000 && nowMs<bMs) return HAZDAM_STATE.PENDING;
      return HAZDAM_STATE.INACTIVE;
    }

    var s=parseHHMM(op.startUTC),e=parseHHMM(op.endUTC);
    if(s===null||e===null||(s===0&&e===0))return HAZDAM_STATE.INACTIVE;
    return timeControlledState(op)||HAZDAM_STATE.INACTIVE;
  }
  // Release231: a persisted AUTO PIB promulgation is current only while its
  // NOTAM B/C validity overlaps the current UTC day. This prevents yesterday's
  // D201 (and other NOTAM-only Danger Areas) from appearing active on startup
  // before today's PIB/AUTO PLOT refresh has run.
  function notamBcdUtcMs(v){
    var m=String(v||"").trim().match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
    if(!m)return NaN;
    return Date.UTC(2000+Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),0);
  }
  function notamValidityAtInstant(op, nowMs){
    var b=notamBcdUtcMs(op && (op.notamB || op.autoValidB));
    var c=notamBcdUtcMs(op && (op.notamC || op.autoValidC));
    // Manual/non-PIB promulgations may not carry B/C; preserve their existing behaviour.
    if(!isFinite(b)||!isFinite(c))return true;
    var t=isFinite(Number(nowMs))?Number(nowMs):operationalNowMs();
    return t>=b && t<c;
  }
  // Dev329: resolve multiple NOTAM activation records against the operational UTC clock.
  function activationToOperational(base, a){
    a = a || {};
    return Object.assign({}, base || {}, {
      startUTC:String(a.startUTC || "00:00"), endUTC:String(a.endUTC || "00:00"),
      lower:String(a.lower || (base&&base.lower) || ""), upper:String(a.upper || (base&&base.upper) || ""),
      source:String(a.source || ("AUTO PIB NOTAM " + (a.notamId || ""))),
      notes:String(a.notes || ""), updatedBy:String(a.updatedBy || "AUTO PLOT"),
      autoNotamId:String(a.notamId || ""), autoSourcePage:a.sourcePage ? String(a.sourcePage) : "",
      autoValidB:String(a.b || ""), autoValidC:String(a.c || ""), autoScheduleD:String(a.d || ""),
      autoNotamAction:String(a.action || "activate"),
      notamId:String(a.notamId || ""), notamSourcePage:a.sourcePage ? String(a.sourcePage) : "",
      notamB:String(a.b || ""), notamC:String(a.c || ""), notamD:String(a.d || ""),
      notamText:String(a.notamText || ""), notamAction:String(a.action || "activate"),
      autoActivations:[]
    });
  }
  function autoActivationRows(op){
    return Array.isArray(op && op.autoActivations) ? op.autoActivations.filter(Boolean) : [];
  }
  function activationStateRank(st){ return st===HAZDAM_STATE.ACTIVE ? 0 : st===HAZDAM_STATE.PENDING ? 1 : 2; }
  function activationStartMs(a){ var b=notamBcdUtcMs(a&&a.b); return isFinite(b)?b:Infinity; }
  function resolvedAutoActivation(op,id,includeUpcoming){
    var rows=autoActivationRows(op); if(!rows.length) return null;
    var now=operationalNowMs();
    var mapped=rows.map(function(a){
      var ao=activationToOperational(op,a);
      return {activation:a, op:ao, state:notamScheduleStateForArea(ao,id), current:hasCurrentNotamPromulgation(ao), startMs:activationStartMs(a)};
    });
    var current=mapped.filter(function(x){return x.current;});
    if(current.length){
      current.sort(function(a,b){
        var ar=activationStateRank(a.state), br=activationStateRank(b.state);
        if(ar!==br) return ar-br;
        // A live deactivation is deliberately authoritative if contradictory promulgations overlap.
        var ad=dangerNotamAction(a.op)==='deactivate'?0:1, bd=dangerNotamAction(b.op)==='deactivate'?0:1;
        if(ad!==bd) return ad-bd;
        return a.startMs-b.startMs;
      });
      return current[0];
    }
    if(!includeUpcoming) return null;
    var upcoming=mapped.filter(function(x){ return isFinite(x.startMs) && x.startMs>now; }).sort(function(a,b){return a.startMs-b.startMs;});
    if(upcoming.length) return upcoming[0];
    mapped.sort(function(a,b){return b.startMs-a.startMs;});
    return mapped[0] || null;
  }
  function operationalForNow(id, includeUpcoming){
    var base=OPERATIONAL[id]||defaultOp(id);
    var hit=resolvedAutoActivation(base,id,!!includeUpcoming);
    return hit ? hit.op : base;
  }

  function hasCurrentNotamPromulgation(op){
    if(!op) return false;
    if(autoActivationRows(op).length){
      return autoActivationRows(op).some(function(a){ return hasCurrentNotamPromulgation(activationToOperational(op,a)); });
    }
    var nid = String(op.notamId || op.autoNotamId || "").trim();
    if(!nid) return false;
    var start = parseHHMM(op.startUTC), end = parseHHMM(op.endUTC);
    var d = String(op.notamD || op.autoScheduleD || "").toUpperCase().replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g,"-");
    var solar = /\b(?:SR|SS)\s*-\s*(?:SR|SS)\b/.test(d);
    var b=notamBcdUtcMs(op.notamB||op.autoValidB), c=notamBcdUtcMs(op.notamC||op.autoValidC), now=operationalNowMs();

    // Release254: retain the NOTAM as the controlling promulgation during the
    // 15-minute warning period before B).  With no D), B)-C) itself is the
    // activation window.  After C) it ceases to control, but Release253 keeps
    // the record so rewinding the test clock restores it.
    if(isFinite(b)&&isFinite(c)){
      if(now < b-HAZDAM_CONFIG.pendingMinutes*60000 || now >= c) return false;
      if(!d.trim()) return true;
    } else if(!notamValidityAtInstant(op)) return false;

    return solar || (start !== null && end !== null && !(start === 0 && end === 0));
  }

  function notamIsAdditiveToEnr(id){
    var hours=String((STATIC[id]&&STATIC[id].hours)||"").toUpperCase();
    return /\bAND\s+AS\s+ACTIVATED\s+BY\s+NOTAM\b/.test(hours);
  }
  function dangerNotamAction(op){
    var a=String(op&&(op.notamAction||op.autoNotamAction)||"").toLowerCase();
    if(a==="deactivate"||a==="activate") return a;
    var text=String(op&&op.notamText||"").toUpperCase();
    if(/\bDEACTIVATED\b/.test(text)) return "deactivate";
    return "activate";
  }

  function effectiveState(id){
    const op=operationalForNow(id,false);
    var enrState=enrScheduleState(id);

    // Release238: where ENR explicitly says "and as activated by NOTAM",
    // the NOTAM adds an activation window; it does not erase the routine ENR
    // window. This makes D129 SR-SS (ENR) + SS-SR (D3186/26) continuously
    // ACTIVE while the NOTAM remains within its B/C validity.
    if(hasCurrentNotamPromulgation(op)){
      var notamState=notamScheduleStateForArea(op,id);
      var action=dangerNotamAction(op);
      // Release267: a DEACTIVATED NOTAM supersedes ENR only while its own
      // B/C + D) window is active. Before/after that window the ENR schedule
      // remains authoritative and automatically resumes.
      if(action==="deactivate") return notamState===HAZDAM_STATE.ACTIVE ? HAZDAM_STATE.INACTIVE : enrState;
      return notamIsAdditiveToEnr(id) ? statePriority(enrState,notamState) : notamState;
    }
    return enrState;
  }
  function isTimeControlled(id){
    const op=OPERATIONAL[id]||defaultOp(id);
    return String(op.feedMode||"manual").toLowerCase()==="auto";
  }

  function routinePublishedUpper(id){
    // Release293: these DAs are H24 at a routine baseline level, with higher
    // routine levels at published local times. A current NOTAM is handled by
    // effectiveLevels() before this routine value is used.
    var special={EGD123:1,EGD125:1,EGD126:1,EGD127:1,EGD128:1,EGD203:1};
    if(!special[id]) return null;
    var now=operationalNowDate(), parts={};
    try{
      new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now).forEach(function(x){parts[x.type]=x.value;});
    }catch(e){ parts.weekday=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][now.getUTCDay()]; parts.hour=String(now.getUTCHours()); parts.minute=String(now.getUTCMinutes()); }
    var day=String(parts.weekday||"").slice(0,3).toUpperCase(), mins=Number(parts.hour||0)*60+Number(parts.minute||0);
    if(id==="EGD126" || id==="EGD128") return "1400 FT ALT";
    if(id==="EGD127") return (mins>=360 && mins<1080) ? "12000 FT ALT" : "8000 FT ALT";
    if(id==="EGD123" || id==="EGD125"){
      if(["MON","TUE","WED","THU"].indexOf(day)!==-1 && mins>=480) return "23000 FT ALT";
      if(day==="FRI" && mins>=480 && mins<1050) return "23000 FT ALT";
      return "3000 FT ALT";
    }
    if(id==="EGD203"){
      if(["MON","TUE","WED","THU","FRI"].indexOf(day)!==-1 && mins>=480 && mins<1080) return "23000 FT ALT";
      return "18000 FT ALT";
    }
    return null;
  }

  function effectiveLevels(id){
    var st = STATIC[id] || {};
    var op = operationalForNow(id,false);

    if(hasCurrentNotamPromulgation(op)){
      if(dangerNotamAction(op)==="deactivate"){
        return {lower:st.lower||"SFC",upper:st.upper||"UNL",source:"NOTAM DEACTIVATION — ENR SUPPRESSED DURING NOTAM WINDOW"};
      }
      if(notamIsAdditiveToEnr(id)){
        var ns=notamScheduleStateForArea(op,id);
        var es=enrScheduleState(id);
        if(ns===HAZDAM_STATE.ACTIVE || ns===HAZDAM_STATE.PENDING){
          return {lower:op.lower||st.lower||"SFC",upper:op.upper||st.upper||"UNL",source:"ENR 5.1 + NOTAM"};
        }
        if(es===HAZDAM_STATE.ACTIVE || es===HAZDAM_STATE.PENDING){
          return {lower:st.lower||"SFC",upper:st.upper||"UNL",source:"ENR 5.1 + NOTAM"};
        }
        return {lower:st.lower||op.lower||"SFC",upper:st.upper||op.upper||"UNL",source:"ENR 5.1 + NOTAM"};
      }
      return {
        lower: op.lower || st.lower || "SFC",
        upper: op.upper || st.upper || "UNL",
        source:"NOTAM Promulgation"
      };
    }

    var routineUpper = routinePublishedUpper(id);
    return {
      lower: st.lower || "SFC",
      upper: routineUpper || st.upper || "UNL",
      source: routineUpper ? "ENR 5.1 — ROUTINE PUBLISHED LEVEL" : (isEnrH24(id) ? "ENR 5.1 — H24" : "ENR 5.1")
    };
  }

  // Release197: values shown in NOTAM PLOTTING > Danger Areas must reflect
  // the effective source. A current uploaded NOTAM supersedes ENR. Without a
  // NOTAM, AUTO areas show today's published ENR UTC schedule and ENR levels.
  function effectiveTiming(id){
    var baseOp = OPERATIONAL[id] || defaultOp(id);
    var op = operationalForNow(id,true);

    if(hasCurrentNotamPromulgation(op)){
      if(dangerNotamAction(op)==="deactivate"){
        return {startUTC:op.startUTC||"00:00",endUTC:op.endUTC||"00:00",source:"NOTAM DEACTIVATION — SUPERSEDES ENR"};
      }
      if(notamIsAdditiveToEnr(id)){
        var ew=enrWindowForToday(id);
        var ns=notamScheduleStateForArea(op,id);
        var es=enrScheduleState(id);
        var nd=String(op.notamD||op.autoScheduleD||"").toUpperCase().replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g,"-");
        var complementary=ew&&ew.solar&&ew.solarCode==="SR-SS"&&/\bSS\s*-\s*SR\b/.test(nd);
        if(complementary){
          var now=operationalNowDate(), day0=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()), day1=day0+86400000;
          var b=notamBcdUtcMs(op.notamB||op.autoValidB), c=notamBcdUtcMs(op.notamC||op.autoValidC);
          var start=(isFinite(b)&&b>day0&&b<day1)?new Date(b):new Date(day0);
          var end=(isFinite(c)&&c>day0&&c<day1)?new Date(c):new Date(day1-60000);
          function hhmmDate(d){return String(d.getUTCHours()).padStart(2,"0")+":"+String(d.getUTCMinutes()).padStart(2,"0");}
          return {startUTC:hhmmDate(start),endUTC:hhmmDate(end),source:"ENR 5.1 + NOTAM — H24"};
        }
        return {startUTC:(ew&&ew.start)?String(ew.start).replace(/^(\d{2})(\d{2})$/,"$1:$2"):(op.startUTC||"00:00"),endUTC:(ew&&ew.end)?String(ew.end).replace(/^(\d{2})(\d{2})$/,"$1:$2"):(op.endUTC||"00:00"),source:"ENR 5.1 + NOTAM"};
      }
      return {
        startUTC: op.startUTC || "00:00",
        endUTC: op.endUTC || "00:00",
        source: "NOTAM Promulgation"
      };
    }

    var w = enrWindowForToday(id);
    if(!w){
      return {startUTC:"00:00", endUTC:"00:00", source:"ENR 5.1"};
    }

    function hhmm(v){
      var s = String(v || "").replace(/\D/g,"").padStart(4,"0").slice(-4);
      return s.slice(0,2) + ":" + s.slice(2);
    }

    return {
      startUTC: hhmm(w.start),
      endUTC: hhmm(w.end),
      source: w.h24 ? "ENR 5.1 — H24" : "ENR 5.1"
    };
  }

  function syncEffectiveEnrOperational(id){
    var op = OPERATIONAL[id] || defaultOp(id);
    if(hasCurrentNotamPromulgation(op)) return;

    var timing = effectiveTiming(id);
    var levels = effectiveLevels(id);
    op.feedMode = "auto";
    op.source = "FISFID ENR DA";
    op.state = effectiveState(id);
    op.startUTC = timing.startUTC || "00:00";
    op.endUTC = timing.endUTC || "00:00";
    op.lower = levels.lower || STATIC[id]?.lower || "SFC";
    op.upper = levels.upper || STATIC[id]?.upper || "UNL";
    OPERATIONAL[id] = normaliseOp(id, op);
  }

  function syncAllEffectiveEnrOperational(){
    Object.keys(STATIC).forEach(syncEffectiveEnrOperational);
  }

  function areaStateClass(id){ return "hazdam-state-" + effectiveState(id); }
  function displayRange(id){
    const o = OPERATIONAL[id] || defaultOp(id);
    return `${o.lower || "—"}-${o.upper || "—"}`;
  }

  function displayTime(v){
    const raw = String(v || "").trim();
    if(!raw) return "—";
    return raw.replace(":", "");
  }

  function cleanOperationalLevelText(value){
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/\b(AMSL|ALT|AGL)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function splitLevelForEdit(level, fallback){
    const raw = cleanOperationalLevelText(level || fallback);
    if(/^FL\s*\d{1,3}$/.test(raw)) return { unit: "FL", value: raw.replace(/^FL\s*/, "") };
    if(raw === "SFC" || raw === "GND") return { unit: "ALT", value: "SFC" };
    if(raw === "UNL") return { unit: "ALT", value: "UNL" };
    return { unit: "ALT", value: raw.replace(/\s*FT$/i, "") };
  }

  function combineLevelFromEdit(unit, value, fallback){
    const u = String(unit || "ALT").toUpperCase();
    const v = cleanOperationalLevelText(value || fallback);
    if(!v) return cleanOperationalLevelText(fallback);
    if(v === "SFC" || v === "GND" || v === "UNL") return v;
    if(u === "FL") return v.startsWith("FL") ? v.replace(/\s+/g, "") : "FL" + v.replace(/^0+(?=\d)/, "").replace(/\D/g, "");
    const ft = v.match(/^(\d{1,5})\s*(?:FT)?$/);
    if(ft) return ft[1] + "FT";
    return v;
  }

  function scrollToHazdamEdit(){
    setTimeout(() => {
      const target = document.getElementById("hazdamEditForm") || document.getElementById("hazdamSelectedPanel");
      if(!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function selectAreaForEdit(id){
    if(!STATIC[id]) return;
    editing = false;
    selectedId = id;
    draw();
    renderPanel();
    renderEditForm();
    scrollToHazdamEdit();
  }

  function labelHtml(id){
    const s = STATIC[id];
    const lv = effectiveLevels(id);
    if(window.FISO_AREA_LABELS && window.FISO_AREA_LABELS.applies(id)){
      const o=operationalForNow(id,true);
      const record={b:o.notamB||o.autoValidB,c:o.notamC||o.autoValidC,d:o.notamD||o.autoScheduleD,notam:o.notamText||''};
      const time=window.FISO_AREA_LABELS.timing(record,operationalNowMs());
      return window.FISO_AREA_LABELS.html(id,o.upper||lv.upper,o.lower||lv.lower,time,areaStateClass(id),selectedId===id);
    }
    return `<div class="hazdam-label ${areaStateClass(id)} ${selectedId===id?"hazdam-label-selected":""}" data-hazdam-id="${id}"><div class="hazdam-label-id">${safe(s.display)}</div><div class="hazdam-label-limits">${safe(lv.upper)}<br>${safe(lv.lower)}</div></div>`;
  }

  function labelIcon(id,html){
    const timed=window.FISO_AREA_LABELS && window.FISO_AREA_LABELS.applies(id);
    return L.divIcon({className:'hazdam-label-icon',html,iconSize:timed?[108,40]:[66,34],iconAnchor:timed?[0,20]:[33,17]});
  }

  function autoActivationScheduleHtml(id){
    var base=OPERATIONAL[id]||defaultOp(id), rows=autoActivationRows(base);
    if(!rows.length) return "";
    var now=operationalNowMs();
    var entries=rows.slice().sort(function(a,b){return activationStartMs(a)-activationStartMs(b);});
    return `<div class="hazdam-popup-section hazdam-notam-promulgation"><b>PIB activation schedule</b>${entries.map(function(a){
      var ao=activationToOperational(base,a), st=notamScheduleStateForArea(ao,id), b=notamBcdUtcMs(a.b), c=notamBcdUtcMs(a.c);
      var status=(hasCurrentNotamPromulgation(ao) ? stateText(st) : (isFinite(b)&&b>now ? "NEXT / FUTURE" : "COMPLETED"));
      function fmt(ms){if(!isFinite(ms))return "—";var d=new Date(ms);return String(d.getUTCDate()).padStart(2,"0")+" "+["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][d.getUTCMonth()]+" "+String(d.getUTCHours()).padStart(2,"0")+String(d.getUTCMinutes()).padStart(2,"0")+"Z";}
      return `<div class="hazdam-popup-grid hazdam-notam-grid"><span>${safe(status)}</span><b>${safe(a.notamId||"NOTAM")}${a.sourcePage?" · page "+safe(a.sourcePage):""}</b><span>Validity</span><b>${safe(fmt(b))}–${safe(fmt(c))}</b><span>Levels</span><b>${safe(a.lower||"—")} to ${safe(a.upper||"—")}</b></div>`;
    }).join("")}</div>`;
  }

  function popupHtml(id){
    const s = STATIC[id];
    const o = OPERATIONAL[id] || defaultOp(id);
    const eff = effectiveState(id);
    const timing = effectiveTiming(id);
    const start = timing.startUTC || "Not set";
    const end = timing.endUTC || "Not set";
    const lv = effectiveLevels(id);
    const lower = lv.lower || "—";
    const upper = lv.upper || "—";
    const notes = o.notes || "No operational notes.";
    const updated = o.updatedAt ? `${o.updatedAt}${o.updatedBy ? " by " + o.updatedBy : ""}` : "Not updated this session";
    return `<div class="hazdam-popup">
      <h3>${safe(s.display)} <span>${safe(s.name || "")}</span></h3>
      <div class="hazdam-popup-grid">
        <span>Status</span><b class="${areaStateClass(id)}">${safe(stateText(eff))}</b>
        <span>Start UTC</span><b>${safe(start)}</b>
        <span>End UTC</span><b>${safe(end)}</b>
        <span>Today's lower</span><b>${safe(lower)}</b>
        <span>Today's upper</span><b>${safe(upper)}</b>
        <span>Source</span><b>${safe(lv.source)}</b>
        <span>Updated</span><b>${safe(updated)}</b>
      </div>
      <div class="hazdam-popup-section"><b>Notes</b><p>${safe(notes)}</p></div>
      <div class="hazdam-popup-section"><b>AIP information${hasCurrentNotamPromulgation(o) ? (notamIsAdditiveToEnr(id) ? " — COMBINED WITH CURRENT NOTAM" : " — SUPERSEDED BY CURRENT NOTAM") : ""}</b>
        <p><strong>Published levels:</strong> ${safe(s.lower)}-${safe(s.upper)}</p>
        <p><strong>Activity:</strong> ${safe(s.activity || "—")}</p>
        <p><strong>Service:</strong> ${safe(s.service || "—")}</p>
        <p><strong>Contact:</strong> ${safe(s.contact || "—")}</p>
        <p><strong>Danger Area Authority:</strong> ${safe(s.authority || "—")}</p>
        <p><strong>Hours:</strong> ${safe(s.hours || "—")}</p>
        <p class="hazdam-enr-time-note"><strong>Timing:</strong> Local time first; bracketed time is Zulu/UTC and drives AUTO activation.</p>
        <p><strong>Remarks:</strong> ${safe(s.officialRemarks || "—")}</p>
      </div>
      ${s.aipSupplement ? `<div class="hazdam-popup-section hazdam-aip-supplement">
        <b>AIP Supplement</b>
        <div class="hazdam-popup-grid">
          <span>Reference</span><b>AIP SUP ${safe(s.aipSupplement)}</b>
          <span>Title</span><b>${safe(s.aipSupplementTitle || "—")}</b>
          <span>Validity</span><b>${safe(s.aipSupplementValidity || "—")}</b>
          <span>Architecture</span><b>${safe(s.enrBoundary || "—")}</b>
        </div>
        ${s.aipSupplementFile ? `<p><a class="hazdam-supp-link" href="${safe(s.aipSupplementFile)}" target="_blank" rel="noopener">Open AIP SUP ${safe(s.aipSupplement)}</a></p>` : ""}
      </div>` : ""}
      ${autoActivationScheduleHtml(id)}
      <div class="hazdam-popup-section hazdam-notam-promulgation">
        <b>NOTAM Promulgation${hasCurrentNotamPromulgation(o) && notamIsAdditiveToEnr(id) ? " — ADDS TO ENR 5.1 HOURS" : ""}</b>
        ${(() => {
          const rawNid = o.notamId || o.autoNotamId || "";
          const nid = activePibContainsNotamId(rawNid) ? rawNid : "";
          const pg = o.notamSourcePage || o.autoSourcePage || "";
          const nb = o.notamB || o.autoValidB || "";
          const nc = o.notamC || o.autoValidC || "";
          const nd = o.notamD || o.autoScheduleD || "";
          const nt = o.notamText || "";
          if(!nid) return `<p>No matching Danger Area NOTAM in the current uploaded PIB.</p>`;
          return `<div class="hazdam-popup-grid hazdam-notam-grid">
            <span>NOTAM</span><b>${safe(nid)}${pg ? " · page " + safe(pg) : ""}</b>
            <span>B)</span><b>${safe(nb || "—")}</b>
            <span>C)</span><b>${safe(nc || "—")}</b>
            <span>D)</span><b>${safe(nd || "—")}</b>
            <span>Promulgated lower</span><b>${safe(o.lower || s.lower || "—")}</b>
            <span>Promulgated upper</span><b>${safe(o.upper || s.upper || "—")}</b>
          </div>` + (nt ? `<p class="hazdam-notam-raw">${safe(nt)}</p>` : "");
        })()}
      </div>
    </div>`;
  }

  function areaBoundsLatLng(id){
    const s = STATIC[id];
    if(!s) return null;
    if(s.geometryType === "circle" && Array.isArray(s.circleCenter) && Number(s.circleRadiusNm) > 0){
      const c = L.latLng(Number(s.circleCenter[0]), Number(s.circleCenter[1]));
      const dLat = (Number(s.circleRadiusNm) * 1852) / 111320;
      const dLon = dLat / Math.max(0.2, Math.cos(c.lat * Math.PI / 180));
      return L.latLngBounds([c.lat-dLat,c.lng-dLon],[c.lat+dLat,c.lng+dLon]);
    }
    const pts = (s.coords || []).filter(pt => Array.isArray(pt) && Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1])));
    return pts.length ? L.latLngBounds(pts.map(pt => [Number(pt[0]), Number(pt[1])])) : null;
  }

  let areaPopupLeader = null;

  function clearAreaPopupLeader(){
    if(areaPopupLeader && map){
      try { map.removeLayer(areaPopupLeader); } catch(e) {}
    }
    areaPopupLeader = null;
  }

  function drawAreaPopupLeader(id){
    clearAreaPopupLeader();
    if(!map || !map._popup || !STATIC[id]) return;
    const popupEl = map._popup.getElement && map._popup.getElement();
    const mapEl = map.getContainer && map.getContainer();
    const b = areaBoundsLatLng(id);
    if(!popupEl || !mapEl || !b) return;

    // The leader ALWAYS begins at the exact vertical midpoint of the popup's
    // LEFT edge and ends at the selected danger area.  One line, one head.
    const pr = popupEl.getBoundingClientRect();
    const mr = mapEl.getBoundingClientRect();
    const startPt = L.point(pr.left - mr.left, (pr.top + pr.bottom) / 2 - mr.top);
    const targetLL = b.getCenter();
    const targetPt = map.latLngToContainerPoint(targetLL);
    const startLL = map.containerPointToLatLng(startPt);

    const dx = targetPt.x - startPt.x, dy = targetPt.y - startPt.y;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const line = L.polyline([startLL, targetLL], {
      color:'#111', weight:2.5, opacity:1, interactive:false, pane:'overlayPane'
    });
    const head = L.marker(targetLL, {
      interactive:false, keyboard:false, pane:'markerPane',
      icon:L.divIcon({
        className:'hazdam-popup-arrowhead-wrap',
        html:'<span class="hazdam-popup-arrowhead" style="transform:rotate(' + angle + 'deg)"></span>',
        iconSize:[18,18], iconAnchor:[9,9]
      })
    });
    areaPopupLeader = L.layerGroup([line, head]).addTo(map);
  }

  function openAreaPopup(id){
    if(!map || !window.L || !STATIC[id]) return;
    if(window.FISO_AREA_INFO){
      clearAreaPopupLeader();
      window.FISO_AREA_INFO.show(map,{key:'DA:'+id,title:(STATIC[id].display||id)+' '+(STATIC[id].name||''),html:popupHtml(id),onClose:()=>{
        if(selectedId===id){selectedId=null;refreshAllAreaLayers();if(!editing)renderPanel();}
      }});
      return;
    }
    clearAreaPopupLeader();
    const bounds = areaBoundsLatLng(id);
    const centre = bounds ? bounds.getCenter() : L.latLng(polygonCentre(STATIC[id].coords));
    let where = centre;
    if(bounds){
      const east = L.latLng(centre.lat,bounds.getEast());
      const ep = map.latLngToLayerPoint(east);
      where = map.layerPointToLatLng(L.point(ep.x+284,ep.y));
    }
    const popup=L.popup({autoPan:true,autoPanPadding:[36,36],closeButton:true,minWidth:460,maxWidth:520,className:'hazdam-info-popup hazdam-info-popup-right'}).setLatLng(where).setContent(popupHtml(id)).openOn(map);
    setTimeout(()=>{
      if(!map || map._popup!==popup || !bounds) return;
      const el=popup.getElement&&popup.getElement();
      if(el){
        const h=el.getBoundingClientRect().height;
        const cp=map.latLngToLayerPoint(centre), pp=map.latLngToLayerPoint(popup.getLatLng());
        popup.setLatLng(map.layerPointToLatLng(L.point(pp.x,cp.y+h/2)));
      }
      setTimeout(()=>drawAreaPopupLeader(id),0);
    },0);
    // Keep the leader physically attached to the popup while the map moves or
    // zooms.  Its start is recalculated from the popup's live DOM midpoint and
    // its target from the selected danger area's live projected position.
    let leaderFrame = 0;
    const syncLeader = () => {
      if(leaderFrame) cancelAnimationFrame(leaderFrame);
      leaderFrame = requestAnimationFrame(() => {
        leaderFrame = 0;
        if(map && map._popup === popup) drawAreaPopupLeader(id);
      });
    };
    ['zoom','zoomend','move','moveend','resize'].forEach(evt => map.on(evt, syncLeader));

    popup.once('remove', () => {
      if(leaderFrame) cancelAnimationFrame(leaderFrame);
      ['zoom','zoomend','move','moveend','resize'].forEach(evt => map.off(evt, syncLeader));
      clearAreaPopupLeader();

      // Closing/clicking away from the popup ends the temporary map selection.
      // Restore the danger area to the exact visual state dictated by its
      // operational status before it was selected.
      if(selectedId === id){
        selectedId = null;
        refreshAllAreaLayers();
        if(!editing) renderPanel();
      }
    });
  }

  function refreshOpenAreaPopup(id){
    if(!map || !map._popup || !id) return;
    const source = map._popup._source;
    if(source && source.__hazdamId && String(source.__hazdamId) === String(id)){
      map._popup.setContent(popupHtml(id));
    }
  }


  function visiblePolyFor(id){
    const obj = layersById[id];
    if(!obj) return null;
    if(obj.poly) return obj.poly;
    const owner = obj.sharedGeometryWith;
    return owner && layersById[owner] ? layersById[owner].poly : null;
  }

  function updateAreaLayer(id){
    const obj = layersById[id];
    if(!obj || !STATIC[id]) return;
    const poly = visiblePolyFor(id);
    if(poly){
      // A shared horizontal footprint may represent two vertical bands.  The
      // visible outline must highlight when EITHER member is selected.
      const ownerId = poly.__hazdamId || id;
      const ownerObj = layersById[ownerId];
      // DEV461: a stacked area's upper band may be active without its lower
      // band. Style the shared footprint from the most active member.
      const rank = {inactive:0, pending:1, active:2};
      const styleId = (ownerObj.geometryMembers || [ownerId]).reduce((best, member) =>
        rank[effectiveState(member)] > rank[effectiveState(best)] ? member : best, ownerId);
      const selectedOnThisGeometry = selectedId === id || selectedId === ownerId ||
        (selectedId && layersById[selectedId] && visiblePolyFor(selectedId) === poly);
      const cls = `hazdam-aip-area ${areaStateClass(styleId)} ${selectedOnThisGeometry ? "hazdam-selected-area" : ""}`;
      const signature = cls + "|" + selectedOnThisGeometry;
      if(poly.__hazdamStyleSignature !== signature){
        poly.setStyle({
          className: cls,
          color: strokeForState(styleId),
          weight: selectedOnThisGeometry ? 2.15 : 1.15,
          opacity: selectedOnThisGeometry ? 1 : 0.86,
          fill:true,
          fillOpacity:1
        });
        if(poly._path) poly._path.setAttribute("class", "leaflet-interactive " + cls);
        if(selectedOnThisGeometry) poly.bringToFront();
        poly.__hazdamStyleSignature = signature;
      }
    }
    if(obj.label && obj.label.setIcon){
      const html = labelHtml(id);
      if(obj.label.__hazdamHtml !== html){
        obj.label.setIcon(labelIcon(id,html));
        obj.label.__hazdamHtml = html;
      }
    }
    if(obj.stalk && obj.stalk.setStyle){
      const selected = selectedId===id;
      if(obj.stalk.__hazdamSelected !== selected){
        obj.stalk.setStyle({ weight:selected ? 1.25 : 0.7, opacity:selected ? 0.95 : 0.58 });
        if(obj.stalk._path) obj.stalk._path.classList.toggle("hazdam-stalk-selected", selected);
        obj.stalk.__hazdamSelected = selected;
      }
    }
  }

  function refreshAllAreaLayers(){
    Object.keys(STATIC).forEach(updateAreaLayer);
    updateLabelZoomClass();
    if(window.FISO_AREA_LABELS)window.FISO_AREA_LABELS.refresh(map);
    if(window.FISO_AREA_SELECTION)window.FISO_AREA_SELECTION.refresh();
    if(selectedId && window.FISO_AREA_INFO)window.FISO_AREA_INFO.update('DA:'+selectedId,popupHtml(selectedId));
  }

  function labelPointWithStalk(id, area, coords, isCircleArea, labelIndex){
    const centre = isCircleArea ? [Number(area.circleCenter[0]), Number(area.circleCenter[1])] : polygonCentre(coords);
    const bounds = isCircleArea ? areaBoundsLatLng(id) : L.latLngBounds(coords);
    const latSpan = bounds ? Math.max(0.012, bounds.getNorth()-bounds.getSouth()) : 0.02;
    const lonSpan = bounds ? Math.max(0.018, bounds.getEast()-bounds.getWest()) : 0.03;
    // Stable fan-out.  Nearby/shared areas get different compass positions,
    // like an aeronautical chart label with a leader/stalk.
    let hash = 0;
    String(id).split("").forEach(ch => { hash = ((hash * 33) + ch.charCodeAt(0)) >>> 0; });
    const angle = ((hash % 12) * 30 + labelIndex * 47 - 90) * Math.PI / 180;
    const scale = 0.72 + (labelIndex % 3) * 0.16;
    return [
      centre[0] + Math.sin(angle) * latSpan * scale,
      centre[1] + Math.cos(angle) * lonSpan * scale
    ];
  }

  // Linear canonical rotation preserves the original shared-footprint comparison.
  // Tokens use fixed decimal precision and cannot be prefixes of one another.
  function leastGeometryRotation(tokens){
    const n = tokens.length;
    if(!n) return "";
    let a=0, b=1, offset=0;
    while(a<n && b<n && offset<n){
      const left=tokens[(a+offset)%n], right=tokens[(b+offset)%n];
      if(left===right){ offset++; continue; }
      if(left>right){ a+=offset+1; if(a<=b) a=b+1; }
      else { b+=offset+1; if(b<=a) b=a+1; }
      offset=0;
    }
    const first=Math.min(a,b);
    return tokens.slice(first).concat(tokens.slice(0,first)).join(";");
  }

  function geometrySignature(area){
    if(!area) return "";
    if(area.geometryType === "circle" && Array.isArray(area.circleCenter)){
      return "C|" + area.circleCenter.map(v => Number(v).toFixed(6)).join(",") +
        "|" + Number(area.circleRadiusNm || 0).toFixed(4);
    }
    const tokens=(area.coords || []).map(pt => Number(pt[0]).toFixed(6) + "," + Number(pt[1]).toFixed(6));
    if(tokens.length>1 && tokens[0]===tokens[tokens.length-1]) tokens.pop();
    const forward=leastGeometryRotation(tokens), reverse=leastGeometryRotation(tokens.slice().reverse());
    return "P|" + (forward<reverse ? forward : reverse);
  }

  function draw(){
    if(!map || !window.L) return;
    ensurePattern();
    if(layerGroup) layerGroup.remove();
    layersById = {};
    layerGroup = L.layerGroup();

    // Several UK ENR Danger Areas legitimately use the same horizontal
    // footprint at different vertical bands (for example D217A/D217G and
    // D217C/D217I).  Render that shared footprint only once so the map does
    // not get a doubled red outline.  Keep each DA as a separate selectable
    // record and offset its label slightly so the identifiers remain legible.
    const renderedGeometry = new Map();
    const geometryLabelCount = new Map();


    Object.keys(STATIC).forEach(id => {
      const s = STATIC[id];
      if(!s || !Array.isArray(s.coords) || s.coords.length < 3){
        console.warn("HAZDAM skipped invalid area", id, s);
        return;
      }
      const coords = s.coords.filter(pt => Array.isArray(pt) && Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1])));
      if(coords.length < 3){
        console.warn("HAZDAM skipped area with invalid coordinates", id, s.coords);
        return;
      }

      const cls = `hazdam-aip-area ${areaStateClass(id)} ${selectedId===id ? "hazdam-selected-area" : ""}`;
      const isCircleArea = s.geometryType === "circle" && Array.isArray(s.circleCenter) && s.circleCenter.length === 2 && Number.isFinite(Number(s.circleCenter[0])) && Number.isFinite(Number(s.circleCenter[1])) && Number.isFinite(Number(s.circleRadiusNm)) && Number(s.circleRadiusNm) > 0;
      const poly = isCircleArea ? L.circle([Number(s.circleCenter[0]), Number(s.circleCenter[1])], {
        radius: Number(s.circleRadiusNm) * 1852,
        className: cls,
        color: strokeForState(id),
        weight: selectedId===id ? 2.6 : (effectiveState(id) === HAZDAM_STATE.ACTIVE ? 2.0 : 1.5),
        opacity: 1,
        fill: true,
        fillOpacity: 1,
        interactive: true
      }) : L.polygon(coords, {
        className: cls,
        color: strokeForState(id),
        weight: selectedId===id ? 2.6 : (effectiveState(id) === HAZDAM_STATE.ACTIVE ? 2.0 : 1.5),
        opacity: 1,
        fill: true,
        fillOpacity: 1,
        interactive: true
      });
      const geomSig = geometrySignature(s);
      const existingGeometryId = renderedGeometry.get(geomSig);
      let displayedPoly = poly;
      if(existingGeometryId && layersById[existingGeometryId] && layersById[existingGeometryId].poly){
        // Same published horizontal architecture: do not draw a second outline.
        displayedPoly = null;
        layersById[existingGeometryId].geometryMembers.push(id);
      } else {
        poly.__hazdamId = id;
        poly.on("click", () => { selectArea(id, false); openAreaPopup(id); });
        poly.addTo(layerGroup);
        renderedGeometry.set(geomSig, id);
      }

      const baseLabelPoint = isCircleArea ? [Number(s.circleCenter[0]), Number(s.circleCenter[1])] : polygonCentre(coords);
      const labelIndex = geometryLabelCount.get(geomSig) || 0;
      geometryLabelCount.set(geomSig, labelIndex + 1);
      const labelPoint = labelPointWithStalk(id, s, coords, isCircleArea, labelIndex);
      // Thin leader/stalk from the published DA footprint to its text.  This
      // keeps dense complexes readable without moving or changing geometry.
      const stalk = L.polyline([baseLabelPoint, labelPoint], {
        pane:"overlayPane", color:"#b40000", weight:0.7, opacity:0.58,
        interactive:false, className:"hazdam-label-stalk"
      }).addTo(layerGroup);
      const label = L.marker(labelPoint, {
        interactive: true,
        keyboard: true,
        icon: labelIcon(id,labelHtml(id))
      });
      label.__hazdamId = id;
      if(window.FISO_AREA_LABELS && window.FISO_AREA_LABELS.applies(id))label.__ffappAreaLayout={ref:window.FISO_AREA_LABELS.ref(id),points:coords.map(p=>({lat:p[0],lon:p[1]})),stalk};
      label.on("click", () => { selectArea(id, false); openAreaPopup(id); });
      label.addTo(layerGroup);
      layersById[id] = { poly: displayedPoly, label, stalk, sharedGeometryWith: existingGeometryId || null, geometryMembers:[id] };
    });

    if(visible) layerGroup.addTo(map);

    // Keep active/pending areas visually above inactive outlines.
    Object.keys(layersById).forEach(id => {
      const st = effectiveState(id);
      if((st === HAZDAM_STATE.ACTIVE || st === HAZDAM_STATE.PENDING) && layersById[id]?.poly){
        layersById[id].poly.bringToFront();
      }
    });
    if(selectedId && visiblePolyFor(selectedId)) visiblePolyFor(selectedId).bringToFront();

    refreshAllAreaLayers();
    updateLabelZoomClass();
    if(!editing) renderPanel();
    updateConflictVectors();
    console.log("HAZDAM draw complete:", Object.keys(layersById).length, "areas");
  }

  function strokeForState(id){
    const state = effectiveState(id);
    if(state === HAZDAM_STATE.ACTIVE) return "#ff2020";
    if(state === HAZDAM_STATE.PENDING) return "#ff2020";
    return "#ff2020";
  }

  function scrollDangerCardIntoView(id){
    if(!id) return;
    // The current UI nests DANGER AREAS inside the NOTAM PLOTTING workspace.
    // Scroll that workspace, not the browser/#side shell, so the main tabs stay visible.
    setTimeout(() => {
      const notamTab = document.getElementById("tab-notams");
      const subnav = document.getElementById("notamWorkspaceSubnav");
      const card = document.querySelector('[data-hazdam-card="' + String(id).replace(/"/g, '\\"') + '"]');
      if(!notamTab || !card) return;

      document.querySelectorAll(".hazdam-area-card.hazdam-map-selected").forEach(x => x.classList.remove("hazdam-map-selected"));
      card.classList.add("hazdam-map-selected");

      // Compute the selected card's position inside the NOTAM workspace.
      // Using bounding rectangles is robust after the Danger panel has been re-parented.
      const tabRect = notamTab.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const sticky = subnav ? subnav.offsetHeight + 18 : 18;
      const target = Math.max(0, notamTab.scrollTop + (cardRect.top - tabRect.top) - sticky - 12);

      if(typeof notamTab.scrollTo === "function"){
        notamTab.scrollTo({top: target, behavior:"smooth"});
      }else{
        notamTab.scrollTop = target;
      }

      setTimeout(() => card.classList.remove("hazdam-map-selected"), 3000);
    }, 180);
  }

  function selectArea(id, openPanel){
    if(editing) return;
    if(!STATIC[id]) return;
    selectedId = id;
    draw();
    if(window.FISO_AREA_SELECTION)window.FISO_AREA_SELECTION.start('DA:'+id,()=>visiblePolyFor(id));
    renderPanel();
    if(openPanel){
      openDangerTab();
      // renderStatusList may have just rebuilt the cards; allow the workspace
      // switch to complete before locating the selected card.
      setTimeout(() => scrollDangerCardIntoView(id), 40);
    }
  }

  function openDangerTab(){
    const side = document.getElementById("side");
    const notamTab = document.getElementById("tab-notams");
    const dangerPanel = document.querySelector('#tab-notams [data-notam-panel="danger"]') ||
                        document.querySelector('[data-notam-panel="danger"]');
    const subnav = document.getElementById("notamWorkspaceSubnav");

    if(side) side.classList.add("open");

    // Main navigation must remain on NOTAM PLOTTING. The original top-level
    // Danger button is hidden after setupNotamWorkspace() reparents the panel.
    document.querySelectorAll(".tab-btn").forEach(b => {
      b.classList.toggle("active", b.getAttribute("data-tab") === "notams");
    });

    // Only top-level panels are switched here. Do not hide the re-parented
    // Danger panel inside #tab-notams.
    document.querySelectorAll("#side > .tabpanel").forEach(p => {
      p.classList.toggle("hidden", p.id !== "tab-notams");
    });
    if(notamTab) notamTab.classList.remove("hidden");

    // Select the DANGER AREAS sub-tab visually.
    if(subnav){
      subnav.querySelectorAll("button[data-notam-sub]").forEach(b => {
        b.classList.toggle("primary", b.getAttribute("data-notam-sub") === "danger");
      });
    }

    // Move the workspace to the Danger Areas section first. The subsequent
    // card scroll then moves directly to the selected EGD/D area.
    if(notamTab && dangerPanel){
      requestAnimationFrame(() => {
        const sticky = subnav ? subnav.offsetHeight + 10 : 10;
        const target = Math.max(0, dangerPanel.offsetTop - sticky);
        if(typeof notamTab.scrollTo === "function"){
          notamTab.scrollTo({top: target, behavior:"auto"});
        }else{
          notamTab.scrollTop = target;
        }
      });
    }
  }

  function setVisible(on){
    visible = !!on;
    if(!map || !layerGroup) return;
    if(visible){
      if(!map.hasLayer(layerGroup)) layerGroup.addTo(map);
      updateConflictVectors();
    }else{
      if(map.hasLayer(layerGroup)) map.removeLayer(layerGroup);
      if(conflictVectorGroup) conflictVectorGroup.clearLayers();
    }
  }



  function deg2rad(d){ return d * Math.PI / 180; }
  function haversineNm(lat1, lon1, lat2, lon2){
    const R = 3440.065;
    const dLat = deg2rad(lat2-lat1), dLon = deg2rad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(deg2rad(lat1))*Math.cos(deg2rad(lat2))*Math.sin(dLon/2)**2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  function pointInPolygon(pt, poly){
    const lat = pt[0], lon = pt[1];
    let inside = false;
    for(let i=0, j=poly.length-1; i<poly.length; j=i++){
      const yi = poly[i][0], xi = poly[i][1];
      const yj = poly[j][0], xj = poly[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj-xi) * (lat-yi) / ((yj-yi) || 1e-12) + xi);
      if(intersect) inside = !inside;
    }
    return inside;
  }
  function toXY(originLat, originLon, lat, lon){
    const nmPerDegLat = 60;
    const nmPerDegLon = 60 * Math.cos(deg2rad(originLat));
    return { x:(lon-originLon)*nmPerDegLon, y:(lat-originLat)*nmPerDegLat };
  }
  function pointSegmentDistanceNm(p, a, b){
    const px = p.x, py = p.y, ax = a.x, ay = a.y, bx = b.x, by = b.y;
    const dx = bx-ax, dy = by-ay;
    const len2 = dx*dx + dy*dy;
    if(len2 <= 1e-12) return Math.sqrt((px-ax)**2 + (py-ay)**2);
    let t = ((px-ax)*dx + (py-ay)*dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t*dx, y = ay + t*dy;
    return Math.sqrt((px-x)**2 + (py-y)**2);
  }
  function distanceToPolygonNm(lat, lon, coords){
    if(pointInPolygon([lat, lon], coords)) return 0;
    const p = toXY(lat, lon, lat, lon);
    let min = Infinity;
    for(let i=0; i<coords.length-1; i++){
      const a = toXY(lat, lon, coords[i][0], coords[i][1]);
      const b = toXY(lat, lon, coords[i+1][0], coords[i+1][1]);
      min = Math.min(min, pointSegmentDistanceNm(p, a, b));
    }
    return min;
  }
  function acLabel(ac){ return ((ac.flight || '').trim() || ac.hex || '------').toUpperCase(); }
  function acAltText(ac){
    if(ac.alt_baro === 'ground') return 'GND';
    if(typeof ac.alt_baro === 'number') return Math.round(ac.alt_baro) + ' FT';
    if(typeof ac.alt_geom === 'number') return Math.round(ac.alt_geom) + ' FT';
    return 'ALT —';
  }
  function areaIsRelevantForConflict(id){
    if(!HAZDAM_CONFIG.enabled) return false;
    const st = effectiveState(id);
    return st === HAZDAM_STATE.PENDING || st === HAZDAM_STATE.ACTIVE;
  }
  function areasForConflictEngine(){
    return Object.keys(STATIC).map(id => {
      const area = Object.assign({}, STATIC[id]);
      const op = OPERATIONAL[id] || {};
      let st = effectiveState(id);

      // DEV Test Mode must be able to test any selected danger area even if
      // the operator has not manually made that area active. This is test-only;
      // real aircraft still use the real operational state.
      if(HAZDAM_CONFIG.devTestAircraft && id === HAZDAM_CONFIG.devTestAreaId){
        st = HAZDAM_STATE.ACTIVE;
      }

      area.operationalState = st;
      area.state = st;
      area.status = st;
      const lv = effectiveLevels(id);
      area.lower = lv.lower || area.lower || "";
      area.upper = lv.upper || area.upper || "";
      area.verticalToleranceFt = HAZDAM_CONFIG.verticalToleranceFt;
      return area;
    });
  }


  function areaObjectCentre(area){
    if(!area || !Array.isArray(area.coords) || !area.coords.length) return null;
    const coords = area.coords.slice();
    if(coords.length > 1 && samePoint(coords[0], coords[coords.length - 1])) coords.pop();
    if(!coords.length) return null;
    const sum = coords.reduce((acc, pt) => {
      acc.lat += Number(pt[0]);
      acc.lon += Number(pt[1]);
      return acc;
    }, { lat:0, lon:0 });
    return { lat: sum.lat / coords.length, lon: sum.lon / coords.length };
  }

  function areaBounds(area){
    if(!area || !Array.isArray(area.coords) || !area.coords.length) return null;
    const pts = area.coords.filter(pt => Array.isArray(pt) && Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1])));
    if(!pts.length) return null;
    return pts.reduce((b, pt) => {
      const lat = Number(pt[0]), lon = Number(pt[1]);
      b.minLat = Math.min(b.minLat, lat); b.maxLat = Math.max(b.maxLat, lat);
      b.minLon = Math.min(b.minLon, lon); b.maxLon = Math.max(b.maxLon, lon);
      return b;
    }, { minLat:Infinity, maxLat:-Infinity, minLon:Infinity, maxLon:-Infinity });
  }

  function pointEastOfArea(area, nm){
    const b = areaBounds(area);
    if(!b) return areaObjectCentre(area);
    const lat = (b.minLat + b.maxLat) / 2;
    const nmPerDegLon = Math.max(15, 60 * Math.cos(lat * Math.PI / 180));
    return { lat, lon: b.maxLon + (Number(nm || 2) / nmPerDegLon) };
  }

  function activeAreaCount(){
    return Object.keys(STATIC).filter(id => areaIsRelevantForConflict(id)).length;
  }

  function firstDangerAreaId(){
    return Object.keys(STATIC)[0] || "";
  }

  function normaliseDevAreaId(value){
    const id = String(value || "").trim();
    if(id && STATIC[id]) return id;
    if(HAZDAM_CONFIG.devTestAreaId && STATIC[HAZDAM_CONFIG.devTestAreaId]) return HAZDAM_CONFIG.devTestAreaId;
    return firstDangerAreaId();
  }

  function normaliseDevScenario(value){
    const s = String(value || "inside").trim().toLowerCase();
    return ["inside", "near", "predict", "outside"].includes(s) ? s : "inside";
  }

  function normaliseDevSquawk(value){
    const sqk = String(value || "1177").replace(/\D/g, "").padStart(4, "0").slice(-4);
    return isProtectedSquawk(sqk) ? sqk : "1177";
  }

  function normaliseFiniteNumber(value, fallback, min, max){
    const n = Number(value);
    if(!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function buildDevAreaOptions(selected){
    const current = normaliseDevAreaId(selected);
    return Object.keys(STATIC)
      .sort((a,b) => String(STATIC[a].display || a).localeCompare(String(STATIC[b].display || b), undefined, {numeric:true}))
      .map(id => {
        const a = STATIC[id] || {};
        const label = (a.display || id) + (a.name ? " — " + a.name : "");
        return `<option value="${safe(id)}" ${id===current?'selected':''}>${safe(label)}</option>`;
      }).join('');
  }

  function buildDevTestAircraft(){
    if(!HAZDAM_CONFIG.devTestAircraft) return null;

    const areaId = normaliseDevAreaId(HAZDAM_CONFIG.devTestAreaId);
    const area = STATIC[areaId];
    if(!area || !Array.isArray(area.coords) || !area.coords.length) return null;

    const scenario = normaliseDevScenario(HAZDAM_CONFIG.devTestScenario);
    const squawk = normaliseDevSquawk(HAZDAM_CONFIG.devTestSquawk);
    const altitudeFt = Math.round(normaliseFiniteNumber(HAZDAM_CONFIG.devTestAltitudeFt, 3000, 0, 70000));
    const speedKt = Math.round(normaliseFiniteNumber(HAZDAM_CONFIG.devTestGroundspeedKt, 120, 10, 700));
    const headingDeg = Math.round(normaliseFiniteNumber(HAZDAM_CONFIG.devTestHeadingDeg, 270, 0, 359));

    let pos;
    let track = headingDeg;
    let gs = speedKt;

    if(scenario === "outside"){
      pos = pointEastOfArea(area, 15);
      gs = 90;
      track = 90;
    }else if(scenario === "near"){
      pos = pointEastOfArea(area, 1.6);
      track = 270;
    }else if(scenario === "predict"){
      pos = pointEastOfArea(area, 5.5);
      track = 270;
      gs = Math.max(speedKt, 120);
    }else{
      pos = areaObjectCentre(area);
    }

    if(!pos) return null;
    return {
      hex: "HAZDAMTEST",
      flight: "HAZTEST",
      callsign: "HAZTEST",
      squawk,
      lat: Number(pos.lat),
      lon: Number(pos.lon),
      alt_baro: altitudeFt,
      track,
      gs,
      __hazdamDevTest: true,
      __hazdamDevAreaId: areaId,
      __hazdamDevScenario: scenario
    };
  }

  function aircraftListForConflictEngine(realList){
    const list = Array.isArray(realList) ? realList.slice() : [];
    const testAircraft = buildDevTestAircraft();
    if(testAircraft) list.push(testAircraft);
    return list;
  }

  function checkConflicts(){
    const traffic = window.FISO_FID_TRAFFIC;
    const realList = traffic && Array.isArray(traffic.visibleList) ? traffic.visibleList : [];
    lastTrafficCount = realList.length;
    lastProtectedTrafficCount = realList.filter(ac => isProtectedSquawk(ac.squawk)).length;
    const list = aircraftListForConflictEngine(realList);

    if(window.FISO_CONFLICT_ENGINE && typeof window.FISO_CONFLICT_ENGINE.evaluateAircraftList === "function"){
      const engineConflicts = window.FISO_CONFLICT_ENGINE.evaluateAircraftList(list, areasForConflictEngine());
      // ACKs suppress flashing only for a continuously active conflict. If an
      // aircraft leaves the 3 NM / 500 FT hazard condition, forget that ACK so
      // a later re-entry is treated as a new alert.
      const activeKeys = new Set(engineConflicts.map(c => conflictKey(c.aircraftHex, c.dangerAreaId)));
      Object.keys(ackedConflicts).forEach(k => { if(!activeKeys.has(k)) delete ackedConflicts[k]; });
      currentConflicts = engineConflicts.map(c => ({
        hex: c.aircraftHex,
        callsign: c.callsign,
        squawk: c.squawk,
        altitude: acAltText(c.aircraft && c.aircraft.raw ? c.aircraft.raw : c.aircraft),
        areaId: c.dangerAreaId,
        areaDisplay: c.dangerArea,
        distanceNm: c.distanceNm,
        inside: c.status === "INSIDE",
        predicted: c.status === "PREDICTED",
        status: c.status,
        etaMinutes: c.etaMinutes,
        etaText: c.etaText,
        bearingToArea: c.bearingToArea,
        state: c.areaState,
        aircraftLat: c.aircraftLat,
        aircraftLon: c.aircraftLon,
        conflictLat: c.conflictLat,
        conflictLon: c.conflictLon,
        nearestBoundaryLat: c.nearestBoundaryLat,
        nearestBoundaryLon: c.nearestBoundaryLon,
        severity: typeof c.severity === "number" ? c.severity : (c.status === "INSIDE" ? 0 : c.status === "NEAR" ? 1 : 2),
        verticalStatus: c.verticalStatus || "UNKNOWN",
        verticalText: c.verticalText || "Vertical: unknown",
        verticalDeltaFt: c.verticalDeltaFt,
        verticalWithinLimits: c.verticalWithinLimits,
        verticalWithinTolerance: c.verticalWithinTolerance,
        devTest: !!(c.aircraft && c.aircraft.raw && c.aircraft.raw.__hazdamDevTest),
        acked: isConflictAcked(c.aircraftHex, c.dangerAreaId)
      })).sort((a,b) => (a.severity - b.severity) || ((a.etaMinutes || 0) - (b.etaMinutes || 0)) || (a.distanceNm - b.distanceNm));
      renderConflictList();
      updateDevTestMarker();
      updateConflictVectors();
      return currentConflicts;
    }

    // Fallback path if conflictEngine.js is not loaded.
    const conflicts = [];
    list.forEach(ac => {
      const sqk = String(ac.squawk || '').padStart(4,'0');
      if(!isProtectedSquawk(sqk)) return;
      if(typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return;
      let nearest = null;
      Object.keys(STATIC).forEach(id => {
        if(!areaIsRelevantForConflict(id)) return;
        const dist = distanceToPolygonNm(ac.lat, ac.lon, STATIC[id].coords);
        if(dist <= HAZDAM_CONFIG.conflictBufferNm){
          const inside = dist === 0 && pointInPolygon([ac.lat, ac.lon], STATIC[id].coords);
          const item = { hex:ac.hex, callsign:acLabel(ac), squawk:sqk, altitude:acAltText(ac), areaId:id, areaDisplay:STATIC[id].display, distanceNm:dist, inside, predicted:false, status: inside ? "INSIDE" : "NEAR", etaMinutes:0, etaText: inside ? "NOW" : "CURRENT", bearingToArea:null, aircraftLat:ac.lat, aircraftLon:ac.lon, conflictLat:ac.lat, conflictLon:ac.lon, nearestBoundaryLat:null, nearestBoundaryLon:null, severity: inside ? 0 : 1, state:effectiveState(id), devTest: !!ac.__hazdamDevTest, acked: isConflictAcked(ac.hex, id) };
          if(!nearest || item.distanceNm < nearest.distanceNm) nearest = item;
        }
      });
      if(nearest) conflicts.push(nearest);
    });
    conflicts.sort((a,b) => a.distanceNm - b.distanceNm);
    currentConflicts = conflicts;
    renderConflictList();
    updateDevTestMarker();
    updateConflictVectors();
    return currentConflicts;
  }


  function conflictKey(hex, areaId){
    return String(hex || "") + "|" + String(areaId || "");
  }

  function isConflictAcked(hex, areaId){
    return !!ackedConflicts[conflictKey(hex, areaId)];
  }

  function ackConflict(hex, areaId){
    if(!hex || !areaId) return;
    ackedConflicts[conflictKey(hex, areaId)] = { at: new Date().toISOString() };
    checkConflicts();
    if(window.FISO_FID_TRAFFIC && Array.isArray(window.FISO_FID_TRAFFIC.visibleList)){
      try{ window.FISO_FID_TRAFFIC.visibleList.forEach(ac => { if(ac && ac.hex === hex && window.HAZDAM && window.HAZDAM.checkConflicts){} }); }catch(e){}
    }
  }

  function clearAckForScenario(){
    Object.keys(ackedConflicts).forEach(k => { if(k.indexOf("HAZDAMTEST|") === 0) delete ackedConflicts[k]; });
  }

  function getAlertForHex(hex){
    if(!hex) return null;
    return currentConflicts.find(c => c.hex === hex && !c.acked) || null;
  }

  function setDevScenario(scenario, options){
    if(scenario === "clear"){
      HAZDAM_CONFIG.devTestAircraft = false;
      HAZDAM_CONFIG.devTestScenario = "clear";
      clearAckForScenario();
    }else{
      const opts = options || {};
      HAZDAM_CONFIG.devTestAircraft = true;
      HAZDAM_CONFIG.devTestScenario = normaliseDevScenario(scenario);
      HAZDAM_CONFIG.devTestAreaId = normaliseDevAreaId(opts.areaId || HAZDAM_CONFIG.devTestAreaId);
      HAZDAM_CONFIG.devTestSquawk = normaliseDevSquawk(opts.squawk || HAZDAM_CONFIG.devTestSquawk);
      HAZDAM_CONFIG.devTestAltitudeFt = Math.round(normaliseFiniteNumber(opts.altitudeFt, HAZDAM_CONFIG.devTestAltitudeFt || 3000, 0, 70000));
      HAZDAM_CONFIG.devTestHeadingDeg = Math.round(normaliseFiniteNumber(opts.headingDeg, HAZDAM_CONFIG.devTestHeadingDeg || 270, 0, 359));
      HAZDAM_CONFIG.devTestGroundspeedKt = Math.round(normaliseFiniteNumber(opts.groundspeedKt, HAZDAM_CONFIG.devTestGroundspeedKt || 120, 10, 700));
      clearAckForScenario();
    }
    drawAll();
    renderSelectedPanel();
    renderStatusList();
    renderTestLab(true);
    checkConflicts();
  }

  function conflictStatusText(c){
    if(!c) return "";
    if(c.inside || c.status === "INSIDE") return "INSIDE";
    if(c.predicted || c.status === "PREDICTED") return "ETA " + safe(c.etaText || "--:--");
    if(typeof c.distanceNm === "number") return c.distanceNm.toFixed(1) + " NM";
    return "NEAR";
  }

  function conflictMetaText(c){
    const parts = [];
    if(c.devTest) parts.push("DEV TEST");
    if(c.altitude) parts.push(safe(c.altitude));
    parts.push(safe(stateText(c.state)));
    if(c.verticalText) parts.push(safe(c.verticalText));
    if(typeof c.bearingToArea === "number" && !c.inside) parts.push("BRG " + Math.round(c.bearingToArea).toString().padStart(3,"0") + "°");
    if(c.predicted && c.etaText) parts.push("PREDICTED ENTRY");
    return parts.join(" · ");
  }


  function centreOnConflict(hex, areaId){
    const c = currentConflicts.find(x => x.hex === hex && x.areaId === areaId);
    if(!c || !map) return;
    const ac = (window.FISO_FID_TRAFFIC && window.FISO_FID_TRAFFIC.latest && window.FISO_FID_TRAFFIC.latest[hex]) || null;
    const aLat = Number(c.aircraftLat), aLon = Number(c.aircraftLon);
    const bLat = Number(c.nearestBoundaryLat), bLon = Number(c.nearestBoundaryLon);
    if(Number.isFinite(aLat) && Number.isFinite(aLon) && Number.isFinite(bLat) && Number.isFinite(bLon) && window.L){
      map.fitBounds(L.latLngBounds([[aLat, aLon], [bLat, bLon]]).pad(0.35), { maxZoom: 10 });
    }else if(ac && typeof ac.lat === "number" && typeof ac.lon === "number"){
      map.setView([ac.lat, ac.lon], Math.max(map.getZoom ? map.getZoom() : 8, 8));
    }else if(c.devTest){
      const testAc = buildDevTestAircraft();
      if(testAc) map.setView([testAc.lat, testAc.lon], 8);
    }
  }

  function ackAllConflicts(){
    currentConflicts.forEach(c => { if(c && !c.acked) ackedConflicts[conflictKey(c.hex, c.areaId)] = { at: new Date().toISOString() }; });
    checkConflicts();
  }

  function updateDevTestMarker(){
    if(!map || !window.L) return;
    const ac = buildDevTestAircraft();
    if(!ac){
      if(devTestMarker){ map.removeLayer(devTestMarker); devTestMarker = null; }
      return;
    }
    const conflict = currentConflicts.find(c => c.hex === "HAZDAMTEST");
    const isAlerting = !!(conflict && !conflict.acked);
    const html = `<div class="hazdam-dev-aircraft ${isAlerting ? "hazdam-dev-aircraft-alert" : ""}"><div>✈</div><span>HAZTEST<br>${safe(ac.squawk)}</span></div>`;
    const icon = L.divIcon({ className:"hazdam-dev-aircraft-icon", html, iconSize:[64,40], iconAnchor:[32,20] });
    if(!devTestMarker){
      devTestMarker = L.marker([ac.lat, ac.lon], { icon, interactive:true }).addTo(layerGroup || map);
    }else{
      devTestMarker.setLatLng([ac.lat, ac.lon]);
      devTestMarker.setIcon(icon);
    }
    devTestMarker.bindPopup(`<div class="pop"><h3>HAZDAM DEV TEST</h3><div class="row"><span class="pl">Area</span><b>${safe(HAZDAM_CONFIG.devTestAreaId)}</b></div><div class="row"><span class="pl">Squawk</span><b>${safe(ac.squawk)}</b></div><div class="row"><span class="pl">Scenario</span><b>${safe(HAZDAM_CONFIG.devTestScenario)}</b></div></div>`);
  }

  function ensureConflictVectorGroup(){
    if(!map || !window.L) return null;
    if(!conflictVectorGroup){
      conflictVectorGroup = L.layerGroup().addTo(map);
    }
    return conflictVectorGroup;
  }

  function updateConflictVectors(){
    if(!map || !window.L) return;
    const group = ensureConflictVectorGroup();
    if(!group) return;
    group.clearLayers();
    currentConflicts.forEach(c => {
      if(!c || c.acked) return;
      const aLat = Number(c.aircraftLat), aLon = Number(c.aircraftLon);
      const bLat = Number(c.nearestBoundaryLat), bLon = Number(c.nearestBoundaryLon);
      if(!Number.isFinite(aLat) || !Number.isFinite(aLon) || !Number.isFinite(bLat) || !Number.isFinite(bLon)) return;
      const line = L.polyline([[aLat, aLon], [bLat, bLon]], {
        className: 'hazdam-conflict-vector',
        color: c.predicted ? '#ffb648' : '#ff2020',
        weight: c.inside ? 1.4 : 2.2,
        opacity: 0.92,
        dashArray: c.predicted ? '8 6' : (c.inside ? '3 5' : null),
        interactive: false
      });
      line.addTo(group);
      const dot = L.circleMarker([bLat, bLon], {
        className: 'hazdam-conflict-boundary-dot',
        radius: 4,
        weight: 1,
        color: c.predicted ? '#ffb648' : '#ff2020',
        fillColor: c.predicted ? '#ffb648' : '#ff2020',
        fillOpacity: 0.85,
        interactive: false
      });
      dot.addTo(group);
    });
  }

  function renderTestLab(force){
    const el = document.getElementById('hazdamTestLab');
    if(!el) return;

    // Do not redraw the Test Lab while the operator is using a control.
    // The conflict list refreshes every second; without this guard, open
    // dropdowns get destroyed before the user can select anything.
    if(!force && document.activeElement && el.contains(document.activeElement)) return;

    const currentAreaId = normaliseDevAreaId(HAZDAM_CONFIG.devTestAreaId);
    HAZDAM_CONFIG.devTestAreaId = currentAreaId;
    const areaOptions = buildDevAreaOptions(currentAreaId);
    const squawkOptions = getProtectedSquawks().map(sqk => `<option value="${safe(sqk)}" ${sqk===normaliseDevSquawk(HAZDAM_CONFIG.devTestSquawk)?'selected':''}>${safe(sqk)}</option>`).join('');
    const scenario = normaliseDevScenario(HAZDAM_CONFIG.devTestScenario);

    el.innerHTML = `<div class="hazdam-dev-test-panel hazdam-test-lab">
      <div class="hazdam-dev-test-title">HAZDAM Test Lab</div>
      <div class="hazdam-test-grid">
        <div class="field"><label for="hazdamDevArea">Area</label><select id="hazdamDevArea">${areaOptions}</select></div>
        <div class="field"><label for="hazdamDevScenario">Scenario</label><select id="hazdamDevScenario">
          <option value="inside" ${scenario==='inside'?'selected':''}>INSIDE</option>
          <option value="near" ${scenario==='near'?'selected':''}>1.8 NM</option>
          <option value="predict" ${scenario==='predict'?'selected':''}>PREDICT</option>
          <option value="outside" ${scenario==='outside'?'selected':''}>OUTSIDE</option>
        </select></div>
        <div class="field"><label for="hazdamDevSquawk">Squawk</label><select id="hazdamDevSquawk">${squawkOptions}</select></div>
        <div class="field"><label for="hazdamDevAlt">Altitude ft</label><input id="hazdamDevAlt" type="number" value="${safe(HAZDAM_CONFIG.devTestAltitudeFt || 3000)}" min="0" max="70000" step="100"></div>
        <div class="field"><label for="hazdamDevHdg">Heading</label><input id="hazdamDevHdg" type="number" value="${safe(HAZDAM_CONFIG.devTestHeadingDeg || 270)}" min="0" max="359" step="1"></div>
        <div class="field"><label for="hazdamDevGs">GS kt</label><input id="hazdamDevGs" type="number" value="${safe(HAZDAM_CONFIG.devTestGroundspeedKt || 120)}" min="10" max="700" step="5"></div>
      </div>
      <div class="hazdam-dev-test-buttons">
        <button class="btn primary" type="button" id="hazdamDevCreate">Create Test</button>
        <button class="btn danger" type="button" id="hazdamDevClear">Clear Test</button>
      </div>
      <p class="hint">Selected: ${safe((STATIC[currentAreaId] && (STATIC[currentAreaId].display || currentAreaId)) || currentAreaId)} · Vertical tolerance ${HAZDAM_CONFIG.verticalToleranceFt} ft · active/pending areas: ${activeAreaCount()}.</p>
    </div>`;

    wireTestLab(el);
  }

  function readTestLabOptions(root){
    const el = root || document;
    const areaSel = el.querySelector('#hazdamDevArea');
    const scenarioSel = el.querySelector('#hazdamDevScenario');
    const squawkSel = el.querySelector('#hazdamDevSquawk');
    const altInput = el.querySelector('#hazdamDevAlt');
    const hdgInput = el.querySelector('#hazdamDevHdg');
    const gsInput = el.querySelector('#hazdamDevGs');
    return {
      areaId: areaSel ? areaSel.value : HAZDAM_CONFIG.devTestAreaId,
      scenario: scenarioSel ? scenarioSel.value : HAZDAM_CONFIG.devTestScenario,
      squawk: squawkSel ? squawkSel.value : HAZDAM_CONFIG.devTestSquawk,
      altitudeFt: altInput ? altInput.value : HAZDAM_CONFIG.devTestAltitudeFt,
      headingDeg: hdgInput ? hdgInput.value : HAZDAM_CONFIG.devTestHeadingDeg,
      groundspeedKt: gsInput ? gsInput.value : HAZDAM_CONFIG.devTestGroundspeedKt
    };
  }

  function applyTestLabValues(opts){
    HAZDAM_CONFIG.devTestAreaId = normaliseDevAreaId(opts.areaId);
    HAZDAM_CONFIG.devTestScenario = normaliseDevScenario(opts.scenario);
    HAZDAM_CONFIG.devTestSquawk = normaliseDevSquawk(opts.squawk);
    HAZDAM_CONFIG.devTestAltitudeFt = Math.round(normaliseFiniteNumber(opts.altitudeFt, HAZDAM_CONFIG.devTestAltitudeFt || 3000, 0, 70000));
    HAZDAM_CONFIG.devTestHeadingDeg = Math.round(normaliseFiniteNumber(opts.headingDeg, HAZDAM_CONFIG.devTestHeadingDeg || 270, 0, 359));
    HAZDAM_CONFIG.devTestGroundspeedKt = Math.round(normaliseFiniteNumber(opts.groundspeedKt, HAZDAM_CONFIG.devTestGroundspeedKt || 120, 10, 700));
  }

  function wireTestLab(root){
    const create = root.querySelector('#hazdamDevCreate');
    const clear = root.querySelector('#hazdamDevClear');
    const areaSel = root.querySelector('#hazdamDevArea');
    const controls = root.querySelectorAll('#hazdamDevArea, #hazdamDevScenario, #hazdamDevSquawk, #hazdamDevAlt, #hazdamDevHdg, #hazdamDevGs');

    controls.forEach(ctrl => {
      ctrl.addEventListener('change', () => {
        applyTestLabValues(readTestLabOptions(root));
      });
    });

    if(areaSel){
      areaSel.addEventListener('change', () => {
        applyTestLabValues(readTestLabOptions(root));
      });
    }

    if(create){
      create.addEventListener('click', ev => {
        ev.preventDefault();
        const opts = readTestLabOptions(root);
        applyTestLabValues(opts);
        setDevScenario(HAZDAM_CONFIG.devTestScenario, opts);
        renderTestLab(true);
      });
    }

    if(clear){
      clear.addEventListener('click', ev => {
        ev.preventDefault();
        setDevScenario('clear');
        renderTestLab(true);
      });
    }
  }

  function renderConflictList(){
    const el = document.getElementById('hazdamConflictList');
    if(!el) return;

    if(!currentConflicts.length){
      el.innerHTML = '<p class="empty-note">No HAZDAM conflicts detected.</p><p class="hint">Live monitoring active · ' + lastTrafficCount + ' aircraft checked · ' + lastProtectedTrafficCount + ' protected squawk(s) · ' + activeAreaCount() + ' active/pending area(s).</p>';
      wireConflictPanel(el);
      return;
    }
    const ackAll = currentConflicts.some(c => !c.acked) ? '<div class="btn-row" style="margin-bottom:8px;"><button class="btn danger" type="button" data-hazdam-ack-all="1">ACK all current HAZDAM alerts</button></div>' : '';
    el.innerHTML = ackAll + currentConflicts.map(c => {
      const statusText = conflictStatusText(c);
      const ackText = c.acked ? '<span class="hazdam-acked">ACKED</span>' : `<button class="btn danger hazdam-ack-btn" type="button" data-hazdam-ack-hex="${safe(c.hex)}" data-hazdam-ack-area="${safe(c.areaId)}">ACK</button>`;
      const verticalLine = c.verticalText ? `<div class="hazdam-conflict-vertical">${safe(c.verticalText)}</div>` : '';
      return `<div class="hazdam-conflict-row ${c.acked ? 'hazdam-conflict-acked' : 'hazdam-conflict-alert'} ${c.predicted ? 'hazdam-conflict-predicted' : ''}" data-hazdam-conflict-area="${safe(c.areaId)}" data-hazdam-conflict-hex="${safe(c.hex)}">
        <div class="hazdam-conflict-top"><b>${safe(c.callsign)}${c.devTest ? ' <span style="color:#ffb648;">SIM</span>' : ''}</b><span>${safe(c.squawk)}</span></div>
        <div class="hazdam-conflict-main"><span>${safe(c.areaDisplay)}</span><b>${statusText}</b></div>
        ${verticalLine}
        <div class="hazdam-conflict-meta">${conflictMetaText(c)}</div>
        <div class="hazdam-conflict-actions">
          ${ackText}
          <button class="btn" type="button" data-hazdam-centre-hex="${safe(c.hex)}" data-hazdam-centre-area="${safe(c.areaId)}">Centre</button>
          <button class="btn" type="button" data-hazdam-open-area="${safe(c.areaId)}">Open Area</button>
        </div>
      </div>`;
    }).join('');
    wireConflictPanel(el);
  }

  function wireConflictPanel(el){
    el.querySelectorAll('[data-hazdam-conflict-area]').forEach(row => row.addEventListener('click', ev => {
      if(ev.target && ev.target.closest && ev.target.closest('button')) return;
      selectArea(row.getAttribute('data-hazdam-conflict-area'), true);
    }));

    el.querySelectorAll('[data-hazdam-ack-hex]').forEach(btn => btn.addEventListener('click', ev => {
      ev.preventDefault();
      ackConflict(btn.getAttribute('data-hazdam-ack-hex'), btn.getAttribute('data-hazdam-ack-area'));
    }));
    el.querySelectorAll('[data-hazdam-ack-all]').forEach(btn => btn.addEventListener('click', ev => {
      ev.preventDefault();
      ackAllConflicts();
    }));
    el.querySelectorAll('[data-hazdam-centre-hex]').forEach(btn => btn.addEventListener('click', ev => {
      ev.preventDefault();
      centreOnConflict(btn.getAttribute('data-hazdam-centre-hex'), btn.getAttribute('data-hazdam-centre-area'));
    }));
    el.querySelectorAll('[data-hazdam-open-area]').forEach(btn => btn.addEventListener('click', ev => {
      ev.preventDefault();
      selectArea(btn.getAttribute('data-hazdam-open-area'), true);
    }));
  }


  function directEditingAreaId(){
    const el = document.getElementById("hazdamStatusList");
    return el ? String(el.dataset.editingArea || "") : "";
  }

  function directCardIsEditing(id){
    const current = directEditingAreaId();
    return !!current && (!id || String(current) === String(id));
  }

  function renderPanel(){
    renderConflictList();

    // Release171: do not rebuild the Danger Area cards while an operator is
    // typing. Re-rendering every second was destroying the edit form.
    if(!directCardIsEditing()) renderStatusList();
  }

  function renderSelectedPanel(){
    if(editing) return;
    const el = document.getElementById("hazdamSelectedPanel");
    if(!el) return;
    if(!selectedId){
      el.innerHTML = `<p class="empty-note">Click a danger area polygon or label to select it.</p>`;
      return;
    }
    const s = STATIC[selectedId];
    const o = OPERATIONAL[selectedId] || defaultOp(selectedId);
    const lv = effectiveLevels(selectedId);
    const timing = effectiveTiming(selectedId);
    const updated = o.updatedAt ? `${safe(o.updatedAt)}${o.updatedBy ? " by " + safe(o.updatedBy) : ""}` : "Not updated this session";
    el.innerHTML = `<div class="hazdam-detail" data-hazdam-selected="${selectedId}">
      <div class="hazdam-detail-head">
        <div><div class="hazdam-detail-id">${safe(s.display)}</div><div class="hazdam-detail-name">${safe(s.name)}</div></div>
        <div class="hazdam-detail-actions">
          <div class="hazdam-state-pill ${areaStateClass(selectedId)}">${stateText(effectiveState(selectedId))}</div>
          ${isAdmin() ? `<button class="btn hazdam-inline-edit" id="hazdamEditBtnTop" type="button">EDIT</button>` : ""}
        </div>
      </div>
      <p class="hint" id="hazdamSyncStatus" style="margin-top:4px;">${safe(syncLabel())}</p>
      <div class="hazdam-detail-grid">
        <span>Effective state</span><b>${safe(stateText(effectiveState(selectedId)))}</b>
        <span>Manual state</span><b>${safe(stateText(o.state))}${isTimeControlled(selectedId) ? " (time overridden)" : ""}</b>
        <span>Today's lower</span><b>${safe(lv.lower)}</b>
        <span>Today's upper</span><b>${safe(lv.upper)}</b>
        <span>Start UTC</span><b>${safe(timing.startUTC || "Not set")}</b>
        <span>End UTC</span><b>${safe(timing.endUTC || "Not set")}</b>
        <span>Source</span><b>${safe(lv.source)}</b>
        <span>Updated</span><b>${updated}</b>
      </div>
      <div class="hazdam-notes"><span>Notes</span><p>${safe(o.notes || "No notes.")}</p></div>
      <div class="hazdam-official"><span>Official published levels</span><b>${safe(s.lower)}-${safe(s.upper)}</b></div>
      ${isAdmin() ? `<button class="btn primary full" id="hazdamEditBtn">Edit ${safe(s.display)}</button>` : `<p class="hint">Operator view is read-only.</p>`}
      <div id="hazdamEditFormWrap"></div>
    </div>`;
    const editBtn = document.getElementById("hazdamEditBtn");
    const editBtnTop = document.getElementById("hazdamEditBtnTop");
    [editBtn, editBtnTop].filter(Boolean).forEach(btn => btn.addEventListener("click", () => { renderEditForm(); scrollToHazdamEdit(); }));
  }

  function normaliseLevelForValidation(v){
    return String(v || "")
      .trim()
      .toUpperCase()
      .replace(/\b(AMSL|ALT|AGL)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function validLevel(v){
    const x = normaliseLevelForValidation(v);
    if(!x) return true;
    return /^(SFC|UNL|GND|FL\s?\d{1,3}|\d{1,5}\s?FT|\d{1,5})$/.test(x);
  }

  function validateEdit(next){
    if(parseHHMM(next.startUTC) === null && next.startUTC) return "Start UTC must be a valid UTC time.";
    if(parseHHMM(next.endUTC) === null && next.endUTC) return "End UTC must be a valid UTC time.";
    if((next.startUTC && !next.endUTC) || (!next.startUTC && next.endUTC)) return "Enter both Start UTC and End UTC, or leave both blank.";
    if(!validLevel(next.lower)) return "Lower level must be SFC, UNL, FLxxx or a feet value.";
    if(!validLevel(next.upper)) return "Upper level must be SFC, UNL, FLxxx or a feet value.";
    return "";
  }

  function stopEditing(renderReadOnly){
    editing = false;
    editCopy = null;
    if(renderReadOnly) renderPanel();
  }

  function renderEditForm(){
    if(!selectedId) return;
    const wrap = document.getElementById("hazdamEditFormWrap");
    if(!wrap) return;
    editing = true;
    editCopy = Object.assign(defaultOp(selectedId), JSON.parse(JSON.stringify(OPERATIONAL[selectedId] || {})));
    const o = editCopy;
    wrap.innerHTML = `<form id="hazdamEditForm" class="hazdam-edit-form">
      <p class="hint" style="color:var(--cyan);margin-top:8px;">Edit mode locked — scheduler will not close this form.</p>
      <p class="hint" id="hazdamEditError" style="display:none;color:var(--red);font-weight:700;"></p>
      <div class="field"><label>State</label><select id="hazdamEditState">
        <option value="inactive" ${o.state==="inactive"?"selected":""}>Inactive</option>
        <option value="pending" ${o.state==="pending"?"selected":""}>Pending</option>
        <option value="active" ${o.state==="active"?"selected":""}>Active</option>
      </select></div>
      ${(() => {
        const lowerEdit = splitLevelForEdit(o.lower, STATIC[selectedId]?.lower || "SFC");
        const upperEdit = splitLevelForEdit(o.upper, STATIC[selectedId]?.upper || "UNL");
        return `<div class="row2">
          <div class="field"><label>Lower level</label><div class="hazdam-level-edit"><select id="hazdamEditLowerUnit"><option value="ALT" ${lowerEdit.unit==="ALT"?"selected":""}>ALT</option><option value="FL" ${lowerEdit.unit==="FL"?"selected":""}>FL</option></select><input id="hazdamEditLower" type="text" value="${safe(lowerEdit.value)}" placeholder="SFC"></div></div>
          <div class="field"><label>Upper level</label><div class="hazdam-level-edit"><select id="hazdamEditUpperUnit"><option value="ALT" ${upperEdit.unit==="ALT"?"selected":""}>ALT</option><option value="FL" ${upperEdit.unit==="FL"?"selected":""}>FL</option></select><input id="hazdamEditUpper" type="text" value="${safe(upperEdit.value)}" placeholder="UNL"></div></div>
        </div>`;
      })()}
      <div class="row2">
        <div class="field"><label>Start UTC</label><input id="hazdamEditStart" type="time" value="${safe(o.startUTC)}"></div>
        <div class="field"><label>End UTC</label><input id="hazdamEditEnd" type="time" value="${safe(o.endUTC)}"></div>
      </div>
      <div class="field"><label>Source</label><input id="hazdamEditSource" type="text" value="${safe(o.source || "Manual")}" placeholder="Manual / NOTAM / Telephone"></div>
      <div class="field"><label>Notes</label><textarea id="hazdamEditNotes" rows="4" placeholder="Operational notes">${safe(o.notes)}</textarea></div>
      <div class="btn-row"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="hazdamCancelEdit">Cancel</button></div>
    </form>`;
    document.getElementById("hazdamCancelEdit")?.addEventListener("click", () => stopEditing(true));
    document.getElementById("hazdamEditForm")?.addEventListener("submit", ev => {
      ev.preventDefault();
      const next = Object.assign(defaultOp(selectedId), editCopy || {});
      next.state = document.getElementById("hazdamEditState").value;
      next.lower = combineLevelFromEdit(document.getElementById("hazdamEditLowerUnit")?.value, document.getElementById("hazdamEditLower")?.value, STATIC[selectedId]?.lower || "SFC");
      next.upper = combineLevelFromEdit(document.getElementById("hazdamEditUpperUnit")?.value, document.getElementById("hazdamEditUpper")?.value, STATIC[selectedId]?.upper || "UNL");
      next.startUTC = document.getElementById("hazdamEditStart").value;
      next.endUTC = document.getElementById("hazdamEditEnd").value;
      next.source = document.getElementById("hazdamEditSource").value.trim() || "Manual";
      next.notes = document.getElementById("hazdamEditNotes").value.trim();
      const err = validateEdit(next);
      const errEl = document.getElementById("hazdamEditError");
      if(err){
        if(errEl){ errEl.textContent = err; errEl.style.display = "block"; }
        return;
      }
      next.updatedBy = isAdmin() ? "ADMIN" : "OPERATOR";
      next.updatedAt = new Date().toISOString();
      OPERATIONAL[selectedId] = next;
      saveOperational();
      const savedId = selectedId;
      stopEditing(false);
      draw();
      checkConflicts();
      saveAreaToFirebase(savedId);
    });
  }

  function removeArea(id){
    id = String(id || "").trim();
    if(!id || !STATIC[id]) return false;
    const label = String(STATIC[id].display || STATIC[id].name || id);
    if(!window.confirm("Are you sure you want to delete " + label + " from FFApp Danger Areas?")) return false;
    delete STATIC[id];
    delete OPERATIONAL[id];
    try {
      if(window.FISO_DATA && window.FISO_DATA.dangerAreas) delete window.FISO_DATA.dangerAreas[id];
      if(window.FFAPP_ENR_DA_STORE && typeof window.FFAPP_ENR_DA_STORE.remove === "function") window.FFAPP_ENR_DA_STORE.remove(id);
    } catch(e){}
    saveOperational();
    if(selectedId === id) selectedId = Object.keys(STATIC)[0] || "";
    editing = false; editCopy = null;
    draw(); checkConflicts(); renderPanel();
    return true;
  }

  function naturalAreaSort(a, b){
    const da = STATIC[a] || {}, db = STATIC[b] || {};
    const aa = String(da.display || da.id || a);
    const bb = String(db.display || db.id || b);
    return aa.localeCompare(bb, undefined, { numeric: true, sensitivity: "base" });
  }

  let lastStatusElement=null, lastStatusMarkup=null;
  function statusListIsPainted(el){
    if(!el || !el.isConnected || document.hidden) return false;
    if(!el.getClientRects || !el.getClientRects().length) return false;
    const side=document.getElementById("side");
    if(side && side.getBoundingClientRect && side.getBoundingClientRect().width<=0) return false;
    return true;
  }

  function watchStatusListVisibility(){
    const el=document.getElementById("hazdamStatusList");
    if(!el) return;
    let queued=false;
    const refresh=()=>{
      if(queued) return;
      queued=true;
      requestAnimationFrame(()=>{queued=false;renderStatusList();});
    };
    // Observer reacts to reveal/resizing even when the panel was never rendered.
    if(typeof ResizeObserver === "function"){
      const observer=new ResizeObserver(refresh);
      observer.observe(el);
    }
    if(typeof MutationObserver === "function"){
      const observer=new MutationObserver(refresh);
      for(let node=el;node && node.nodeType===1;node=node.parentElement){
        observer.observe(node,{attributes:true,attributeFilter:["class","style","hidden"]});
      }
    }
    document.addEventListener("visibilitychange",refresh);
    window.addEventListener("resize",refresh);
  }

  function renderStatusList(force){
    syncAllEffectiveEnrOperational();
    const el = document.getElementById("hazdamStatusList");
    if(!el || !statusListIsPainted(el) || (!force && directCardIsEditing())) return;
    const html = Object.keys(STATIC).sort(naturalAreaSort).map(id => {
      const s = STATIC[id], o = OPERATIONAL[id] || defaultOp(id);
      const editingThis = el.dataset.editingArea === id;
      const timing = effectiveTiming(id);
      const levels = effectiveLevels(id);

      // While editing, preserve the user's working operational values.
      // When not editing, display the effective operational values produced
      // by NOTAM > ENR > Manual precedence.
      const shownState = effectiveState(id);
      const shownStart = timing.startUTC || "00:00";
      const shownEnd = timing.endUTC || "00:00";
      const shownLower = levels.lower || s.lower || "SFC";
      const shownUpper = levels.upper || s.upper || "UNL";

      const lowerEdit = splitLevelForEdit(shownLower, s.lower || "SFC");
      const upperEdit = splitLevelForEdit(shownUpper, s.upper || "UNL");
      const feed = "auto";
      const autoLocked = feed === "auto" && !editingThis;
      const readonly = !isAdmin();
      return `<div class="hazdam-area-card ${areaStateClass(id)} ${editingThis?'hazdam-card-editing':''}" data-hazdam-card="${safe(id)}">
        <div class="hazdam-area-card-head">
          <div><b class="hazdam-area-card-id">${safe(s.display)}</b><span class="hazdam-area-card-name">${safe(s.name || "")}</span></div>
          <div class="hazdam-area-card-actions">
            <label class="hazdam-protect-label" title="Keep this area unchanged when Clear all is used"><input type="checkbox" data-hazdam-protect="${safe(id)}" ${o.protectClear?'checked':''} ${readonly?'disabled':''}> Keep</label>
            ${isAdmin() ? (editingThis
              ? `<button class="btn" type="button" data-hazdam-cancel="${safe(id)}">CANCEL</button><button class="btn primary" type="button" data-hazdam-save="${safe(id)}">SAVE</button>`
              : `<button class="btn" type="button" data-hazdam-edit="${safe(id)}">EDIT</button>`) : ''}
          </div>
        </div>
        <div class="hazdam-area-direct-grid">
          <div class="field"><label>State</label><select data-hazdam-field="state" disabled>
            <option value="inactive" ${shownState==='inactive'?'selected':''}>Inactive</option>
            <option value="pending" ${shownState==='pending'?'selected':''}>Pending</option>
            <option value="active" ${shownState==='active'?'selected':''}>Active</option>
          </select></div>
          <div class="field"><label>Feed</label><select data-hazdam-field="feedMode" disabled>
            <option value="auto" selected>Auto — FISFID ENR DA</option>
          </select></div>
          <div class="field"><label>Start UTC</label><input data-hazdam-field="startUTC" type="time" value="${safe(shownStart)}" disabled></div>
          <div class="field"><label>End UTC</label><input data-hazdam-field="endUTC" type="time" value="${safe(shownEnd)}" disabled></div>
          <div class="field"><label>Lower level</label><div class="hazdam-level-edit"><select data-hazdam-field="lowerUnit" disabled><option value="ALT" ${lowerEdit.unit==='ALT'?'selected':''}>ALT</option><option value="FL" ${lowerEdit.unit==='FL'?'selected':''}>FL</option></select><input data-hazdam-field="lower" value="${safe(lowerEdit.value)}" disabled></div></div>
          <div class="field"><label>Upper level</label><div class="hazdam-level-edit"><select data-hazdam-field="upperUnit" disabled><option value="ALT" ${upperEdit.unit==='ALT'?'selected':''}>ALT</option><option value="FL" ${upperEdit.unit==='FL'?'selected':''}>FL</option></select><input data-hazdam-field="upper" value="${safe(upperEdit.value)}" disabled></div></div>
        </div>
        <div class="hazdam-area-effective-strip">
          <b>Effective data:</b>
          <span>${safe(hasCurrentNotamPromulgation(o) ? (notamIsAdditiveToEnr(id) ? timing.source : "NOTAM Promulgation — supersedes ENR") : timing.source)}</span>
          <span>UTC ${safe(shownStart)}–${safe(shownEnd)}</span>
          <span>${safe(shownLower)} to ${safe(shownUpper)}</span>
        </div>
        ${activePibContainsNotamId(o.notamId || o.autoNotamId) ? `<div class="hazdam-area-notam-strip">
          <b>${safe(notamIsAdditiveToEnr(id) ? "NOTAM Promulgation — ADDS TO ENR 5.1 HOURS" : "NOTAM Promulgation — SUPERSEDES ENR")}</b>
          <span>${safe(o.notamId || o.autoNotamId)}${(o.notamSourcePage || o.autoSourcePage) ? " · page " + safe(o.notamSourcePage || o.autoSourcePage) : ""}</span>
          <span>B) ${safe(o.notamB || o.autoValidB || "—")}</span>
          <span>C) ${safe(o.notamC || o.autoValidC || "—")}</span>
          <span>D) ${safe(o.notamD || o.autoScheduleD || "—")}</span>
        </div>` : ""}
        <div class="hazdam-area-card-foot"><span>AUTO feed: FISFID ENR DA</span><span>${safe(syncLabel())}</span></div>
      </div>`;
    }).join("");
    if(lastStatusElement===el && lastStatusMarkup===html) return;
    el.innerHTML = html;
    lastStatusElement=el; lastStatusMarkup=html;

    el.querySelectorAll('[data-hazdam-edit]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-hazdam-edit');
      if(!id) return;

      // Only one Danger Area can be edited at a time.
      const active = String(el.dataset.editingArea || "");
      if(active && active !== id){
        window.alert("Finish or cancel the current Danger Area edit first.");
        return;
      }

      el.dataset.editingArea = id;
      try {
        el.dataset.editingSnapshot = JSON.stringify(OPERATIONAL[id] || defaultOp(id));
      } catch(e) {
        el.dataset.editingSnapshot = "";
      }
      renderStatusList(true);

      setTimeout(() => {
        const card = document.querySelector('[data-hazdam-card="' + String(id).replace(/"/g, '\\"') + '"]');
        if(card) {
          try { card.scrollIntoView({behavior:"smooth", block:"center"}); } catch(e) {}
          const first = card.querySelector('[data-hazdam-field="state"]');
          if(first) first.focus();
        }
      }, 30);
    }));

    el.querySelectorAll('[data-hazdam-protect]').forEach(cb => cb.addEventListener('change', () => {
      const id = cb.getAttribute('data-hazdam-protect');
      const next = Object.assign({}, OPERATIONAL[id] || defaultOp(id), { protectClear: !!cb.checked, updatedAt:new Date().toISOString(), updatedBy:isAdmin()?'ADMIN':'OPERATOR' });
      OPERATIONAL[id] = normaliseOp(id, next); saveOperational(); saveAreaToFirebase(id);
    }));


    // Release171: Feed changes happen in-place. Never rebuild the card while
    // editing because that would discard Start/End/level values already typed.
    el.querySelectorAll('[data-hazdam-field="feedMode"]').forEach(sel => sel.addEventListener('change', () => {
      if(!isAdmin()) return;
      const card = sel.closest('[data-hazdam-card]');
      if(!card) return;
      const id = card.getAttribute('data-hazdam-card');
      if(!directCardIsEditing(id)) return;

      const mode = String(sel.value || 'manual').toLowerCase() === 'auto' ? 'auto' : 'manual';
      const foot = card.querySelector('.hazdam-area-card-foot span:first-child');
      if(foot) foot.textContent = mode === 'auto' ? 'AUTO feed: FISFID ENR DA' : 'Manual feed';

      // Manual state preview remains immediate on the map, but the complete
      // edit is persisted only by SAVE.
      if(mode === 'manual'){
        const stateEl = card.querySelector('[data-hazdam-field="state"]');
        const preview = normaliseOp(id, Object.assign({}, OPERATIONAL[id] || defaultOp(id), {
          state: stateEl ? stateEl.value : 'inactive',
          feedMode:'manual',
          source:'Manual'
        }));
        OPERATIONAL[id] = preview;
        updateAreaLayer(id);
        checkConflicts();
      }
    }));

    el.querySelectorAll('[data-hazdam-field="state"]').forEach(sel => sel.addEventListener('change', () => {
      if(!isAdmin()) return;
      const card = sel.closest('[data-hazdam-card]');
      if(!card) return;
      const id = card.getAttribute('data-hazdam-card');
      if(!directCardIsEditing(id)) return;
      const feedSel = card.querySelector('[data-hazdam-field="feedMode"]');
      const feedMode = String(feedSel?.value || 'manual').toLowerCase() === 'auto' ? 'auto' : 'manual';

      // Manual-state preview is immediate. This intentionally updates the local
      // operational object and the map, but Firebase persistence still occurs on SAVE.
      if(feedMode === 'manual'){
        const prev = OPERATIONAL[id] || defaultOp(id);
        OPERATIONAL[id] = normaliseOp(id, Object.assign({}, prev, {
          state: sel.value || HAZDAM_STATE.INACTIVE,
          feedMode:'manual',
          source:'Manual'
        }));
        updateAreaLayer(id);
        checkConflicts();
        if(selectedId === id){
          try { refreshOpenAreaPopup(id); } catch(e) {}
        }
      }
    }));

    el.querySelectorAll('[data-hazdam-cancel]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-hazdam-cancel');
      if(!id) return;

      try {
        const snapshot = el.dataset.editingSnapshot ? JSON.parse(el.dataset.editingSnapshot) : null;
        if(snapshot) OPERATIONAL[id] = normaliseOp(id, snapshot);
      } catch(e) {}

      el.dataset.editingArea = '';
      el.dataset.editingSnapshot = '';
      updateAreaLayer(id);
      checkConflicts();
      renderStatusList(true);
    }));

    el.querySelectorAll('[data-hazdam-save]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-hazdam-save');
      const card = btn.closest('[data-hazdam-card]');
      if(!card) return;
      const get = name => card.querySelector('[data-hazdam-field="'+name+'"]');
      const prev = OPERATIONAL[id] || defaultOp(id);
      const feedMode = 'auto';
      const timing = effectiveTiming(id);
      const levels = effectiveLevels(id);
      const next = Object.assign({}, prev, {
        state: effectiveState(id),
        feedMode,
        startUTC: timing.startUTC || '00:00',
        endUTC: timing.endUTC || '00:00',
        lower: levels.lower || STATIC[id]?.lower || 'SFC',
        upper: levels.upper || STATIC[id]?.upper || 'UNL',
        source: 'FISFID ENR DA',
        updatedAt: new Date().toISOString(),
        updatedBy: isAdmin() ? 'ADMIN' : 'OPERATOR'
      });
      const err = validateEdit(next);
      if(err){ window.alert(err); return; }
      OPERATIONAL[id] = normaliseOp(id, next);
      saveOperational(); saveAreaToFirebase(id); updateAreaLayer(id); checkConflicts();
      el.dataset.editingArea = '';
      el.dataset.editingSnapshot = '';
      renderStatusList(true);
    }));
  }

  function clearAllDangerAreasExceptProtected(){
    let changed = 0;
    Object.keys(STATIC).forEach(id => {
      const prev = OPERATIONAL[id] || defaultOp(id);
      if(prev.protectClear) return;
      OPERATIONAL[id] = normaliseOp(id, Object.assign({}, prev, {
        state: HAZDAM_STATE.INACTIVE,
        startUTC: '00:00', endUTC: '00:00',
        updatedAt: new Date().toISOString(), updatedBy: isAdmin() ? 'ADMIN CLEAR' : 'CLEAR'
      }));
      changed++;
      saveAreaToFirebase(id);
    });
    if(changed){ saveOperational(); draw(); checkConflicts(); renderStatusList(); }
    return changed;
  }

  function updateLabelZoomClass(){
    if(!map) return;
    const z = map.getZoom ? map.getZoom() : 8;
    const container = map.getContainer ? map.getContainer() : document.getElementById("map");
    if(!container) return;
    container.classList.remove("hazdam-z-far","hazdam-z-mid","hazdam-z-close");
    if(z <= 7) container.classList.add("hazdam-z-far");
    else if(z <= 9) container.classList.add("hazdam-z-mid");
    else container.classList.add("hazdam-z-close");
  }

  function wireControls(){
    const toggle = document.getElementById("hazdamToggle");
    if(toggle){
      toggle.checked = visible;
      toggle.addEventListener("change", () => setVisible(toggle.checked));
    }

    const enabled = document.getElementById("hazdamEnabled");
    const lateral = document.getElementById("hazdamLateralNm");
    const vertical = document.getElementById("hazdamVerticalFt");

    if(enabled){
      enabled.checked = !!HAZDAM_CONFIG.enabled;
      enabled.addEventListener("change", () => {
        HAZDAM_CONFIG.enabled = enabled.checked;
        saveUserPreferences();
        checkConflicts();
        renderConflictList();
      });
    }
    if(lateral){
      lateral.value = String(HAZDAM_CONFIG.conflictBufferNm);
      lateral.addEventListener("change", () => {
        HAZDAM_CONFIG.conflictBufferNm = clampPrefNumber(lateral.value, 3, 0, 25);
        saveUserPreferences();
        checkConflicts();
        renderConflictList();
        renderDevTestLab();
      });
    }
    const clearBtn = document.getElementById("hazdamClearAllBtn");
    const clearModal = document.getElementById("hazdamClearAllModal");
    const clearCancel = document.getElementById("hazdamClearAllCancel");
    const clearProceed = document.getElementById("hazdamClearAllProceed");
    const showClearModal = on => { if(clearModal){ clearModal.style.display = on ? "flex" : "none"; clearModal.classList.toggle("hidden", !on); } };
    clearBtn?.addEventListener("click", () => showClearModal(true));
    clearCancel?.addEventListener("click", () => showClearModal(false));
    clearProceed?.addEventListener("click", () => { clearAllDangerAreasExceptProtected(); showClearModal(false); });

    if(vertical){
      vertical.value = String(HAZDAM_CONFIG.verticalToleranceFt);
      vertical.addEventListener("change", () => {
        HAZDAM_CONFIG.verticalToleranceFt = clampPrefNumber(vertical.value, 500, 0, 10000);
        saveUserPreferences();
        checkConflicts();
        renderConflictList();
        renderDevTestLab();
      });
    }
  }


  function applyEnrDefaultsToArea(id, payload){
    id = String(id || "").trim();
    if(!STATIC[id]) return false;
    payload = payload || {};
    const prev = OPERATIONAL[id] || defaultOp(id);
    const next = Object.assign(defaultOp(id), prev, {
      lower: payload.lower || STATIC[id].lower || prev.lower || "SFC",
      upper: payload.upper || STATIC[id].upper || prev.upper || "UNL",
      startUTC: payload.startUTC || "",
      endUTC: payload.endUTC || "",
      source: payload.source || "FISFID ENR DA",
      feedMode: "auto",
      notes: payload.notes || "Updated automatically from FISFID ENR DA.",
      updatedBy: payload.updatedBy || "ADMIN",
      updatedAt: new Date().toISOString()
    });
    const err = validateEdit(next);
    if(err) throw new Error(err);
    OPERATIONAL[id] = normaliseOp(id, next);
    saveOperational();
    draw();
    checkConflicts();
    if(selectedId === id) renderPanel();
    saveAreaToFirebase(id);
    return true;
  }

  function applyNotamToArea(id, payload){
    id = String(id || "").trim();
    if(!STATIC[id]) return false;
    payload = payload || {};
    const prev = OPERATIONAL[id] || defaultOp(id);
    const next = Object.assign(defaultOp(id), prev, {
      state: HAZDAM_STATE.ACTIVE,
      lower: payload.lower || prev.lower || STATIC[id].lower || "SFC",
      upper: payload.upper || prev.upper || STATIC[id].upper || "UNL",
      startUTC: payload.startUTC || "",
      endUTC: payload.endUTC || "",
      source: payload.source || (payload.notamId ? "NOTAM " + payload.notamId : "NOTAM"),
      notes: payload.notes || (payload.notamId ? "Inserted from PIB NOTAM " + payload.notamId + "." : "Inserted from PIB NOTAM."),
      notamId: payload.notamId || "",
      notamSourcePage: payload.sourcePage ? String(payload.sourcePage) : "",
      notamB: payload.b || "",
      notamC: payload.c || "",
      notamD: payload.d || "",
      notamText: payload.notamText || "",
      updatedBy: payload.updatedBy || (isAdmin() ? "ADMIN" : "OPERATOR"),
      updatedAt: new Date().toISOString()
    });
    const err = validateEdit(next);
    if(err) throw new Error(err);
    OPERATIONAL[id] = normaliseOp(id, next);
    saveOperational();
    selectedId = id;
    editing = false;
    editCopy = null;
    draw();
    checkConflicts();
    renderPanel();
    saveAreaToFirebase(id);
    return true;
  }


  function isAutoPibDangerArea(op){
    return /^AUTO PIB NOTAM\b/i.test(String(op && op.source || "")) ||
           !!(op && (op.autoNotamId || (String(op.updatedBy||"").toUpperCase()==="AUTO PLOT" && op.notamId)));
  }

  // Keep AUTO PIB record persistence synchronous while drawing the final state once.
  // Nested callers share the outer batch; a thrown action still flushes saved changes.
  let autoNotamRenderDepth=0, autoNotamRenderPending=false;
  function redrawAfterAutoNotamUpdates(){
    if(autoNotamRenderDepth){ autoNotamRenderPending=true; return; }
    draw(); checkConflicts(); if(!editing) renderPanel();
  }
  function withAutoNotamRenderBatch(action){
    if(typeof action!=="function") throw new TypeError("A synchronous AUTO NOTAM action is required");
    autoNotamRenderDepth++;
    try { return action(); }
    finally {
      autoNotamRenderDepth--;
      if(!autoNotamRenderDepth && autoNotamRenderPending){
        autoNotamRenderPending=false;
        redrawAfterAutoNotamUpdates();
      }
    }
  }

  function resetAutoNotamAreas(quiet){
    let changed = 0;
    Object.keys(OPERATIONAL).forEach(id => {
      const prev = OPERATIONAL[id] || defaultOp(id);
      if(!isAutoPibDangerArea(prev)) return;
      const next = Object.assign({}, prev, {
        state: HAZDAM_STATE.INACTIVE,
        lower: STATIC[id].lower || prev.lower || "SFC",
        upper: STATIC[id].upper || prev.upper || "UNL",
        startUTC: "00:00",
        endUTC: "00:00",
        source: "FISFID ENR DA",
        feedMode: "auto",
        notes: STATIC[id].hours ? ("ENR Hours: " + STATIC[id].hours) : "",
        autoNotamId: "",
        autoSourcePage: "",
        autoValidB: "",
        autoValidC: "",
        autoScheduleD: "",
        autoNotamAction: "",
        notamId: "",
        notamSourcePage: "",
        notamB: "",
        notamC: "",
        notamD: "",
        notamText: "",
        notamAction: "",
        autoActivations: [],
        updatedBy: "AUTO PLOT",
        updatedAt: new Date().toISOString()
      });
      OPERATIONAL[id] = normaliseOp(id, next);
      changed++;
      saveAreaToFirebase(id);
    });
    if(changed){
      saveOperational(); redrawAfterAutoNotamUpdates();
    }
    return changed;
  }

  function applyAutoNotamBundleToArea(id, payloads){
    id=String(id||"").trim(); if(!STATIC[id]) return false;
    var rows=(Array.isArray(payloads)?payloads:[]).filter(Boolean);
    if(!rows.length) return false;
    const prev=OPERATIONAL[id]||defaultOp(id);
    var activations=rows.map(function(payload){return {
      notamId:payload.notamId||"", sourcePage:payload.sourcePage?String(payload.sourcePage):"",
      startUTC:payload.startUTC||"00:00", endUTC:payload.endUTC||"00:00",
      lower:payload.lower||STATIC[id].lower||"SFC", upper:payload.upper||STATIC[id].upper||"UNL",
      b:payload.b||"", c:payload.c||"", d:payload.d||"", notamText:payload.notamText||"",
      action:payload.action||"activate", source:payload.source||("AUTO PIB NOTAM "+(payload.notamId||"")),
      notes:payload.notes||"", updatedBy:payload.updatedBy||"AUTO PLOT"
    };});
    var next=Object.assign({},prev,{
      state:HAZDAM_STATE.INACTIVE, source:"AUTO PIB NOTAM BUNDLE", feedMode:"auto",
      notes:activations.length+" PIB activation record"+(activations.length===1?"":"s")+" attached to one Danger Area geometry.",
      updatedBy:"AUTO PLOT", updatedAt:new Date().toISOString(), autoActivations:activations
    });
    var controlling=resolvedAutoActivation(normaliseOp(id,next),id,true);
    if(controlling){
      var a=controlling.activation;
      Object.assign(next,{lower:a.lower,upper:a.upper,startUTC:a.startUTC,endUTC:a.endUTC,autoNotamId:a.notamId,autoSourcePage:a.sourcePage,autoValidB:a.b,autoValidC:a.c,autoScheduleD:a.d,autoNotamAction:a.action,notamId:a.notamId,notamSourcePage:a.sourcePage,notamB:a.b,notamC:a.c,notamD:a.d,notamText:a.notamText,notamAction:a.action});
    }
    OPERATIONAL[id]=normaliseOp(id,next);
    saveOperational(); redrawAfterAutoNotamUpdates(); saveAreaToFirebase(id);
    return true;
  }

  function applyAutoNotamToArea(id, payload){
    id = String(id || "").trim();
    if(!STATIC[id]) return false;
    payload = payload || {};
    const prev = OPERATIONAL[id] || defaultOp(id);
    const next = Object.assign({}, prev, {
      // Release233: the presence of an activation NOTAM does not mean the
      // area is active continuously.  The live state is derived from the
      // promulgated daily/overnight window below.
      state: HAZDAM_STATE.INACTIVE,
      lower: payload.lower || prev.lower || STATIC[id].lower || "SFC",
      upper: payload.upper || prev.upper || STATIC[id].upper || "UNL",
      startUTC: payload.startUTC || "00:00",
      endUTC: payload.endUTC || "00:00",
      source: payload.source || ("AUTO PIB NOTAM " + (payload.notamId || "")),
      feedMode: "auto",
      notes: payload.notes || "",
      updatedBy: payload.updatedBy || "AUTO PLOT",
      updatedAt: new Date().toISOString(),
      autoNotamId: payload.notamId || "",
      autoSourcePage: payload.sourcePage ? String(payload.sourcePage) : "",
      autoValidB: payload.b || "",
      autoValidC: payload.c || "",
      autoScheduleD: payload.d || "",
      autoNotamAction: payload.action || "activate",
      notamId: payload.notamId || "",
      notamSourcePage: payload.sourcePage ? String(payload.sourcePage) : "",
      notamB: payload.b || "",
      notamC: payload.c || "",
      notamD: payload.d || "",
      notamText: payload.notamText || "",
      notamAction: payload.action || "activate",
      autoActivations: []
    });
    const err = validateEdit(next);
    if(err) throw new Error(err);
    OPERATIONAL[id] = normaliseOp(id, next);
    saveOperational(); redrawAfterAutoNotamUpdates(); saveAreaToFirebase(id);
    return true;
  }

  function resetExpiredAutoNotamTimes(){
    // Release304: never destroy an AUTO PIB promulgation solely because C) has
    // passed. effectiveState()/hasCurrentNotamPromulgation already make it
    // INACTIVE outside B)-C). Keeping the attached record is essential for the
    // adjustable operational/test clock: rewinding from after C) back inside
    // the published window must immediately restore ACTIVE/PENDING state.
    //
    // Stale PIB data remains operationally safe because B/C validity gates the
    // effective state; the next PIB/AUTO PLOT resync replaces the attachment.
    return;
  }

  // Clock changes affect state, timing and labels, never the published geometry.
  // Reusing the existing layer objects avoids a full Leaflet teardown/reprojection.
  function refreshForOperationalTime(){
    refreshAllAreaLayers();
    checkConflicts();
    if(!editing) renderPanel();
  }

  function init(){
    map = window.FISO_FID_MAP;
    window.addEventListener("ffapp-operational-time-change", function(){ try{ refreshForOperationalTime(); }catch(e){} });
    if(!map || !window.L){ setTimeout(init, 250); return; }
    loadUserPreferences();
    loadOperational();
    wireControls();
    watchStatusListVisibility();
    map.on("zoomend", updateLabelZoomClass);
    initFirebaseSync();
    setInterval(() => {
      resetExpiredAutoNotamTimes();
      refreshAllAreaLayers();

      // Keep the currently edited direct card untouched until SAVE/CANCEL.
      if(!editing) renderPanel();
      checkConflicts();
    }, 1000);
    if(!selectedId) selectedId = "EGD201H";
    draw();
    console.log("HAZDAM v" + VERSION + " loaded — Release 040 performance/UI polish");
  }

  setInterval(function(){
    syncAllEffectiveEnrOperational();
    refreshAllAreaLayers();
    renderStatusList();
    checkConflicts();
  }, 60000);

  window.HAZDAM = {
    version: VERSION,
    states: HAZDAM_STATE,
    staticAreas: STATIC,
    operational: OPERATIONAL,
    config: HAZDAM_CONFIG,
    conflicts: () => currentConflicts.slice(),
    isEditing: () => editing,
    checkConflicts,
    ackConflict,
    getAlertForHex,
    setDevScenario,
    init,
    draw,
    setVisible,
    selectArea,
    openAreaPopup,
    applyNotamToArea,
    withAutoNotamRenderBatch,
    applyAutoNotamToArea,
    applyAutoNotamBundleToArea,
    resetAutoNotamAreas,
    applyEnrDefaultsToArea,
    removeArea,
    firebase: {
      path: FIREBASE_PATH,
      ready: () => fbReady,
      saveArea: saveAreaToFirebase,
      syncState: () => ({ state: syncState, message: syncMessage })
    }
  };

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  try {
    window.addEventListener("ffapp-protected-squawks-updated", function(){
      try { renderConflictList(); } catch(e) {}
      try { renderDevTestLab(); } catch(e) {}
      try { checkConflicts(); } catch(e) {}
    });
  } catch(e) {}
})();
