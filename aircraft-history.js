/* DEV448: imported readsb archive positions; deliberately separate from live traffic and hazards. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.FFAPP_AIRCRAFT_HISTORY = factory(root); root.FFAPP_AIRCRAFT_HISTORY.attach(); }
})(typeof window === 'object' ? window : globalThis, function (browser) {
  'use strict';
  const MAX_POINTS = 20000, MAX_FILES = 10, RETENTION = 7 * 86400000, GAP = 120000;
  const SOURCE = 'https://www.adsb.lol/docs/open-data/historical';
  const LICENCE = 'https://opendatacommons.org/licenses/odbl/1-0/';
  function parseTrace(raw, now = Date.now()) {
    if (!raw || !/^~?[0-9a-f]{6}$/i.test(raw.icao || '') || !Number.isFinite(raw.timestamp) || !Array.isArray(raw.trace) || !raw.trace.length || raw.trace.length > MAX_POINTS) throw new Error('Expected one readsb aircraft trace with at most 20,000 samples');
    const points = [], seen = new Set();
    let details = {};
    for (const row of raw.trace) {
      if (!Array.isArray(row) || row.length < 7 || !Number.isFinite(row[0]) || row[0] < 0 || row[0] > 172800 || !Number.isFinite(row[1]) || Math.abs(row[1]) > 90 || !Number.isFinite(row[2]) || Math.abs(row[2]) > 180 || !Number.isInteger(row[6]) || row[6] < 0) throw new Error('Invalid readsb position sample; import rejected');
      const t = Math.round((raw.timestamp + row[0]) * 1000);
      if (!Number.isSafeInteger(t) || t < 0 || t > now + 300000) throw new Error('Invalid archive timestamp');
      if (row[8] && typeof row[8] === 'object' && !Array.isArray(row[8])) details = row[8];
      if (seen.has(t)) continue;
      seen.add(t);
      points.push({ t, lat: row[1], lon: row[2], alt: typeof row[3] === 'number' && Number.isFinite(row[3]) ? row[3] : row[3] === 'ground' ? 'GND' : null,
        track: Number.isFinite(row[5]) ? row[5] : null, stale: !!(row[6] & 1), legStart: !!(row[6] & 2), geometricAlt: !!(row[6] & 8),
        callsign: typeof details.flight === 'string' ? details.flight.trim().slice(0, 16) : '', sourceType: typeof row[9] === 'string' ? row[9].slice(0, 32) : null });
    }
    points.sort((a, b) => a.t - b.t);
    const hex = raw.icao.toLowerCase(), first = points[0].t, last = points[points.length - 1].t;
    if (last - first > 2 * 86400000) throw new Error('Archive time span exceeds two days');
    return { key: hex + ':' + new Date(first).toISOString().slice(0, 10), hex, registration: String(raw.r || '').slice(0, 16),
      type: String(raw.t || '').slice(0, 16), first, last, count: points.length, importedAt: now, source: SOURCE,
      licence: LICENCE, attribution: 'Contains aircraft position data from adsb.lol, ODbL 1.0. Imported-file provenance is user-supplied, not independently verified.', points };
  }
  function pointAt(points, time) {
    let low = 0, high = points.length - 1, found = -1;
    while (low <= high) { const middle = (low + high) >>> 1; if (points[middle].t <= time) { found = middle; low = middle + 1; } else high = middle - 1; }
    const p = points[found];
    return p && !p.stale && time - p.t <= GAP ? p : null;
  }
  function segments(points, until) {
    const result = []; let line = [], previous = null;
    for (const p of points) {
      if (p.t > until) break;
      if (p.stale || p.legStart || (previous && (p.t - previous.t > GAP || Math.abs(p.lon - previous.lon) > 180))) {
        if (line.length > 1) result.push(line); line = [];
      }
      if (!p.stale) line.push([p.lat, p.lon]);
      previous = p;
    }
    if (line.length > 1) result.push(line);
    return result;
  }
  function storage(action, value) {
    return new Promise((resolve, reject) => {
      if (!browser?.indexedDB) return reject(new Error('Archive storage unavailable; imported file stays in this tab only'));
      let db, transaction, settled = false;
      const finish = (result, error) => { if (settled) return; settled = true; clearTimeout(timer); try { db?.close(); } catch (_) {} error ? reject(error) : resolve(result); };
      const timer = setTimeout(() => { try { transaction?.abort(); } catch (_) {} finish(null, new Error('Archive storage timed out')); }, 2000);
      try {
        const request = browser.indexedDB.open('fisofid-aircraft-archives-v1', 1);
        request.onupgradeneeded = () => { for (const name of ['metadata', 'points']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
        request.onerror = () => finish(null, new Error('Archive storage denied'));
        request.onsuccess = () => {
          db = request.result; if (settled) { db.close(); return; }
          try {
            const write = action === 'put' || action === 'delete';
            const tx = db.transaction(['metadata', 'points'], write ? 'readwrite' : 'readonly'); transaction = tx;
            const meta = tx.objectStore('metadata'), data = tx.objectStore('points');
            let result = null;
            if (action === 'list') { const r = meta.getAll(); r.onsuccess = () => { result = r.result.filter(x => Date.now() - x.importedAt <= RETENTION).sort((a, b) => b.importedAt - a.importedAt); }; }
            else if (action === 'get') { const r = data.get(value); r.onsuccess = () => { result = r.result && Date.now() - r.result.importedAt <= RETENTION ? r.result : null; }; }
            else if (action === 'delete') { meta.delete(value); data.delete(value); }
            else if (action === 'put') {
              const r = meta.getAll(); r.onsuccess = () => {
                const candidates = r.result.filter(x => x.key !== value.key).sort((a, b) => b.importedAt - a.importedAt);
                candidates.forEach((x, i) => { if (i >= MAX_FILES - 1 || Date.now() - x.importedAt > RETENTION) { meta.delete(x.key); data.delete(x.key); } });
                const { points, ...summary } = value; meta.put(summary, value.key); data.put(value, value.key);
              };
            }
            tx.oncomplete = () => finish(result); tx.onerror = tx.onabort = () => finish(null, new Error('Archive storage failed or quota exceeded'));
          } catch (error) { finish(null, error); }
        };
      } catch (error) { finish(null, error); }
    });
  }
  function attach() {
    if (!browser?.document) return;
    const $ = id => browser.document.getElementById(id), panel = $('aircraftArchivePanel');
    if (!panel || panel.dataset.attached) return;
    panel.dataset.attached = 'true';
    const map = browser.FISO_FID_MAP, L = browser.L;
    if (!map || !L) { $('archiveStatus').textContent = 'Archive viewer needs the operational map.'; return; }
    let selected = null, visible = false, layer = L.layerGroup(), summaries = [], memory = new Map();
    const status = text => { $('archiveStatus').textContent = text; };
    const fmt = t => new Date(t).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
    function options() {
      const select = $('archiveAircraft'); select.replaceChildren();
      const empty = browser.document.createElement('option'); empty.value = ''; empty.textContent = 'Select imported aircraft / day'; select.appendChild(empty);
      summaries.forEach(item => { const option = browser.document.createElement('option'); option.value = item.key;
        option.textContent = item.hex.toUpperCase() + ' · ' + new Date(item.first).toISOString().slice(0, 10) + ' · ' + item.count + ' samples'; select.appendChild(option); });
    }
    function hide() { layer.clearLayers(); if (map.hasLayer(layer)) map.removeLayer(layer); visible = false; }
    function draw() {
      if (!selected || !visible) return;
      const at = selected.first + Number($('archiveTimeline').value) / 1000 * (selected.last - selected.first);
      layer.clearLayers();
      const lines = segments(selected.points, at), p = pointAt(selected.points, at);
      if (lines.length) L.polyline(lines, { pane: 'trailPane', color: '#e6a3ff', weight: 3, dashArray: '5 5', interactive: false }).addTo(layer);
      if (p) L.circleMarker([p.lat, p.lon], { pane: 'trailPane', radius: 6, color: '#e6a3ff', fillOpacity: 0.8, interactive: false }).bindTooltip('ARCHIVE ' + selected.hex.toUpperCase(), { permanent: true }).addTo(layer);
      if (!map.hasLayer(layer)) layer.addTo(map);
      $('archiveReadout').textContent = 'Archive time: ' + fmt(at) + (p ? ' · observed sample: ' + fmt(p.t) : ' · no valid sample at this time (gap/stale)');
    }
    async function loadSelected() {
      hide(); selected = null;
      const key = $('archiveAircraft').value;
      if (!key) { status('No archive selected. Live traffic is unchanged.'); return; }
      try {
        selected = memory.get(key) || await storage('get', key);
        if (!selected?.points?.length) throw new Error('Saved archive unavailable or expired; import it again');
        $('archiveTimeline').value = 1000;
        status(selected.hex.toUpperCase() + ' · ' + selected.points.length + ' imported positions · ' + fmt(selected.first) + ' to ' + fmt(selected.last) + '. ' + selected.attribution);
        visible = true; draw();
        if (L.latLngBounds && map.fitBounds) map.fitBounds(L.latLngBounds(selected.points.map(p => [p.lat, p.lon])), { maxZoom: 10, padding: [25, 25] });
      } catch (error) { status(error.message); }
    }
    $('archiveLoadSaved').addEventListener('click', async () => {
      try { summaries = await storage('list'); options(); status(summaries.length + ' saved archives available.'); } catch (error) { status(error.message); }
    });
    $('archiveFile').addEventListener('change', async event => {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error('Import one decompressed JSON trace, at most 10 MiB');
        const archive = parseTrace(JSON.parse(await file.text())); memory.set(archive.key, archive);
        let saved = true;
        try { await storage('put', archive); } catch (error) { saved = false; status(error.message); }
        summaries = summaries.filter(x => x.key !== archive.key); summaries.unshift(archive); summaries = summaries.slice(0, MAX_FILES);
        // Keep the non-persistent fallback bounded too.
        const retained = new Set(summaries.map(x => x.key)); for (const key of memory.keys()) if (!retained.has(key)) memory.delete(key);
        options(); $('archiveAircraft').value = archive.key; await loadSelected();
        if (!saved) status($('archiveStatus').textContent + ' Storage unavailable: this import lasts only until the tab closes.');
      } catch (error) { status(error.message); } finally { event.target.value = ''; }
    });
    $('archiveAircraft').addEventListener('change', loadSelected);
    $('archiveTimeline').addEventListener('input', draw);
    $('archiveShow').addEventListener('click', () => { if (selected) { visible = true; draw(); } else status('Import or select an archive first.'); });
    $('archiveHide').addEventListener('click', hide);
    $('archiveDelete').addEventListener('click', async () => {
      const key = $('archiveAircraft').value; if (!key) return;
      let removed = true;
      try { await storage('delete', key); } catch (error) { removed = false; }
      hide(); selected = null; memory.delete(key); summaries = summaries.filter(x => x.key !== key); options();
      status(removed ? 'Selected local archive removed. Live traffic is unchanged.' : 'Archive hidden and removed from this tab. Device storage could not be cleared; retry when storage is available.');
    });
  }
  return { parseTrace, pointAt, segments, storage, attach, SOURCE, LICENCE, MAX_POINTS, MAX_FILES };
});
