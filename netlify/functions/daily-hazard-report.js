// FFApp Release068 Daily Hazard Report
// Scheduled for 2100 UTC. Sends one Telegram summary of today's FFApp hazards
// and UK FIR squawk events for 0027, 0030 and 7700.

// Release 278: 2100 UTC Telegram schedule removed while messaging is redesigned.

const store = require('./ffapp-daily-store');
const RELEASE = '068';

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body, null, 2) };
}
async function sendTelegram(text) {
  // Release 278 hard stop: daily Telegram delivery is disabled.
  return { ok:true, skipped:true, disabled:true, reason:'Legacy Telegram messaging stopped in Release 278 pending complete redesign.' };
}
function sampleReport() {
  return {
    date: store.todayUtc(),
    updatedAt: new Date().toISOString(),
    hazards: {
      h1: { type:'HAZDAM', callsign:'GCJHT', firstSeen:'2026-07-05T14:32:00Z', lastSeen:'2026-07-05T14:35:00Z', areaOrSite:'D012', altitudeFt:4500, location:'51.2340, -1.2340' },
      h2: { type:'PCH', callsign:'GABCD / GEFGH', firstSeen:'2026-07-05T16:01:00Z', lastSeen:'2026-07-05T16:01:00Z', areaOrSite:'3.0 NM', altitudeFt:3200, location:'52.0000, -0.5000' },
      h3: { type:'SIMILAR', callsign:'RYR812AB / EZY431AB', firstSeen:'2026-07-05T18:10:00Z', lastSeen:'2026-07-05T18:10:00Z', areaOrSite:'Suffix AB', location:'52.1200, -1.1000' }
    },
    squawks: {
      s1: { squawk:'7700', callsign:'GTEST', firstSeen:'2026-07-05T19:10:00Z', lastSeen:'2026-07-05T19:12:00Z', altitudeFt:2800, groundSpeedKt:120, track:270, location:'51.5000, -1.0000' },
      s2: { squawk:'0030', callsign:'N123AB', firstSeen:'2026-07-05T11:22:00Z', lastSeen:'2026-07-05T11:25:00Z', altitudeFt:6000, groundSpeedKt:180, track:90, location:'53.0000, -2.0000' }
    }
  };
}
exports.handler = async function(event) {
  try {
    const qs = (event && event.queryStringParameters) || {};
    const date = qs.date || store.todayUtc();

    if (qs.test === 'sample') {
      const text = store.buildReportText(sampleReport());
      return json(200, { ok:true, release:RELEASE, test:'sample', sendsTelegram:false, text });
    }

    const report = await store.readReport(date);
    const text = store.buildReportText(report);

    if (qs.dryRun === '1' || qs.test === 'dry-run') {
      return json(200, {
        ok:true,
        release:RELEASE,
        test: qs.test || 'dry-run',
        sendsTelegram:false,
        date,
        hazardCount: Object.keys(report.hazards || {}).length,
        squawkCount: Object.keys(report.squawks || {}).length,
        text
      });
    }

    const telegram = await sendTelegram(text);
    return json(200, {
      ok: telegram.ok,
      release: RELEASE,
      schedule: '2100 UTC daily',
      date,
      hazardCount: Object.keys(report.hazards || {}).length,
      squawkCount: Object.keys(report.squawks || {}).length,
      telegram,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error(e);
    return json(200, { ok:false, release:RELEASE, error: e && e.message ? e.message : String(e) });
  }
};
