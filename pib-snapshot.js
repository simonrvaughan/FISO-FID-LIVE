/* DEV448 server-prepared PIB bootstrap. IndexedDB caching is asynchronous and optional. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FFAPP_PIB_SNAPSHOT = factory(root);
})(typeof window === 'object' ? window : globalThis, function (browser) {
  'use strict';
  const SCHEMA = 'fisofid-pib-snapshot-v1', MAX_AGE = 24 * 60 * 60 * 1000;
  function validate(value, now = Date.now()) {
    if (!value || value.schema !== SCHEMA || !/^[a-f0-9]{64}$/.test(value.revision || '')) throw new Error('Unsupported prepared PIB snapshot');
    const checked = Date.parse(value.checkedAt), issued = Date.parse(value.issued), to = Date.parse(value.validTo);
    if (![checked, issued, to].every(Number.isFinite) || checked > now + 300000 || issued > now + 300000 || to <= issued || now - checked > MAX_AGE) throw new Error('Invalid or too old prepared PIB snapshot');
    const data = value.dataset, ids = new Set();
    if (!data || !data.meta || !Array.isArray(data.notams) || !data.notams.length || data.notams.length > 100000) throw new Error('Invalid prepared PIB records');
    for (const n of data.notams) {
      if (!n || !/^[A-Z]\d{3,4}\/\d{2}$/.test(n.notamId || '') || ids.has(n.notamId)) throw new Error('Invalid or duplicate prepared PIB reference');
      ids.add(n.notamId);
      for (const [key, limit] of [['lat', 90], ['lon', 180]]) if (n[key] != null && (!Number.isFinite(n[key]) || Math.abs(n[key]) > limit)) throw new Error('Invalid prepared PIB coordinate');
    }
    return { snapshot: value, stale: to <= now || now - checked > 20 * 60000 || value.serverHealth?.ok === false };
  }
  function cache(mode, value) {
    return new Promise(resolve => {
      if (!browser?.indexedDB) return resolve(null);
      let db, settled = false;
      const finish = result => { if (settled) return; settled = true; clearTimeout(timer); try { db?.close(); } catch (_) {} resolve(result); };
      const timer = setTimeout(() => finish(null), 500);
      try {
        const open = browser.indexedDB.open('fisofid-prepared-pib-v1', 1);
        open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('snapshots')) open.result.createObjectStore('snapshots'); };
        open.onerror = () => finish(null);
        open.onsuccess = () => {
          db = open.result;
          if (settled) { db.close(); return; }
          try {
          const tx = db.transaction('snapshots', mode), store = tx.objectStore('snapshots');
          const request = mode === 'readonly' ? store.get('latest') : store.put(value, 'latest');
          let result = null;
          request.onsuccess = () => { result = request.result; };
          tx.oncomplete = () => finish(result); tx.onerror = tx.onabort = () => finish(null);
          } catch (_) { finish(null); }
        };
      } catch (_) { finish(null); }
    });
  }
  async function fetchSnapshot(fetcher, now = Date.now()) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 2500);
    try {
      const response = await fetcher('/.netlify/functions/pib-snapshot', { cache: 'no-cache', signal: abort.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Prepared PIB HTTP ' + response.status);
      const text = await response.text();
      if (text.length > 15 * 1024 * 1024) throw new Error('Prepared PIB response exceeds limit');
      return validate(JSON.parse(text), now);
    } finally { clearTimeout(timer); }
  }
  async function sameSource(snapshot, xml, cryptoImpl) {
    if (!snapshot || !cryptoImpl?.subtle) return false;
    try {
      const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(xml));
      const revision = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      return revision === snapshot.revision;
    } catch (_) { return false; }
  }
  let inflight = null;
  function announce(result, source) {
    if (!browser) return;
    const old = browser.FFAPP_PREPARED_PIB;
    if (old && (Date.parse(old.checkedAt) > Date.parse(result.snapshot.checkedAt) || (source === 'device-cache' && Date.parse(old.checkedAt) === Date.parse(result.snapshot.checkedAt)))) return;
    browser.FFAPP_PREPARED_PIB = result.snapshot;
    browser.dispatchEvent(new browser.CustomEvent('ffapp-prepared-pib', { detail: { ...result, source } }));
  }
  function start() {
    if (!browser || inflight) return inflight;
    // Start both without putting either on the map's critical path.
    cache('readonly').then(value => { try { if (value) announce(validate(value), 'device-cache'); } catch (_) {} });
    inflight = fetchSnapshot(browser.fetch.bind(browser)).then(result => {
      announce(result, 'server'); cache('readwrite', result.snapshot); return result;
    }).catch(error => { browser.dispatchEvent(new browser.CustomEvent('ffapp-prepared-pib-error', { detail: { message: error.message } })); return null; })
      .finally(() => { inflight = null; });
    return inflight;
  }
  return { SCHEMA, validate, fetchSnapshot, sameSource, start };
});
