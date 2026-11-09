// FFApp Release068 Daily Hazard Report storage helper
// Uses Netlify Blobs when available, with a /tmp fallback for local/preview tests.

let blobs = null;
try { blobs = require('@netlify/blobs'); } catch (e) { blobs = null; }

const fs = require('fs');
const path = require('path');
const STORE_NAME = 'ffapp-daily-hazard-reports';
const TMP_FILE = path.join('/tmp', 'ffapp-daily-hazard-report-store.json');

function todayUtc(d = new Date()) { return d.toISOString().slice(0, 10); }
function minuteUtc(d = new Date()) { return d.toISOString().slice(0, 16) + 'Z'; }
function clean(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
function padSquawk(v) { const s=String(v||'').trim(); return /^[0-7]{1,4}$/.test(s) ? s.padStart(4,'0') : s; }
function callsign(ac) { return clean((ac && (ac.flight || ac.r || ac.hex)) || 'UNKNOWN').toUpperCase() || 'UNKNOWN'; }
function altFt(ac) { if(!ac) return null; if(ac.alt_baro === 'ground') return 0; if(typeof ac.alt_baro === 'number') return ac.alt_baro; if(typeof ac.alt_geom === 'number') return ac.alt_geom; return null; }
function fmtLoc(lat, lon) { return (typeof lat==='number' && typeof lon==='number') ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : 'Unknown'; }
function isWithinUkFirApprox(ac) {
  if (!ac || typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return false;
  return ac.lat >= 49 && ac.lat <= 61 && ac.lon >= -11 && ac.lon <= 4;
}
function blankReport(date) { return { date, updatedAt: new Date().toISOString(), hazards: {}, squawks: {} }; }

async function getBlobStore() {
  if (!blobs || !blobs.getStore) return null;
  try { return blobs.getStore(STORE_NAME); } catch (e) { return null; }
}
async function readReport(date = todayUtc()) {
  const key = `${date}.json`;
  const store = await getBlobStore();
  if (store) {
    try {
      const data = await store.get(key, { type: 'json' });
      if (data && typeof data === 'object') return data;
    } catch (e) {}
  }
  try {
    const all = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
    if (all && all[date]) return all[date];
  } catch (e) {}
  return blankReport(date);
}
async function writeReport(date, report) {
  report.updatedAt = new Date().toISOString();
  const key = `${date}.json`;
  const store = await getBlobStore();
  if (store) {
    await store.setJSON(key, report);
    return { ok:true, backend:'netlify-blobs' };
  }
  let all = {};
  try { all = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8')); } catch (e) { all = {}; }
  all[date] = report;
  fs.writeFileSync(TMP_FILE, JSON.stringify(all, null, 2));
  return { ok:true, backend:'tmp' };
}
function hazardKey(a) {
  return clean(a.id || `${a.type}_${a.callsign}_${(a.lines||[]).join('_')}`).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 160);
}
function extractAreaOrSite(alert) {
  const lines = Array.isArray(alert.lines) ? alert.lines : [];
  const joined = lines.join(' | ');
  const m = joined.match(/\bD\d{2,3}[A-Z]?\b/i);
  if (m) return m[0].toUpperCase();
  const first = clean(lines[0] || '');
  if (first) return first.replace(new RegExp('^'+clean(alert.callsign||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s+', 'i'), '').slice(0, 80);
  return clean(alert.title || alert.type || 'Hazard');
}
function addHazard(report, alert, nowIso = new Date().toISOString()) {
  const key = hazardKey(alert);
  const existing = report.hazards[key] || {};
  report.hazards[key] = {
    key,
    type: clean(alert.type || 'HAZARD').toUpperCase(),
    callsign: clean(alert.callsign || 'UNKNOWN').toUpperCase(),
    squawk: clean(alert.squawk || ''),
    firstSeen: existing.firstSeen || alert.detectedAt || nowIso,
    lastSeen: nowIso,
    count: (existing.count || 0) + 1,
    location: fmtLoc(alert.lat, alert.lon),
    lat: typeof alert.lat === 'number' ? alert.lat : existing.lat,
    lon: typeof alert.lon === 'number' ? alert.lon : existing.lon,
    areaOrSite: clean(alert.areaOrSite || alert.site || alert.area || extractAreaOrSite(alert)),
    altitudeFt: typeof alert.altitudeFt === 'number' ? Math.round(alert.altitudeFt) : existing.altitudeFt,
    details: Array.isArray(alert.lines) ? alert.lines.slice(0, 6).map(clean).filter(Boolean) : (existing.details || [])
  };
}
function addSquawk(report, ac, nowIso = new Date().toISOString()) {
  const sq = padSquawk(ac && ac.squawk);
  if (!['0027','0030','7700'].includes(sq)) return false;
  if (!isWithinUkFirApprox(ac)) return false;
  const key = `${sq}_${clean(ac.hex || callsign(ac)).toUpperCase()}`.replace(/[^A-Za-z0-9_-]/g, '_');
  const existing = report.squawks[key] || {};
  report.squawks[key] = {
    key,
    squawk: sq,
    callsign: callsign(ac),
    hex: clean(ac && ac.hex).toUpperCase(),
    firstSeen: existing.firstSeen || nowIso,
    lastSeen: nowIso,
    count: (existing.count || 0) + 1,
    location: fmtLoc(ac.lat, ac.lon),
    lat: typeof ac.lat === 'number' ? ac.lat : existing.lat,
    lon: typeof ac.lon === 'number' ? ac.lon : existing.lon,
    altitudeFt: altFt(ac) == null ? existing.altitudeFt : Math.round(altFt(ac)),
    track: typeof ac.track === 'number' ? Math.round(ac.track) : existing.track,
    groundSpeedKt: typeof ac.gs === 'number' ? Math.round(ac.gs) : existing.groundSpeedKt
  };
  return true;
}
async function recordDailySnapshot({ hazards = [], aircraft = [], date = todayUtc(), nowIso = new Date().toISOString() } = {}) {
  const report = await readReport(date);
  hazards.forEach(a => addHazard(report, a, nowIso));
  let squawkAdded = 0;
  aircraft.forEach(ac => { if (addSquawk(report, ac, nowIso)) squawkAdded++; });
  const write = await writeReport(date, report);
  return { ok:true, backend:write.backend, date, hazards: Object.keys(report.hazards).length, squawks: Object.keys(report.squawks).length, squawkAdded };
}
function values(obj) { return Object.values(obj || {}).sort((a,b) => String(a.firstSeen||'').localeCompare(String(b.firstSeen||''))); }
function timeOnly(iso) { return iso ? String(iso).slice(11,16) + 'Z' : '----Z'; }
function buildReportText(report, opts = {}) {
  const hazards = values(report.hazards);
  const squawks = values(report.squawks);
  const date = report.date || todayUtc();
  const header = `Daily FFApp Hazard Report\n${date}\nPeriod: 0000–2100 UTC`;
  const groups = ['PCH','HAZPLOT','HAZDAM','HAZPARA','SIMILAR'];
  const lines = [header, ''];
  for (const type of groups) {
    const items = hazards.filter(h => h.type === type || (type === 'SIMILAR' && h.type.includes('SIMILAR')));
    lines.push(`${type}: ${items.length}`);
    if (!items.length) { lines.push('None', ''); continue; }
    for (const h of items.slice(0, opts.maxPerSection || 30)) {
      const dur = h.lastSeen && h.firstSeen && h.lastSeen !== h.firstSeen ? `-${timeOnly(h.lastSeen)}` : '';
      const alt = h.altitudeFt != null ? ` · ${h.altitudeFt} ft` : '';
      const loc = h.location && h.location !== 'Unknown' ? ` · ${h.location}` : '';
      const area = h.areaOrSite ? ` · ${h.areaOrSite}` : '';
      lines.push(`${timeOnly(h.firstSeen)}${dur} · ${h.callsign || 'UNKNOWN'}${area}${alt}${loc}`);
    }
    if (items.length > (opts.maxPerSection || 30)) lines.push(`+${items.length - (opts.maxPerSection || 30)} more`);
    lines.push('');
  }
  lines.push('OTHER HAZARDS: 0', 'None', '');
  for (const sq of ['0027','0030','7700']) {
    const items = squawks.filter(s => s.squawk === sq);
    lines.push(`SQUAWK ${sq}: ${items.length}`);
    if (!items.length) { lines.push('None', ''); continue; }
    for (const s of items.slice(0, opts.maxPerSection || 30)) {
      const dur = s.lastSeen && s.firstSeen && s.lastSeen !== s.firstSeen ? `-${timeOnly(s.lastSeen)}` : '';
      const alt = s.altitudeFt != null ? ` · ${s.altitudeFt} ft` : '';
      const gs = s.groundSpeedKt != null ? ` · ${s.groundSpeedKt} kt` : '';
      const trk = s.track != null ? ` · track ${s.track}°` : '';
      const loc = s.location && s.location !== 'Unknown' ? ` · ${s.location}` : '';
      lines.push(`${timeOnly(s.firstSeen)}${dur} · ${s.callsign || 'UNKNOWN'}${alt}${gs}${trk}${loc}`);
    }
    if (items.length > (opts.maxPerSection || 30)) lines.push(`+${items.length - (opts.maxPerSection || 30)} more`);
    lines.push('');
  }
  lines.push(`Generated: ${new Date().toISOString().slice(11,16)}Z`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 3900);
}
module.exports = { todayUtc, minuteUtc, readReport, writeReport, recordDailySnapshot, buildReportText, padSquawk, isWithinUkFirApprox };
