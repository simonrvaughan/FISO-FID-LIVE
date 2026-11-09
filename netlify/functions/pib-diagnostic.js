'use strict';
const PIB_URL = 'https://pibs.nats.co.uk/operational/pibs/PIB.xml';
const SAMPLE_LIMIT = 256 * 1024;
// Read-only bounded probe; this checks transport/schema presence, not full-feed validity or backend health.
exports.createHandler = function ({ fetcher = fetch, now = Date.now } = {}) {
  return async function () {
    const started = now(), checkedAt = new Date(started).toISOString();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    try {
      const response = await fetcher(PIB_URL, { signal: controller.signal, redirect: 'error', headers: { 'User-Agent': 'FISOFID/DEV447 Diagnostic', Accept: 'application/xml,text/xml' } });
      if (!response.ok) {
        await response.body?.cancel();
        return { statusCode: 502, headers, body: JSON.stringify({ ok: false, code: 'UPSTREAM_HTTP', http: response.status, checkedAt, elapsedMs: now() - started }) };
      }
      if (!response.body) throw new Error('No response body');
      const reader = response.body.getReader(), chunks = [];
      let bytes = 0, sampleTruncated = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const remaining = SAMPLE_LIMIT - bytes;
          chunks.push(Buffer.from(value.subarray(0, remaining))); bytes += Math.min(value.byteLength, remaining);
          if (bytes >= SAMPLE_LIMIT) { sampleTruncated = true; await reader.cancel(); break; }
        }
      } finally { reader.releaseLock(); }
      const text = Buffer.concat(chunks).toString('utf8');
      const hasNotam = /<(?:[\w.-]+:)?Notam(?:\s|>)/i.test(text);
      const ok = hasNotam && !/<(?:html|!doctype\s+html)\b/i.test(text);
      return { statusCode: ok ? 200 : 502, headers, body: JSON.stringify({
        ok, code: ok ? 'NATS_SAMPLE_OK' : 'INVALID_NATS_SAMPLE', checkedAt, elapsedMs: now() - started,
        http: response.status, contentType: response.headers.get('content-type') || '',
        sampleBytes: bytes, sampleTruncated, scope: 'NATS transport and bounded NOTAM XML sample only'
      }) };
    } catch (error) {
      const code = controller.signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE';
      console.error('DEV447 NATS diagnostic failed', { code, message: String(error.message || error) });
      return { statusCode: 502, headers, body: JSON.stringify({ ok: false, code, checkedAt, elapsedMs: now() - started }) };
    } finally { clearTimeout(timer); }
  };
};
exports.handler = exports.createHandler();
