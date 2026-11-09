// FFApp Release068 Multi-Squawk Hazard Alert Watcher + Daily Report Logger
// HARD RULE: create/send/display alerts ONLY where EVERY aircraft involved is squawking one of:
// 1177, 0027, 0030, 7500, 7600, 7700.
// Included alert types: HAZDAM, HAZPARA, HAZPLOT, PCH, SIMILAR. All other squawks are blocked.

// Release 278: scheduled execution removed while Telegram messaging is redesigned.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RELEASE = "068";
const MODE = "MULTI_SQUAWK_HAZARD_ALERTS_DAILY_REPORT";
const ALLOWED_SQUAWKS = new Set(["1177", "0027", "0030", "7500", "7600", "7700"]);
const PRIMARY_LABEL = "1177/0027/0030/7500/7600/7700";
const WATCH_HOME = { lat: 52.4539, lon: -1.748, radiusNm: 250 };
const HAZDAM_TTL_MS = 20 * 60 * 1000;
const state = global.__ffappTelegramAlertState || (global.__ffappTelegramAlertState = new Map());
let cachedDangerAreas = null;
let dailyStore = null;
try { dailyStore = require("./ffapp-daily-store"); } catch (e) { dailyStore = null; }

function padSquawk(v) {
  const s = String(v || "").trim();
  return /^[0-7]{1,4}$/.test(s) ? s.padStart(4, "0") : s;
}
function isAllowedSquawk(ac) { return ALLOWED_SQUAWKS.has(padSquawk(ac && ac.squawk)); }
function acSquawk(ac) { return padSquawk(ac && ac.squawk); }
function callsign(ac) { return String(ac && (ac.flight || ac.r || ac.hex) || "UNKNOWN").trim().toUpperCase() || "UNKNOWN"; }
function trailingTwoLetters(v) { const m = String(v || "").trim().toUpperCase().match(/([A-Z]{2})$/); return m ? m[1] : ""; }
function altFt(ac) {
  if (!ac) return null;
  if (ac.alt_baro === "ground") return 0;
  if (typeof ac.alt_baro === "number") return ac.alt_baro;
  if (typeof ac.alt_geom === "number") return ac.alt_geom;
  return null;
}
function parseFt(value, fallback) {
  const s = String(value || "").toUpperCase();
  if (s.includes("UNL")) return 99999;
  if (s.includes("SFC") || s.includes("GND")) return 0;
  let m = s.match(/FL\s*(\d{2,3})/); if (m) return Number(m[1]) * 100;
  m = s.match(/(\d{3,5})\s*FT/); if (m) return Number(m[1]);
  m = s.match(/^\s*(\d{2,3})\s*$/); if (m) return Number(m[1]) * 100;
  return fallback;
}
function verticalPasses(alt, lower, upper, bufferFt = 500) {
  if (alt == null) return true;
  const lo = parseFt(lower, 0) - bufferFt;
  const hi = parseFt(upper, 99999) + bufferFt;
  return alt >= lo && alt <= hi;
}
function pointInPolygon(lat, lon, coords) {
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const yi = coords[i][0], xi = coords[i][1];
    const yj = coords[j][0], xj = coords[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function levenshtein(a,b){
  a=String(a||"").trim().toUpperCase(); b=String(b||"").trim().toUpperCase();
  const dp=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++) dp[i][0]=i; for(let j=0;j<=b.length;j++) dp[0][j]=j;
  for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++) dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return dp[a.length][b.length];
}
function finalAllowedSquawkGate(alerts) {
  return alerts.filter(a => Array.isArray(a.aircraftSquawks) && a.aircraftSquawks.length && a.aircraftSquawks.every(s => ALLOWED_SQUAWKS.has(padSquawk(s))));
}
function activeListFromEnv(name) {
  return new Set(String(process.env[name] || "").split(/[ ,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean));
}
function recently(key, ttl = HAZDAM_TTL_MS) {
  const now = Date.now();
  const last = state.get(key) || 0;
  if (now - last < ttl) return true;
  state.set(key, now);
  return false;
}
function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body, null, 2) };
}
function loadDangerAreas() {
  if (cachedDangerAreas) return cachedDangerAreas;
  try {
    const file = path.join(__dirname, "..", "..", "aviationData.js");
    const code = fs.readFileSync(file, "utf8");
    const sandbox = { window: { FISO_DATA: {} } };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { timeout: 1000 });
    const areas = sandbox.window.FISO_DATA.dangerAreas || {};
    cachedDangerAreas = Object.values(areas).filter(a => Array.isArray(a.coords) && a.coords.length >= 3);
  } catch (e) {
    console.error("Unable to load aviationData danger areas", e.message);
    cachedDangerAreas = [];
  }
  return cachedDangerAreas;
}
function loadParaSites() {
  try {
    const file = path.join(__dirname, "..", "..", "app.js");
    const code = fs.readFileSync(file, "utf8");
    const m = code.match(/var\s+PARA_SITES\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) return [];
    return vm.runInNewContext(m[1], {}, { timeout: 1000 }).filter(s => typeof s.lat === "number" && typeof s.lon === "number");
  } catch (e) { console.error("Unable to load PARA sites", e.message); return []; }
}
function loadHazplots() {
  // Optional backend HAZPLOT source. Empty by default to avoid false alerts.
  // Set FFAPP_HAZPLOTS_JSON to an array of {id,name,lat,lon,radiusNm,lower,upper} to enable.
  try {
    const arr = JSON.parse(process.env.FFAPP_HAZPLOTS_JSON || "[]");
    return Array.isArray(arr) ? arr.filter(h => typeof h.lat === "number" && typeof h.lon === "number" && typeof h.radiusNm === "number") : [];
  } catch(e) { return []; }
}
function activeDangerAreaSet() {
  return new Set(String(process.env.FFAPP_ACTIVE_DANGER_AREAS || "").split(/[ ,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean));
}
function isDangerAreaActive(area) {
  const active = activeDangerAreaSet();
  return area.defaultState === "active" || area.h24 === true || active.has(String(area.id || "").toUpperCase()) || active.has(String(area.display || "").toUpperCase());
}
async function fetchAircraft() {
  const response = await fetch(`https://api.airplanes.live/v2/point/${WATCH_HOME.lat}/${WATCH_HOME.lon}/${WATCH_HOME.radiusNm}`, { headers: { "User-Agent": `FFApp Alert Engine Release ${RELEASE}` } });
  if (!response.ok) throw new Error(`airplanes.live HTTP ${response.status}`);
  const data = await response.json();
  return ((data && data.ac) || []).filter(ac => typeof ac.lat === "number" && typeof ac.lon === "number");
}
function makeHazdamAlert(ac, area) {
  const alt = altFt(ac);
  const areaName = area.display || area.id || area.name || "Danger Area";
  return {
    id: `hazdam_${acSquawk(ac)}_${ac.hex || callsign(ac)}_${area.id || areaName}`.replace(/[^A-Za-z0-9_-]/g, "_"),
    type: "HAZDAM",
    icon: "⚠️",
    title: "HAZDAM",
    callsign: callsign(ac),
    hex: ac.hex ? String(ac.hex).toUpperCase() : "",
    squawk: acSquawk(ac),
    aircraftSquawks: [acSquawk(ac)],
    altitudeFt: alt,
    lat: ac.lat,
    lon: ac.lon,
    priority: 5,
    detectedAt: new Date().toISOString(),
    lines: [
      `${callsign(ac)} inside ${areaName}`,
      `Squawk: ${acSquawk(ac)}`,
      alt != null ? `Altitude: ${Math.round(alt)} ft` : "Altitude: unknown",
      `Limits: ${area.lower || "SFC"} - ${area.upper || "UNL"}`,
      `Lat/Lon: ${ac.lat.toFixed(4)}, ${ac.lon.toFixed(4)}`
    ]
  };
}
function collectHazdamAllowedAlerts(allAircraft, allDangerAreas) {
  const aircraftAllowed = allAircraft.filter(isAllowedSquawk);
  const dangerAreas = allDangerAreas.filter(isDangerAreaActive);
  const alerts = [];
  for (const ac of aircraftAllowed) {
    const alt = altFt(ac);
    for (const area of dangerAreas) {
      if (!verticalPasses(alt, area.lower, area.upper, 500)) continue;
      if (!pointInPolygon(ac.lat, ac.lon, area.coords)) continue;
      alerts.push(makeHazdamAlert(ac, area));
    }
  }
  return finalAllowedSquawkGate(alerts.filter(a => a.type === "HAZDAM"));
}
function makeSimpleAlert(type, icon, title, ac, extraId, lines, priority) {
  return {
    id: `${type.toLowerCase()}_${acSquawk(ac)}_${ac.hex || callsign(ac)}_${extraId || ""}`.replace(/[^A-Za-z0-9_-]/g, "_"),
    type, icon, title,
    callsign: callsign(ac),
    hex: ac.hex ? String(ac.hex).toUpperCase() : "",
    squawk: acSquawk(ac),
    aircraftSquawks: [acSquawk(ac)],
    altitudeFt: altFt(ac),
    lat: ac.lat, lon: ac.lon,
    priority: priority || 6,
    detectedAt: new Date().toISOString(),
    lines
  };
}
function collectHazparaAllowedAlerts(allAircraft) {
  const active = activeListFromEnv("FFAPP_ACTIVE_PARA_SITES");
  if (!active.size) return [];
  const sites = loadParaSites().filter(s => active.has(String(s.id||s.name||"").toLowerCase()) || active.has("all"));
  const alerts=[];
  for (const ac of allAircraft.filter(isAllowedSquawk)) {
    const alt=altFt(ac);
    if (alt != null && alt > 15000) continue;
    for (const site of sites) {
      const d=distanceNm(ac.lat, ac.lon, site.lat, site.lon);
      if (d <= 10) alerts.push(makeSimpleAlert("HAZPARA", "🪂", "HAZPARA", ac, site.id || site.name, [
        `${callsign(ac)} near ${site.name || site.id || "PARA site"}`,
        `Squawk: ${acSquawk(ac)}`,
        `Distance: ${d.toFixed(1)} NM`,
        alt != null ? `Altitude: ${Math.round(alt)} ft` : "Altitude: unknown"
      ], d <= 3 ? 4 : 6));
    }
  }
  return finalAllowedSquawkGate(alerts);
}
function collectHazplotAllowedAlerts(allAircraft) {
  const plots = loadHazplots();
  if (!plots.length) return [];
  const alerts=[];
  for (const ac of allAircraft.filter(isAllowedSquawk)) {
    const alt=altFt(ac);
    for (const hp of plots) {
      if (!verticalPasses(alt, hp.lower, hp.upper, 500)) continue;
      const d=distanceNm(ac.lat, ac.lon, hp.lat, hp.lon);
      if (d <= hp.radiusNm) alerts.push(makeSimpleAlert("HAZPLOT", "📍", "HAZPLOT", ac, hp.id || hp.name, [
        `${callsign(ac)} inside ${hp.name || hp.id || "HAZPLOT"}`,
        `Squawk: ${acSquawk(ac)}`,
        `Distance: ${d.toFixed(1)} NM`,
        alt != null ? `Altitude: ${Math.round(alt)} ft` : "Altitude: unknown"
      ], 6));
    }
  }
  return finalAllowedSquawkGate(alerts);
}
function collectPchAllowedAlerts(allAircraft) {
  // Current-position-only PCH: no projected crossing logic.
  const aircraftAllowed=allAircraft.filter(isAllowedSquawk);
  const alerts=[];
  for(let i=0;i<aircraftAllowed.length;i++) for(let j=i+1;j<aircraftAllowed.length;j++) {
    const a=aircraftAllowed[i], b=aircraftAllowed[j];
    const aa=altFt(a), bb=altFt(b);
    if (aa != null && bb != null && Math.abs(aa-bb)>1000) continue;
    const d=distanceNm(a.lat,a.lon,b.lat,b.lon);
    if (d > 3) continue;
    alerts.push({
      id: `pch_${acSquawk(a)}_${acSquawk(b)}_${a.hex||callsign(a)}_${b.hex||callsign(b)}`.replace(/[^A-Za-z0-9_-]/g,"_"),
      type:"PCH", icon:"🪂", title:"PCH",
      callsign:`${callsign(a)} / ${callsign(b)}`,
      squawk:`${acSquawk(a)} / ${acSquawk(b)}`,
      aircraftSquawks:[acSquawk(a),acSquawk(b)],
      lat:(a.lat+b.lat)/2, lon:(a.lon+b.lon)/2,
      priority:4,
      detectedAt:new Date().toISOString(),
      lines:[`${callsign(a)} and ${callsign(b)} within ${d.toFixed(1)} NM`, `Squawks: ${acSquawk(a)} / ${acSquawk(b)}`, `Vertical difference: ${aa!=null&&bb!=null?Math.abs(aa-bb)+" ft":"unknown"}`]
    });
  }
  return finalAllowedSquawkGate(alerts);
}
function collectSimilarAllowedAlerts(allAircraft) {
  const aircraftAllowed=allAircraft.filter(isAllowedSquawk).filter(a => callsign(a) !== "UNKNOWN");
  const alerts=[];
  for(let i=0;i<aircraftAllowed.length;i++) for(let j=i+1;j<aircraftAllowed.length;j++) {
    const a=aircraftAllowed[i], b=aircraftAllowed[j];
    const ca=callsign(a), cb=callsign(b);
    if (ca===cb) continue;
    const suffixA = trailingTwoLetters(ca);
    const suffixB = trailingTwoLetters(cb);
    if (!suffixA || !suffixB || suffixA !== suffixB) continue;
    const d=distanceNm(a.lat,a.lon,b.lat,b.lon);
    if (d > 30) continue;
    alerts.push({
      id:`similar_${acSquawk(a)}_${acSquawk(b)}_${ca}_${cb}`.replace(/[^A-Za-z0-9_-]/g,"_"),
      type:"SIMILAR", icon:"✈️", title:"Similar Callsigns",
      callsign:`${ca} / ${cb}`,
      squawk:`${acSquawk(a)} / ${acSquawk(b)}`,
      aircraftSquawks:[acSquawk(a),acSquawk(b)],
      lat:(a.lat+b.lat)/2, lon:(a.lon+b.lon)/2,
      priority:7,
      detectedAt:new Date().toISOString(),
      lines:[`${ca} and ${cb}`, `Matching suffix: ${suffixA}`, `Distance: ${d.toFixed(1)} NM`]
    });
  }
  return finalAllowedSquawkGate(alerts);
}
function collectAllAllowedAlerts(allAircraft, allDangerAreas) {
  return finalAllowedSquawkGate([
    ...collectHazdamAllowedAlerts(allAircraft, allDangerAreas),
    ...collectHazparaAllowedAlerts(allAircraft),
    ...collectHazplotAllowedAlerts(allAircraft),
    ...collectPchAllowedAlerts(allAircraft),
    ...collectSimilarAllowedAlerts(allAircraft)
  ]);
}
function cleanPart(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}
function callsignParts(v) {
  return String(v || "")
    .split(/\s*(?:\/|&|,|\band\b|·)\s*/i)
    .map(cleanPart)
    .filter(Boolean)
    .map(x => x.toUpperCase());
}
function firstLine(a) {
  return Array.isArray(a && a.lines) && a.lines.length ? cleanPart(a.lines[0]) : "";
}
function removeCallPrefix(text, call) {
  let t = cleanPart(text);
  const c = cleanPart(call);
  if (c && t.toUpperCase().startsWith(c.toUpperCase())) t = cleanPart(t.slice(c.length));
  t = t.replace(/^\s*(?:inside|near|in|and|\/|:|-|—|·)\s*/i, "");
  return cleanPart(t);
}
function formatTelegramLine(a) {
  if (!a) return "⚠️ FFAPP ALERT";
  if (a.telegramLine) return cleanPart(a.telegramLine);
  const type = String(a.type || "ALERT").toUpperCase();
  const call = cleanPart(a.callsign || "UNKNOWN").toUpperCase();
  const line = firstLine(a);
  if (type === "PCH") {
    const parts = callsignParts(call || line);
    return `⚠️ PCH: ${parts.slice(0, 2).join(" · ") || call}`;
  }
  if (type === "SIMILAR") {
    const parts = callsignParts(call || line);
    return `⚠️ SIMILAR CALLSIGN: ${parts.slice(0, 2).join(" · ") || call}`;
  }
  if (type === "HAZDAM") {
    const area = removeCallPrefix(line, call).replace(/^inside\s+/i, "") || "Danger Area";
    return `⚠️ HAZDAM: ${call} · ${area}`;
  }
  if (type === "HAZPARA") {
    const site = removeCallPrefix(line, call).replace(/^near\s+/i, "") || "PARA site";
    return `⚠️ HAZPARA: ${call} · ${site}`;
  }
  if (type === "HAZPLOT") {
    let detail = removeCallPrefix(line, call)
      .replace(/^inside\s+/i, "")
      .replace(/^near\s+plotted\s+hazard\s+/i, "Near plot ")
      .replace(/^near\s+/i, "Near ");
    if (!detail) detail = "Near plotted hazard";
    return `⚠️ HAZPLOT: ${call} · ${detail}`;
  }
  return `⚠️ ${type}: ${call}`;
}
function digest(alerts) {
  // Release 086: Telegram messages are hazard-only. No footer, timestamps,
  // distances, squawks, queue summary, links or extra lines.
  return (alerts || []).map(formatTelegramLine).filter(Boolean).join("\n");
}
async function sendTelegramAlerts(alerts) {
  const results = [];
  for (const alert of (alerts || [])) {
    const text = formatTelegramLine(alert);
    results.push(await sendTelegram(text));
  }
  return results;
}
function validateInboundAlert(a) {
  const allowed = new Set(["HAZDAM","HAZPARA","HAZPLOT","PCH","SIMILAR"]);
  if (!a || typeof a !== "object") return null;
  if (!allowed.has(String(a.type || "").toUpperCase())) return null;
  const squawks = Array.isArray(a.aircraftSquawks) && a.aircraftSquawks.length ? a.aircraftSquawks.map(padSquawk) : [padSquawk(a.squawk)];
  if (!squawks.length || !squawks.every(s => ALLOWED_SQUAWKS.has(s))) return null;
  return {
    id: String(a.id || `${a.type}_${a.callsign || "UNKNOWN"}_${Date.now()}`).replace(/[^A-Za-z0-9_-]/g, "_"),
    type: String(a.type).toUpperCase(),
    icon: a.icon || "⚠️",
    title: a.title || `${String(a.type).toUpperCase()} ${PRIMARY_LABEL}`,
    callsign: String(a.callsign || "UNKNOWN").trim().toUpperCase(),
    squawk: squawks.length === 1 ? squawks[0] : squawks.join(" / "),
    aircraftSquawks: squawks,
    lat: typeof a.lat === "number" ? a.lat : null,
    lon: typeof a.lon === "number" ? a.lon : null,
    priority: typeof a.priority === "number" ? a.priority : 6,
    detectedAt: a.detectedAt || new Date().toISOString(),
    lines: Array.isArray(a.lines) ? a.lines.slice(0, 8).map(x => String(x)) : [],
    telegramLine: a.telegramLine ? String(a.telegramLine) : ""
  };
}
async function sendTelegram(text) {
  // Release 278 hard stop: all legacy Telegram sending is disabled.
  // Keep the watcher available for non-Telegram queue/diagnostic use only.
  return { ok: true, skipped: true, disabled: true, reason: "Legacy Telegram messaging stopped in Release 278 pending complete redesign." };
}
function mockData() {
  const area = { id: "TEST_DANGER", display: "TEST_DANGER", h24: true, lower: "SFC", upper: "FL195", coords: [[51,-1],[51,1],[53,1],[53,-1]] };
  const aircraft = [
    { hex: "A1177", flight: "TEST1177", squawk: "1177", lat: 52, lon: 0, alt_baro: 2500 },
    { hex: "A0027", flight: "TEST0027", squawk: "0027", lat: 52, lon: 0, alt_baro: 2500 },
    { hex: "A0030", flight: "TEST0030", squawk: "0030", lat: 52, lon: 0, alt_baro: 2500 },
    { hex: "A7500", flight: "TEST7500", squawk: "7500", lat: 52, lon: 0, alt_baro: 2500 },
    { hex: "A7600", flight: "TEST7600", squawk: "7600", lat: 52, lon: 0, alt_baro: 2500 },
    { hex: "A7700", flight: "TEST7700", squawk: "7700", lat: 52, lon: 0, alt_baro: 2500 },
    { hex: "A1234", flight: "TEST1234", squawk: "1234", lat: 52, lon: 0, alt_baro: 2500 }
  ];
  return { aircraft, dangerAreas: [area] };
}

exports.handler = async function(event) {
  try {
    const qs = (event && event.queryStringParameters) || {};

    if (event && event.httpMethod === "POST") {
      let payload = {};
      try { payload = JSON.parse(event.body || "{}"); } catch(e) { payload = {}; }
      const alert = validateInboundAlert(payload.alert || payload);
      if (!alert) return json(200, { ok:true, release:RELEASE, accepted:false, reason:"blocked by allowed-squawk hard filter" });
      let dailyLog = { ok:true, skipped:true };
      if (dailyStore) {
        try { dailyLog = await dailyStore.recordDailySnapshot({ hazards:[alert], aircraft:[] }); }
        catch (e) { dailyLog = { ok:false, error:e && e.message ? e.message : String(e) }; }
      }
      if (recently("inbound_" + alert.id, 10 * 60 * 1000)) return json(200, { ok:true, release:RELEASE, accepted:true, dailyLog, telegram:{ok:true, skipped:true, reason:"duplicate suppression"}, alert });
      const result = await sendTelegram(formatTelegramLine(alert));
      return json(200, { ok:result.ok, release:RELEASE, accepted:true, dailyLog, telegram:result, telegramText:formatTelegramLine(alert), alert });
    }

    if (qs.test === "local-ingest") {
      const good = validateInboundAlert({ type:"HAZDAM", callsign:"TEST1177", squawk:"1177", aircraftSquawks:["1177"], lines:["test alert"] });
      const good2 = validateInboundAlert({ type:"HAZPARA", callsign:"TEST7700", squawk:"7700", aircraftSquawks:["7700"], lines:["test alert"] });
      const bad = validateInboundAlert({ type:"HAZDAM", callsign:"TEST1234", squawk:"1234", aircraftSquawks:["1234"], lines:["bad test"] });
      return json(200, { ok:true, release:RELEASE, test:"local-ingest", accepted1177:!!good, accepted7700:!!good2, blockedBad:!bad, pass:!!good && !!good2 && !bad });
    }


    if (qs.test === "daily-log") {
      if (!dailyStore) return json(200, { ok:false, release:RELEASE, test:"daily-log", error:"daily store unavailable" });
      const { aircraft, dangerAreas } = mockData();
      const alerts = collectAllAllowedAlerts(aircraft, dangerAreas).slice(0, 3);
      const logged = await dailyStore.recordDailySnapshot({ hazards: alerts, aircraft });
      return json(200, { ok:true, release:RELEASE, test:"daily-log", pass:true, logged });
    }

    if (qs.test === "similar-last-two") {
      const pairs = [
        [{ flight:"GABCD", squawk:"1177", lat:52.00, lon:0.00 }, { flight:"GEFCD", squawk:"0027", lat:52.01, lon:0.01 }],
        [{ flight:"RYR812AB", squawk:"0030", lat:52.00, lon:0.00 }, { flight:"EZY431AB", squawk:"7500", lat:52.01, lon:0.01 }],
        [{ flight:"GABCD", squawk:"7600", lat:52.00, lon:0.00 }, { flight:"GABCE", squawk:"7700", lat:52.01, lon:0.01 }],
        [{ flight:"RYR81234", squawk:"1177", lat:52.00, lon:0.00 }, { flight:"EZY43134", squawk:"0027", lat:52.01, lon:0.01 }]
      ];
      const results = pairs.map(pair => {
        const alerts = collectSimilarAllowedAlerts(pair);
        return {
          pair: pair.map(a => callsign(a)),
          suffixes: pair.map(a => trailingTwoLetters(callsign(a)) || null),
          matched: alerts.length > 0
        };
      });
      return json(200, {
        ok:true,
        release:RELEASE,
        test:"similar-last-two",
        rule:"SIMILAR alerts only trigger when both callsigns end in the same two letters",
        results,
        pass: results[0].matched === true && results[1].matched === true && results[2].matched === false && results[3].matched === false
      });
    }

    if (qs.test === "hard-filter") {
      const { aircraft, dangerAreas } = mockData();
      const alerts = collectAllAllowedAlerts(aircraft, dangerAreas);
      const violations = alerts.filter(a => !Array.isArray(a.aircraftSquawks) || !a.aircraftSquawks.every(s => ALLOWED_SQUAWKS.has(padSquawk(s))));
      return json(200, {
        ok: true,
        release: RELEASE,
        mode: MODE,
        test: "hard-filter",
        inputAircraft: aircraft.map(a => ({ callsign: callsign(a), squawk: padSquawk(a.squawk) })),
        outputAlerts: alerts.map(a => ({ type: a.type, callsign: a.callsign, squawk: a.squawk, aircraftSquawks: a.aircraftSquawks })),
        expectedMinimumAlerts: 6,
        actualAlerts: alerts.length,
        violations: violations.length,
        pass: alerts.length >= 6 && violations.length === 0 && alerts.every(a => a.aircraftSquawks.every(s => ALLOWED_SQUAWKS.has(padSquawk(s))))
      });
    }

    const aircraft = await fetchAircraft();
    const dangerAreas = loadDangerAreas();
    const activeAlerts = collectAllAllowedAlerts(aircraft, dangerAreas);
    let dailyLog = { ok:true, skipped:true };
    if (dailyStore && qs.noDailyLog !== "1") {
      try { dailyLog = await dailyStore.recordDailySnapshot({ hazards: activeAlerts, aircraft }); }
      catch (e) { dailyLog = { ok:false, error: e && e.message ? e.message : String(e) }; }
    }

    if (qs.queue === "1" || qs.mode === "queue") {
      return json(200, {
        ok: true,
        release: RELEASE,
        mode: MODE,
        aircraft: aircraft.length,
        aircraftAllowed: aircraft.filter(isAllowedSquawk).length,
        activeDangerAreas: dangerAreas.filter(isDangerAreaActive).length,
        activeAlerts,
        dailyLog,
        updatedAt: new Date().toISOString()
      });
    }

    if (qs.test === "strict-filter") {
      return json(200, {
        ok: true,
        release: RELEASE,
        mode: MODE,
        aircraft: aircraft.length,
        aircraftAllowed: aircraft.filter(isAllowedSquawk).length,
        activeAlerts: activeAlerts.length,
        dailyLog,
        violations: activeAlerts.filter(a => !Array.isArray(a.aircraftSquawks) || !a.aircraftSquawks.every(s => ALLOWED_SQUAWKS.has(padSquawk(s)))).length,
        sampleAlerts: activeAlerts.slice(0, 20).map(a => ({ type: a.type, callsign: a.callsign, squawk: a.squawk, lines: a.lines }))
      });
    }

    if (qs.test === "telegram") {
      const result = await sendTelegram(`FFApp Release ${RELEASE} Telegram test.\n\nFilter active: HAZDAM, HAZPARA, HAZPLOT, PCH and Similar Callsigns. Allowed squawks only: ${PRIMARY_LABEL}.`);
      return json(result.ok ? 200 : 200, { ok: result.ok, release: RELEASE, test: "telegram", telegram: result });
    }

    const newAlerts = activeAlerts.filter(a => !recently(a.id));
    let telegram = { ok: true, skipped: true };
    if (newAlerts.length) telegram = await sendTelegramAlerts(newAlerts);

    return json(200, {
      ok: true,
      release: RELEASE,
      mode: MODE,
      aircraft: aircraft.length,
      aircraftAllowed: aircraft.filter(isAllowedSquawk).length,
      activeDangerAreas: dangerAreas.filter(isDangerAreaActive).length,
      activeAlerts: activeAlerts.length,
      newAlerts: newAlerts.length,
      dailyLog,
      telegram,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error(e);
    return json(200, { ok: false, release: RELEASE, error: e && e.message ? e.message : String(e) });
  }
};
