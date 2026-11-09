const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const nodemailer = require("nodemailer");

setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const CACHE_MS = 60 * 1000;
const cache = new Map();

function normaliseIcao(value) {
  return String(value || "").trim().toUpperCase();
}

exports.metar = onRequest({ cors: true }, async (req, res) => {
  try {
    const icao = normaliseIcao(req.query.icao || req.query.ids);
    if (!/^[A-Z]{4}$/.test(icao)) {
      res.status(400).json({ ok: false, error: "Invalid ICAO. Use a four-letter ICAO code." });
      return;
    }

    const now = Date.now();
    const cached = cache.get(icao);
    if (cached && cached.expires > now) {
      res.set("Cache-Control", "public, max-age=60");
      res.json({ ok: true, icao, raw: cached.raw, cached: true, fetchedAt: cached.fetchedAt });
      return;
    }

    const url = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=raw&hours=1`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "FFApp METAR Service (https://aviationweather.gov/api/data/metar)",
        "Accept": "text/plain"
      }
    });

    if (!response.ok) {
      throw new Error(`AviationWeather HTTP ${response.status}`);
    }

    const raw = (await response.text()).trim();
    const payload = raw || `No METAR returned for ${icao}.`;
    const fetchedAt = new Date().toISOString();
    cache.set(icao, { raw: payload, fetchedAt, expires: now + CACHE_MS });

    res.set("Cache-Control", "public, max-age=60");
    res.json({ ok: true, icao, raw: payload, cached: false, fetchedAt });
  } catch (err) {
    console.error("METAR proxy error", err);
    res.status(502).json({
      ok: false,
      error: err && err.message ? err.message : "METAR service unavailable"
    });
  }
});


/* ============================ FFAPP 24/7 PUSH ALERT ENGINE ============================
   Release 047: server-side watcher + Firebase Cloud Messaging.
   Monitors aircraft even when no browser/iPad/iPhone has FFApp open.

   Alert squawks enabled by user request:
   1177, 0027, 0030, 7500, 7600, 7700
   All other squawks, including 7400, are deliberately excluded.
*/
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();
const rtdb = admin.database();

const ALERT_SQUAWKS = new Set(["1177", "0027", "0030", "7500", "7600", "7700"]);
const ALERT_SQUAWK_LABELS = {
  "7700": "EMERGENCY - 7700",
  "7600": "RADIO FAILURE - 7600",
  "7500": "UNLAWFUL INTERFERENCE - 7500",
  "1177": "FIS CODE - 1177",
  "0030": "SPECIAL SQUAWK - 0030",
  "0027": "SPECIAL SQUAWK - 0027"
};
const WATCH_HOME = { lat: 52.4539, lon: -1.748, radiusNm: 250 };
const ALERT_TTL_MS = 20 * 60 * 1000;       // same aircraft/event can re-alert after 20 min
const PCH_TTL_MS = 10 * 60 * 1000;
const SIMILAR_TTL_MS = 20 * 60 * 1000;
const PCH_ALT_SEP_FT = 1000;
const PCH_WARN_MINS = 10;
const SIMILAR_RANGE_NM = 12;

function padSquawk(v) {
  const s = String(v || "").trim();
  return /^[0-7]{1,4}$/.test(s) ? s.padStart(4, "0") : s;
}
function callsign(ac) {
  return String(ac.flight || ac.r || ac.hex || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
}
function altFt(ac) {
  if (!ac) return null;
  if (ac.alt_baro === "ground") return 0;
  if (typeof ac.alt_baro === "number") return ac.alt_baro;
  if (typeof ac.alt_geom === "number") return ac.alt_geom;
  return null;
}
function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function projectPoint(ac, mins) {
  if (typeof ac.lat !== "number" || typeof ac.lon !== "number") return null;
  const gs = Number(ac.gs || ac.gs_kt || 0);
  const trk = Number(ac.track || ac.trak || ac.true_heading || 0);
  if (!isFinite(gs) || gs < 30 || !isFinite(trk)) return null;
  const distNm = gs * (mins / 60);
  const brng = trk * Math.PI / 180;
  const latRad = ac.lat * Math.PI / 180;
  const dLat = (distNm * Math.cos(brng)) / 60;
  const dLon = (distNm * Math.sin(brng)) / (60 * Math.max(0.2, Math.cos(latRad)));
  return { lat: ac.lat + dLat, lon: ac.lon + dLon };
}
function segCross(a1, a2, b1, b2) {
  const dax = a2.lat - a1.lat, day = a2.lon - a1.lon;
  const dbx = b2.lat - b1.lat, dby = b2.lon - b1.lon;
  const cross = dax * dby - day * dbx;
  if (Math.abs(cross) < 1e-12) return null;
  const dx = b1.lat - a1.lat, dy = b1.lon - a1.lon;
  const tA = (dx * dby - dy * dbx) / cross;
  const tB = (dx * day - dy * dax) / cross;
  return (tA >= 0 && tA <= 1 && tB >= 0 && tB <= 1) ? [tA, tB] : null;
}
function isSimilarCallsign(a, b) {
  a = String(a || "").replace(/\s+/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  b = String(b || "").replace(/\s+/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (a.length < 2 || b.length < 2 || a === b) return false;
  // FFApp rule: only warn when the LAST TWO CHARACTERS are identical.
  // Examples: GBFUB/GDEUB -> UB match; FJUTC/GDETC -> TC match; GBFRS/GBFUB -> no match.
  return a.slice(-2) === b.slice(-2);
}
async function fetchAircraftForWatch() {
  const url = `https://api.airplanes.live/v2/point/${WATCH_HOME.lat}/${WATCH_HOME.lon}/${WATCH_HOME.radiusNm}`;
  const response = await fetch(url, { headers: { "User-Agent": "FFApp Alert Engine" } });
  if (!response.ok) throw new Error(`airplanes.live HTTP ${response.status}`);
  const data = await response.json();
  return ((data && data.ac) || []).filter(ac => typeof ac.lat === "number" && typeof ac.lon === "number");
}
async function getPushTokens() {
  const snap = await rtdb.ref("fiso/pushTokens").once("value");
  const val = snap.val() || {};
  return Object.keys(val).map(k => val[k] && val[k].token).filter(Boolean);
}
async function recentlyAlerted(key, ttlMs) {
  const ref = rtdb.ref("fiso/alertState/" + key.replace(/[^A-Za-z0-9_-]/g, "_"));
  const snap = await ref.once("value");
  const last = snap.val() && snap.val().lastSentAt;
  if (last && Date.now() - Number(last) < ttlMs) return true;
  await ref.set({ lastSentAt: Date.now() });
  return false;
}
async function recordAlert(alert) {
  await rtdb.ref("fiso/alertHistory").push({ ...alert, createdAt: admin.database.ServerValue.TIMESTAMP });
}

async function sendTelegramAlert(alert) {
  // Release 278 hard stop: Firebase Telegram delivery is disabled.
  // A new authenticated Telegram architecture will replace the legacy process.
  return { ok: true, skipped: true, disabled: true, reason: "Legacy Telegram messaging stopped in Release 278 pending complete redesign." };
}

async function sendAlert(alert, tokens) {
  await recordAlert(alert);
  await sendTelegramAlert(alert);
  if (!tokens.length) return;
  const payload = {
    tokens,
    notification: { title: alert.title, body: alert.body },
    webpush: {
      notification: { title: alert.title, body: alert.body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", requireInteraction: true },
      fcmOptions: { link: "/" }
    },
    data: Object.fromEntries(Object.entries(alert.data || {}).map(([k,v]) => [k, String(v ?? "")]))
  };
  const result = await admin.messaging().sendEachForMulticast(payload);
  const invalid = [];
  result.responses.forEach((r, idx) => {
    const code = r.error && r.error.code;
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") invalid.push(tokens[idx]);
  });
  if (invalid.length) {
    const snap = await rtdb.ref("fiso/pushTokens").once("value");
    const val = snap.val() || {};
    await Promise.all(Object.keys(val).filter(k => invalid.includes(val[k] && val[k].token)).map(k => rtdb.ref("fiso/pushTokens/" + k).remove()));
  }
}

exports.sendTestPush = onCall({ region: "europe-west1" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in to FISO FID before sending a test notification.");
  const token = String((req.data && req.data.token) || "").trim();
  if (!token || token.length > 4096) throw new HttpsError("invalid-argument", "A valid registered device token is required.");

  const snap = await rtdb.ref("fiso/pushTokens").once("value");
  const records = snap.val() || {};
  const match = Object.values(records).find(v => v && v.token === token);
  if (!match || match.enabled === false || match.uid !== req.auth.uid) {
    throw new HttpsError("permission-denied", "This notification token is not registered to the signed-in user.");
  }

  const message = {
    token,
    notification: { title: "FISO FID – TEST", body: "Push notifications are working correctly on this device." },
    webpush: {
      notification: {
        title: "FISO FID – TEST",
        body: "Push notifications are working correctly on this device.",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: "fisofid-test"
      },
      fcmOptions: { link: "/" }
    },
    data: { type: "TEST", eventKey: "fisofid-test" }
  };
  try {
    const messageId = await admin.messaging().send(message);
    return { ok: true, messageId };
  } catch (err) {
    console.error("FISO FID test push failed", err);
    throw new HttpsError("internal", "Firebase could not send the test notification.");
  }
});

exports.alertWatcher = onSchedule({ schedule: "every 1 minutes", timeZone: "Europe/London", region: "europe-west1", timeoutSeconds: 30, memory: "128MiB" }, async () => {
  // Release058 safety kill-switch: Firebase legacy alert watcher disabled.
  // Netlify hazdam-1177-watcher is the only live Telegram alert sender.
  if (process.env.FFAPP_ENABLE_FIREBASE_ALERTWATCHER !== "true") {
    console.log("FFApp Firebase alertWatcher disabled by Release058 hard gate.");
    return;
  }
  console.log("FFAPP_ENABLE_FIREBASE_ALERTWATCHER=true is set, but legacy Firebase alert generation remains disabled in Release058.");
});


/* ============================ SECURE USER LOGIN / AUDIT ============================ */
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const AUTH_REPORT_TO = "fisonats@gmail.com";
const AUTH_USERS_PATH = "fiso/auth/users";
const AUTH_AUDIT_PATH = "fiso/auth/audit";

function authMailTransport(){
  return nodemailer.createTransport({service:"gmail",auth:{user:SMTP_USER.value(),pass:SMTP_PASS.value()}});
}
function cleanUserNumber(value){
  const n=String(value||"").trim();
  if(!/^\d{3,10}$/.test(n)) throw new HttpsError("invalid-argument","Invalid user number.");
  return n;
}
function authEmailFor(n){return `${n}@fisofid.internal`}
function isAuthAdmin(req){return !!(req.auth && req.auth.token && (req.auth.token.role==="Admin" || req.auth.token.admin===true))}
function londonDateTime(date=new Date()){
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",dateStyle:"full",timeStyle:"long"}).format(date);
}
function londonDateKey(date=new Date()){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}
function deviceFromUserAgent(ua=""){
  if(/iPad/i.test(ua))return "iPad";
  if(/iPhone/i.test(ua))return "iPhone";
  if(/Android/i.test(ua))return "Android";
  if(/Macintosh/i.test(ua))return "Mac";
  if(/Windows/i.test(ua))return "Windows PC";
  return "Unknown device";
}
async function writeAuthAudit(type,data,req){
  const record={type,...data,actorUserNumber:req?.auth?.token?.userNumber||null,uid:req?.auth?.uid||null,createdAt:Date.now()};
  await rtdb.ref(AUTH_AUDIT_PATH).push(record);
  return record;
}
async function getAuthProfile(n){
  const s=await rtdb.ref(`${AUTH_USERS_PATH}/${n}`).once("value");
  return s.val();
}

exports.listLoginNumbers=onCall({region:"europe-west1"},async req=>{
  if(!isAuthAdmin(req))throw new HttpsError("permission-denied","Admin only.");
  const s=await rtdb.ref(AUTH_USERS_PATH).once("value");
  const users=s.val()||{};
  return {numbers:Object.keys(users).filter(n=>users[n]&&users[n].enabled!==false).sort()};
});

exports.recordLogin=onCall({region:"europe-west1",secrets:[SMTP_USER,SMTP_PASS]},async req=>{
  if(!req.auth)throw new HttpsError("unauthenticated","Sign in required.");
  const n=cleanUserNumber(req.data.userNumber);
  if(req.auth.token.userNumber!==n)throw new HttpsError("permission-denied","User mismatch.");
  const profile=await getAuthProfile(n);
  if(!profile||profile.enabled===false)throw new HttpsError("permission-denied","Account disabled.");
  const ua=String(req.data.userAgent||"").slice(0,600);
  const event={
    userNumber:n,role:req.auth.token.role||profile.role||"Operational",
    loginLocal:londonDateTime(),device:deviceFromUserAgent(ua),userAgent:ua,
    appVersion:String(req.data.appVersion||"").slice(0,200),
    language:String(req.data.language||"").slice(0,40),
    screen:String(req.data.screen||"").slice(0,40),
    ip:String(req.rawRequest?.headers?.["x-forwarded-for"]||req.rawRequest?.ip||"").split(",")[0].trim()
  };
  await writeAuthAudit("login",event,req);
  await authMailTransport().sendMail({
    from:`FISO FID APP <${SMTP_USER.value()}>`,to:AUTH_REPORT_TO,
    subject:`FISO FID APP login — ${n}`,
    text:[
      "FISO FID APP — User Login","",
      `User number: ${n}`,`Role: ${event.role}`,`Login time: ${event.loginLocal}`,
      `Device: ${event.device}`,`Browser/device details: ${event.userAgent}`,
      `Screen: ${event.screen}`,`Language: ${event.language}`,
      `App version: ${event.appVersion}`,`IP address: ${event.ip||"Not available"}`
    ].join("\n")
  });
  return {ok:true};
});

exports.requestPasswordReset=onCall({region:"europe-west1",secrets:[SMTP_USER,SMTP_PASS]},async req=>{
  const n=cleanUserNumber(req.data.userNumber);
  await writeAuthAudit("password_reset_request",{userNumber:n},req);
  await authMailTransport().sendMail({
    from:`FISO FID APP <${SMTP_USER.value()}>`,to:AUTH_REPORT_TO,
    subject:`FISO FID password reset request — ${n}`,
    text:`A password reset was requested for user ${n} at ${londonDateTime()}.\n\nOpen FFApp as an Admin, choose Manage Users, and press Reset password beside this user.`
  });
  return {ok:true};
});

exports.listUsers=onCall({region:"europe-west1"},async req=>{
  if(!isAuthAdmin(req))throw new HttpsError("permission-denied","Admin only.");
  const s=await rtdb.ref(AUTH_USERS_PATH).once("value");
  const data=s.val()||{};
  return {users:Object.keys(data).sort().map(n=>({userNumber:n,...data[n],uid:undefined}))};
});

exports.upsertUser=onCall({region:"europe-west1"},async req=>{
  if(!isAuthAdmin(req))throw new HttpsError("permission-denied","Admin only.");
  const n=cleanUserNumber(req.data.userNumber);
  const name=String(req.data.name||"").trim();
  const role=req.data.role==="Admin"?"Admin":"Operational";
  const password=String(req.data.password||"");
  const forcePasswordChange=req.data.forcePasswordChange!==false;
  if(!name)throw new HttpsError("invalid-argument","Name required.");
  let user;
  try{user=await admin.auth().getUserByEmail(authEmailFor(n))}
  catch(e){
    if(password.length<8)throw new HttpsError("invalid-argument","New users need a temporary password of at least 8 characters.");
    user=await admin.auth().createUser({email:authEmailFor(n),password,displayName:n,disabled:false});
  }
  if(password)await admin.auth().updateUser(user.uid,{password,disabled:false});
  await admin.auth().setCustomUserClaims(user.uid,{userNumber:n,role,forcePasswordChange});
  const old=await getAuthProfile(n);
  await rtdb.ref(`${AUTH_USERS_PATH}/${n}`).set({
    userNumber:n,name,role,enabled:true,uid:user.uid,forcePasswordChange,updatedAt:Date.now()
  });
  await writeAuthAudit(old?"user_updated":"user_created",{targetUserNumber:n,targetRole:role,passwordReplaced:!!password},req);
  return {ok:true};
});

exports.adminResetPassword=onCall({region:"europe-west1"},async req=>{
  if(!isAuthAdmin(req))throw new HttpsError("permission-denied","Admin only.");
  const n=cleanUserNumber(req.data.userNumber),newPassword=String(req.data.newPassword||"");
  if(newPassword.length<8)throw new HttpsError("invalid-argument","Password must contain at least 8 characters.");
  const profile=await getAuthProfile(n);
  if(!profile)throw new HttpsError("not-found","User not found.");
  await admin.auth().updateUser(profile.uid,{password:newPassword,disabled:false});
  await admin.auth().setCustomUserClaims(profile.uid,{userNumber:n,role:profile.role||"Operational",forcePasswordChange:true});
  await rtdb.ref(`${AUTH_USERS_PATH}/${n}`).update({forcePasswordChange:true,enabled:true,updatedAt:Date.now()});
  await writeAuthAudit("password_reset_by_admin",{targetUserNumber:n},req);
  return {ok:true};
});

exports.completeFirstLoginPasswordChange=onCall({region:"europe-west1"},async req=>{
  if(!req.auth)throw new HttpsError("unauthenticated","Sign in required.");
  const n=cleanUserNumber(req.auth.token.userNumber);
  const profile=await getAuthProfile(n);
  if(!profile)throw new HttpsError("not-found","User not found.");
  await admin.auth().setCustomUserClaims(req.auth.uid,{userNumber:n,role:profile.role||"Operational",forcePasswordChange:false});
  await rtdb.ref(`${AUTH_USERS_PATH}/${n}`).update({forcePasswordChange:false,passwordChangedAt:Date.now(),updatedAt:Date.now()});
  await writeAuthAudit("password_changed_by_user",{userNumber:n},req);
  return {ok:true};
});

exports.setUserEnabled=onCall({region:"europe-west1"},async req=>{
  if(!isAuthAdmin(req))throw new HttpsError("permission-denied","Admin only.");
  const n=cleanUserNumber(req.data.userNumber),enabled=!!req.data.enabled;
  if(n===req.auth.token.userNumber&&!enabled)throw new HttpsError("failed-precondition","You cannot disable your own account.");
  const profile=await getAuthProfile(n);
  if(!profile)throw new HttpsError("not-found","User not found.");
  await admin.auth().updateUser(profile.uid,{disabled:!enabled});
  await rtdb.ref(`${AUTH_USERS_PATH}/${n}`).update({enabled,updatedAt:Date.now()});
  await writeAuthAudit(enabled?"user_enabled":"user_disabled",{targetUserNumber:n},req);
  return {ok:true};
});

exports.deleteUser=onCall({region:"europe-west1"},async req=>{
  if(!isAuthAdmin(req))throw new HttpsError("permission-denied","Admin only.");
  const n=cleanUserNumber(req.data.userNumber);
  if(n===req.auth.token.userNumber)throw new HttpsError("failed-precondition","You cannot delete your own account.");
  const profile=await getAuthProfile(n);
  if(profile&&profile.uid)await admin.auth().deleteUser(profile.uid).catch(()=>{});
  await rtdb.ref(`${AUTH_USERS_PATH}/${n}`).remove();
  await writeAuthAudit("user_deleted",{targetUserNumber:n},req);
  return {ok:true};
});

exports.dailyAuthActivityReport=onSchedule({
  schedule:"0 22 * * *",timeZone:"Europe/London",region:"europe-west1",
  timeoutSeconds:60,memory:"256MiB",secrets:[SMTP_USER,SMTP_PASS]
},async()=>{
  const today=londonDateKey();
  const start=Date.now()-48*60*60*1000;
  const s=await rtdb.ref(AUTH_AUDIT_PATH).orderByChild("createdAt").startAt(start).once("value");
  const all=s.val()||{};
  const events=Object.values(all).filter(e=>e&&e.createdAt&&londonDateKey(new Date(e.createdAt))===today).sort((a,b)=>a.createdAt-b.createdAt);
  const logins=events.filter(e=>e.type==="login"), counts={};
  logins.forEach(e=>counts[e.userNumber]=(counts[e.userNumber]||0)+1);
  const lines=[
    "FISO FID APP — Daily Activity Report",`Date: ${today}`,`Generated: ${londonDateTime()}`,"",
    "SUMMARY",`Total logins: ${logins.length}`,`Users logging in: ${Object.keys(counts).length}`,
    ...Object.entries(counts).map(([n,c])=>`- ${n}: ${c} login${c===1?"":"s"}`),"","ACTIVITY",
    ...(events.length?events.map(e=>{
      const when=londonDateTime(new Date(e.createdAt));
      if(e.type==="login")return `${when} | LOGIN | ${e.userNumber} | ${e.role} | ${e.device} | ${e.appVersion||""}`;
      return `${when} | ${String(e.type||"event").toUpperCase()} | ${e.userNumber||e.targetUserNumber||""} | actor ${e.actorUserNumber||"system"}`;
    }):["No recorded activity."])
  ];
  await authMailTransport().sendMail({
    from:`FISO FID APP <${SMTP_USER.value()}>`,to:AUTH_REPORT_TO,
    subject:`FISO FID daily activity — ${today}`,text:lines.join("\n")
  });
});
/* ========================== END SECURE USER LOGIN / AUDIT ========================== */
