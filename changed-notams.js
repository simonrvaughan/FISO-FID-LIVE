/* DEV447 central history viewer: bounded DOM, retained last successful report, no hidden polling. */
(function () {
  'use strict';
  const model = window.FFAPP_NOTAM_HISTORY, $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = value => new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC';
  let pending = false, report = null, limit = 100;
  function render() {
    const changes = report.changes, counts = report.counts;
    $('dailyHeading').textContent = 'Central NEW / CANCELLED history since ' + fmt(report.from);
    $('meta').textContent = counts.NEW + ' NEW · ' + counts.CANCELLED + ' verified NOTAMC · ' + counts.REMOVED + ' removed from feed · ' + counts.UNVERIFIED + ' unresolved. Last successful feed check: ' + fmt(report.lastCheckedAt) + '.' +
      (report.incomplete ? ' Incomplete coverage: recording began ' + fmt(report.initialisedAt) + '.' : '') +
      (report.delayed ? ' Feed updates are delayed.' : '') + (report.warnings.length ? ' Some invalid records were omitted.' : '');
    $('added').innerHTML = changes.slice(0, limit).map(x => {
      const n = x.n, v = x.verification, cancelled = x.kind === 'CANCELLED';
      const color = cancelled ? '#ff7777' : x.kind === 'NEW' ? '#45e59a' : '#ffcc66';
      return '<article class="notam"><div class="id"><span style="color:' + color + '">' + esc(x.kind === 'REMOVED' ? 'REMOVED FROM FEED' : x.kind) + '</span> · ' + esc(n.notamId) + '</div>' +
        (cancelled ? '<div class="small"><b>Cancellation NOTAM:</b> ' + esc(v.cancellationNotamId) + ' · <b>Cancelled NOTAM:</b> ' + esc(v.cancelledNotamId) + '</div><div class="small">Verified from recorded ' + esc(v.evidence) + '.</div>' : '') +
        (x.kind === 'REMOVED' ? '<div class="small">Removal alone does not establish cancellation; the notice may have expired or left the PIB scope.</div>' : '') +
        (x.kind === 'UNVERIFIED' ? '<div class="small">Cancellation requires review: ' + esc(v.reason) + '.</div>' : '') +
        '<div class="small">First recorded at feed check: ' + esc(fmt(x.at)) + '</div>' +
        (n.qLine ? '<div class="q">Q) ' + esc(n.qLine) + '</div>' : '') +
        ['icao', 'b', 'c', 'd', 'eText', 'f', 'g'].map((key, i) => n[key] ? '<div class="' + (key === 'eText' ? 'e' : 'small') + '">' + 'ABCDEFG'[i] + ') ' + esc(n[key]) + '</div>' : '').join('') + '</article>';
    }).join('') || '<p class="empty">No changes recorded in this UTC window.</p>';
    $('more').hidden = changes.length <= limit;
    $('more').textContent = 'Show next ' + Math.min(100, changes.length - limit) + ' (' + changes.length + ' total)';
  }
  async function refresh() {
    if (pending || document.hidden) return;
    pending = true;
    try {
      report = await model.fetchReport(window.fetch.bind(window));
      $('error').textContent = ''; render();
    } catch (error) {
      $('error').textContent = 'History unavailable: ' + error.message + '. ' + (report ? 'Showing the last successful report from ' + fmt(report.asOf) + '; it is not current.' : 'No central history is available.') + ' Retrying automatically.';
    } finally { pending = false; }
  }
  $('more').addEventListener('click', () => { limit += 100; render(); });
  $('retry').addEventListener('click', refresh);
  refresh(); setInterval(refresh, 30000);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
})();
