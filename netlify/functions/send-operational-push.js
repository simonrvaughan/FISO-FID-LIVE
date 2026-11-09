const admin = require('firebase-admin');

const DATABASE_URL = 'https://fisofid-default-rtdb.europe-west1.firebasedatabase.app';
const ALLOWED_SQUAWKS = new Set(['1177', '0027', '0030', '7500', '7600', '7700']);
const SIMILAR_DEDUPE_MS = 10 * 60 * 1000;
const HAZPLOT_DEDUPE_MS = 2 * 60 * 1000;
const HAZDAM_DEDUPE_MS = 2 * 60 * 1000;
const PCH_DEDUPE_MS = 2 * 60 * 1000;
const SQUAWK_DEDUPE_MS = 5 * 60 * 1000;

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
function getAdminApp() {
  if (admin.apps.length) return admin.app();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Server notification credentials are not configured.');
  let serviceAccount;
  try { serviceAccount = JSON.parse(raw); }
  catch (_) { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.'); }
  return admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: DATABASE_URL });
}
function cleanCallsign(v) { return String(v || '').replace(/\s+/g, '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function cleanText(v, max = 120) { return String(v || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function suffix2(v) { const s = cleanCallsign(v); return s.length >= 2 ? s.slice(-2) : ''; }
function normSquawk(v) { const s = String(v || '').trim(); return /^[0-7]{1,4}$/.test(s) ? s.padStart(4, '0') : ''; }
function pairKey(a, b) { return [cleanCallsign(a), cleanCallsign(b)].sort().join('__').replace(/[^A-Z0-9_]/g, ''); }
function safeKey(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 100); }

async function claimEvent(type, key, dedupeMs) {
  const ref = admin.database().ref('fiso/pushEventDedupe/' + type + '/' + key);
  const now = Date.now();
  const result = await ref.transaction((current) => {
    const last = current && Number(current.lastSentAt || 0);
    if (last && now - last < dedupeMs) return;
    return { lastSentAt: now, updatedAt: now };
  }, undefined, false);
  return !!result.committed;
}

async function sendToRegisteredDevices(type, title, body, eventKey, options = {}) {
  const snap = await admin.database().ref('fiso/pushTokens').once('value');
  const records = snap.val() || {};
  const selected = Object.entries(records).filter(([, r]) =>
    r && r.token && r.enabled !== false && (!r.preferences || r.preferences[type] !== false)
  );
  if (!selected.length) return { sent: 0, failed: 0, registered: 0 };

  const tokens = selected.map(([, r]) => r.token);
  let sent = 0, failed = 0;
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const response = await admin.messaging().sendEachForMulticast({
      tokens: batch,
      notification: { title, body },
      webpush: {
        headers: { Urgency: options.urgency || 'high' },
        notification: { title, body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: eventKey, renotify: false },
        fcmOptions: { link: '/' },
      },
      data: { type, eventKey },
    });
    sent += response.successCount;
    failed += response.failureCount;
    const removals = [];
    response.responses.forEach((r, idx) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        const token = batch[idx];
        const match = selected.find(([, rec]) => rec.token === token);
        if (match) removals.push(admin.database().ref('fiso/pushTokens/' + match[0]).remove());
      }
    });
    if (removals.length) await Promise.allSettled(removals);
  }
  return { sent, failed, registered: selected.length };
}

async function handleSimilar(data, decoded) {
  const callsigns = Array.isArray(data.callsigns) ? data.callsigns.slice(0, 2).map(cleanCallsign) : [];
  const squawks = Array.isArray(data.squawks) ? data.squawks.slice(0, 2).map(normSquawk) : [];
  const distanceNm = Number(data.distanceNm);
  if (callsigns.length !== 2 || !callsigns[0] || !callsigns[1] || callsigns[0] === callsigns[1]) throw Object.assign(new Error('Two different callsigns are required.'), {status:400});
  if (!suffix2(callsigns[0]) || suffix2(callsigns[0]) !== suffix2(callsigns[1])) throw Object.assign(new Error('Callsigns do not meet the configured last-two-character similarity rule.'), {status:400});
  if (squawks.length !== 2 || !squawks.every((s) => ALLOWED_SQUAWKS.has(s))) throw Object.assign(new Error('Both aircraft must use an alert-enabled squawk.'), {status:400});
  if (!Number.isFinite(distanceNm) || distanceNm < 0 || distanceNm > 30) throw Object.assign(new Error('Similar-callsign pair is outside the configured 30 NM range.'), {status:400});

  const key = pairKey(callsigns[0], callsigns[1]);
  if (!(await claimEvent('SIMILAR', key, SIMILAR_DEDUPE_MS))) return { ok:true, deduped:true, sent:0 };
  const title = 'FISO FID – SIM CALLSIGN';
  const body = `${callsigns[0]} and ${callsigns[1]} · similar callsign detected`;
  const result = await sendToRegisteredDevices('SIMILAR', title, body, 'fisofid-sim-' + key.toLowerCase());
  await admin.database().ref('fiso/pushEventLog/SIMILAR/' + key).set({ callsigns, squawks, suffix:suffix2(callsigns[0]), distanceNm:Math.round(distanceNm*10)/10, sentAt:admin.database.ServerValue.TIMESTAMP, triggeredByUid:decoded.uid, sent:result.sent, failed:result.failed });
  return { ok:true, deduped:false, ...result };
}

async function handleHazplot(data, decoded) {
  const callsign = cleanCallsign(data.callsign) || safeKey(data.aircraftHex) || 'UNKNOWN';
  const aircraftHex = safeKey(data.aircraftHex);
  const squawk = normSquawk(data.squawk);
  const hazardId = safeKey(data.hazardId);
  const hazardLabel = cleanText(data.hazardLabel, 100) || 'Plotted hazard';
  const location = cleanText(data.location, 80);
  const notamId = safeKey(data.notamId);
  const lateralNm = Number(data.lateralNm);
  if (!hazardId) throw Object.assign(new Error('A valid plotted hazard ID is required.'), {status:400});
  if (!squawk) throw Object.assign(new Error('A valid aircraft squawk is required.'), {status:400});
  if (Number.isFinite(lateralNm) && (lateralNm < 0 || lateralNm > 20)) throw Object.assign(new Error('Invalid HAZPLOT lateral distance.'), {status:400});

  const key = safeKey((aircraftHex || callsign) + '__' + hazardId);
  if (!(await claimEvent('HAZPLOT', key, HAZPLOT_DEDUPE_MS))) return { ok:true, deduped:true, sent:0 };
  const title = 'FISO FID – HAZPLOT';
  const detail = [callsign, location, hazardLabel].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' · ');
  const body = detail || `${callsign} · plotted hazard occurrence`;
  const result = await sendToRegisteredDevices('HAZPLOT', title, body, 'fisofid-hazplot-' + key.toLowerCase());
  await admin.database().ref('fiso/pushEventLog/HAZPLOT/' + key).set({ aircraftHex, callsign, squawk, hazardId, hazardLabel, location, notamId, lateralNm:Number.isFinite(lateralNm)?Math.round(lateralNm*10)/10:null, sentAt:admin.database.ServerValue.TIMESTAMP, triggeredByUid:decoded.uid, sent:result.sent, failed:result.failed });
  return { ok:true, deduped:false, ...result };
}


async function handleHazdam(data, decoded) {
  const callsign = cleanCallsign(data.callsign) || safeKey(data.aircraftHex) || 'UNKNOWN';
  const aircraftHex = safeKey(data.aircraftHex);
  const squawk = normSquawk(data.squawk);
  const areaId = safeKey(data.areaId);
  const areaDisplay = cleanText(data.areaDisplay, 40) || areaId;
  const status = cleanText(data.status, 20).toUpperCase() || 'NEAR';
  const distanceNm = Number(data.distanceNm);
  const etaMinutes = Number(data.etaMinutes);
  if (!aircraftHex || !areaId) throw Object.assign(new Error('A valid aircraft and Danger Area are required.'), {status:400});
  if (!squawk || !ALLOWED_SQUAWKS.has(squawk)) throw Object.assign(new Error('Aircraft must use an alert-enabled squawk.'), {status:400});
  if (Number.isFinite(distanceNm) && (distanceNm < 0 || distanceNm > 20)) throw Object.assign(new Error('Invalid HAZDAM distance.'), {status:400});
  const key = safeKey(aircraftHex + '__' + areaId);
  if (!(await claimEvent('HAZDAM', key, HAZDAM_DEDUPE_MS))) return { ok:true, deduped:true, sent:0 };
  const title = 'FISO FID – HAZDAM';
  let position = status;
  if (status !== 'INSIDE' && Number.isFinite(distanceNm)) position = `${Math.round(distanceNm * 10) / 10} NM`;
  if (status === 'PREDICTED' && Number.isFinite(etaMinutes) && etaMinutes > 0) position = `ETA ${Math.max(1, Math.round(etaMinutes))} min`;
  const body = `${callsign} · ${areaDisplay} · ${position}`;
  const result = await sendToRegisteredDevices('HAZDAM', title, body, 'fisofid-hazdam-' + key.toLowerCase());
  await admin.database().ref('fiso/pushEventLog/HAZDAM/' + key).set({ aircraftHex, callsign, squawk, areaId, areaDisplay, status, distanceNm:Number.isFinite(distanceNm)?Math.round(distanceNm*10)/10:null, etaMinutes:Number.isFinite(etaMinutes)?etaMinutes:null, sentAt:admin.database.ServerValue.TIMESTAMP, triggeredByUid:decoded.uid, sent:result.sent, failed:result.failed });
  return { ok:true, deduped:false, ...result };
}

async function handleSquawk(data, decoded, target) {
  const callsign = cleanCallsign(data.callsign) || safeKey(data.aircraftHex) || 'UNKNOWN';
  const aircraftHex = safeKey(data.aircraftHex);
  const squawk = normSquawk(data.squawk);
  if (!aircraftHex) throw Object.assign(new Error('A valid aircraft is required.'), {status:400});
  if (squawk !== target) throw Object.assign(new Error(`Expected squawk ${target}.`), {status:400});
  const type = 'SQ' + target;
  const key = safeKey(aircraftHex + '__' + target);
  if (!(await claimEvent(type, key, SQUAWK_DEDUPE_MS))) return { ok:true, deduped:true, sent:0 };
  const title = `FISO FID – ${target}`;
  const body = `${callsign} · squawk ${target} detected`;
  const result = await sendToRegisteredDevices(type, title, body, 'fisofid-' + target + '-' + key.toLowerCase(), {urgency: target === '7700' ? 'high' : 'normal'});
  await admin.database().ref('fiso/pushEventLog/' + type + '/' + key).set({ aircraftHex, callsign, squawk, altitudeFt:Number.isFinite(Number(data.altitudeFt))?Number(data.altitudeFt):null, sentAt:admin.database.ServerValue.TIMESTAMP, triggeredByUid:decoded.uid, sent:result.sent, failed:result.failed });
  return { ok:true, deduped:false, ...result };
}

async function handlePch(data, decoded) {
  const callsigns = Array.isArray(data.callsigns) ? data.callsigns.slice(0,2).map(cleanCallsign) : [];
  const hexA = safeKey(data.hexA), hexB = safeKey(data.hexB);
  const distanceNm = Number(data.distanceNm), verticalFt = Number(data.verticalFt);
  if (!hexA || !hexB || hexA === hexB) throw Object.assign(new Error('Two different aircraft are required for PCH.'), {status:400});
  if (!Number.isFinite(distanceNm) || distanceNm < 0 || distanceNm > 3) throw Object.assign(new Error('PCH lateral separation is outside the configured 3 NM limit.'), {status:400});
  if (!Number.isFinite(verticalFt) || verticalFt < 0 || verticalFt > 500) throw Object.assign(new Error('PCH vertical separation is outside the configured 500 ft limit.'), {status:400});
  const displayA = callsigns[0] || hexA, displayB = callsigns[1] || hexB;
  const key = [hexA, hexB].sort().join('__');
  if (!(await claimEvent('PCH', key, PCH_DEDUPE_MS))) return { ok:true, deduped:true, sent:0 };
  const title = 'FISO FID – PCH';
  const body = `${displayA} / ${displayB} · ${Math.round(distanceNm*10)/10} NM · ${Math.round(verticalFt)} ft`;
  const result = await sendToRegisteredDevices('PCH', title, body, 'fisofid-pch-' + key.toLowerCase());
  await admin.database().ref('fiso/pushEventLog/PCH/' + key).set({ hexA, hexB, callsigns:[displayA,displayB], distanceNm:Math.round(distanceNm*10)/10, verticalFt:Math.round(verticalFt), sentAt:admin.database.ServerValue.TIMESTAMP, triggeredByUid:decoded.uid, sent:result.sent, failed:result.failed });
  return { ok:true, deduped:false, ...result };
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return json(405, { ok:false, error:'Method not allowed.' });
  try {
    getAdminApp();
    const authHeader = String(event.headers.authorization || event.headers.Authorization || '');
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return json(401, { ok:false, error:'Authentication required.' });
    const decoded = await admin.auth().verifyIdToken(match[1], true);
    if (decoded.admin !== true && decoded.operational !== true) return json(403, { ok:false, error:'Operational permission required.' });

    const data = JSON.parse(event.body || '{}');
    const type = String(data.type || '').toUpperCase();
    let result;
    if (type === 'SIMILAR') result = await handleSimilar(data, decoded);
    else if (type === 'HAZPLOT') result = await handleHazplot(data, decoded);
    else if (type === 'HAZDAM') result = await handleHazdam(data, decoded);
    else if (type === 'SQ0027') result = await handleSquawk(data, decoded, '0027');
    else if (type === 'SQ0030') result = await handleSquawk(data, decoded, '0030');
    else if (type === 'SQ7700') result = await handleSquawk(data, decoded, '7700');
    else if (type === 'PCH') result = await handlePch(data, decoded);
    else return json(400, { ok:false, error:'Unsupported operational alert type.' });
    return json(200, result);
  } catch (err) {
    console.error('FISO FID operational push failed', err);
    if (err && err.status) return json(err.status, {ok:false, error:err.message});
    return json(500, { ok:false, error:err && err.message ? err.message : 'Operational notification could not be sent.' });
  }
};
