/* DEV447: read-only interpretation of central history; never infer cancellation from absence. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FFAPP_NOTAM_HISTORY = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const HISTORY_URL = 'https://api.fisofid.online/pib?notamChanges=today';
  function reference(value) {
    const m = String(value || '').trim().toUpperCase().match(/^([A-Z])(\d{3,4})\/(\d{2})$/);
    return m ? m[1] + m[2].padStart(4, '0') + '/' + m[3] : '';
  }
  function verifyCancellation(record) {
    const n = record || {}, id = reference(n.notamId);
    const type = String(n.type || '').trim().toUpperCase().replace(/^NOTAM/, '');
    const declared = reference(n.cancelledNotamId);
    // Only a header, never an E) mention of an unrelated cancellation, supplies evidence.
    const match = String(n.raw || '').match(/(?:^|\n|\()\s*([A-Z]\d{3,4}\/\d{2})\s+NOTAMC\s+([A-Z]\d{3,4}\/\d{2})\b/i);
    const headerId = match && reference(match[1]), headerOriginal = match && reference(match[2]);
    let reason = 'No explicit NOTAMC evidence';
    if (match && headerId !== id) reason = 'Cancellation header identifier conflicts with record';
    else if (n.cancelledNotamId && !declared) reason = 'Cancellation reference is invalid';
    else if (type && type !== 'C') reason = 'Record is not type C';
    else if (match && declared && declared !== headerOriginal) reason = 'Cancellation references conflict';
    else if ((match || type === 'C') && id && (declared || headerOriginal)) {
      const original = declared || headerOriginal;
      if (original !== id) return { verified: true, cancellationNotamId: id, cancelledNotamId: original,
        evidence: match ? 'NOTAMC header' : 'type C and explicit cancellation reference' };
      reason = 'Cancellation cannot refer to itself';
    } else if (type === 'C') reason = 'Cancellation reference missing or invalid';
    return { verified: false, cancellationNotamId: id, cancelledNotamId: declared, reason };
  }
  function dayStart(now) {
    const d = new Date(now); d.setUTCHours(0, 1, 0, 0); return d.getTime();
  }
  function timestamp(value) { return typeof value === 'string' ? Date.parse(value) : NaN; }
  function buildReport(data, clock) {
    clock = clock == null ? Date.now() : clock;
    const asOf = timestamp(data && data.asOf), from = timestamp(data && data.from);
    const checked = timestamp(data && data.lastCheckedAt), initialised = timestamp(data && data.initialisedAt);
    if (!data || !Array.isArray(data.events) || ![asOf, from, checked, initialised].every(Number.isFinite))
      throw new Error('Invalid central history response');
    if (new Date(asOf).toISOString().slice(0, 10) !== new Date(clock).toISOString().slice(0, 10) || asOf > clock + 300000)
      throw new Error('Central history is for a different day or clock is incorrect');
    if (from !== dayStart(asOf) || checked > asOf || initialised > asOf)
      throw new Error('Invalid central history time window');
    const entries = [], seen = new Set(), warnings = [];
    const events = data.events.filter(ev => ev && Number.isFinite(timestamp(ev.checkedAt)) && timestamp(ev.checkedAt) >= from && timestamp(ev.checkedAt) <= asOf)
      .sort((a, b) => timestamp(a.checkedAt) - timestamp(b.checkedAt));
    for (const ev of events) {
      for (const field of ['added', 'removed']) {
        if (ev[field] != null && !Array.isArray(ev[field])) throw new Error('Invalid history event records');
        for (const value of ev[field] || []) {
          const n = typeof value === 'string' ? { notamId: value } : value;
          if (!n || !reference(n.notamId)) { warnings.push('Record with invalid NOTAM reference omitted'); continue; }
          const verification = verifyCancellation(n);
          const kind = field === 'removed' ? 'REMOVED' : verification.verified ? 'CANCELLED' : 'NEW';
          // An unresolvable type-C record must not appear as a verified cancellation or a new active notice.
          const candidate = /^(?:NOTAM)?C$/i.test(String(n.type || '')) || /(?:^|\n|\()\s*[A-Z]\d{3,4}\/\d{2}\s+NOTAMC\b/i.test(String(n.raw || ''));
          const unresolved = field === 'added' && candidate && !verification.verified;
          const label = unresolved ? 'UNVERIFIED' : kind;
          const key = label + ':' + reference(n.notamId) + ':' + (verification.verified ? verification.cancelledNotamId : '');
          if (seen.has(key)) continue;
          seen.add(key);
          entries.push({ kind: label, at: ev.checkedAt, n: Object.assign({}, n, { notamId: reference(n.notamId) }), verification });
        }
      }
    }
    // A confirmed cancellation already reports the original; avoid a second removal card for it.
    const cancelled = new Set(entries.filter(x => x.kind === 'CANCELLED').map(x => x.verification.cancelledNotamId));
    const changes = entries.filter(x => x.kind !== 'REMOVED' || !cancelled.has(x.n.notamId)).sort((a, b) => timestamp(b.at) - timestamp(a.at));
    const counts = { NEW: 0, CANCELLED: 0, REMOVED: 0, UNVERIFIED: 0 };
    changes.forEach(x => counts[x.kind]++);
    return { asOf: data.asOf, from: data.from, lastCheckedAt: data.lastCheckedAt, initialisedAt: data.initialisedAt,
      changes, counts, warnings, delayed: clock - checked > 20 * 60000, incomplete: initialised > from,
      newest: changes.reduce((t, x) => Math.max(t, timestamp(x.at)), 0) };
  }
  async function fetchReport(fetcher, clock) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetcher(HISTORY_URL, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Central history HTTP ' + response.status);
      return buildReport(await response.json(), clock);
    } finally { clearTimeout(timer); }
  }
  return { reference, verifyCancellation, dayStart, buildReport, fetchReport, HISTORY_URL };
});
