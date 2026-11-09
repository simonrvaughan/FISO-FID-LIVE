import { getStore } from "@netlify/blobs";
import { gzip as gzipCb } from "node:zlib";
import { promisify } from "node:util";

import prepared from "./lib/pib-snapshot-builder.cjs";
const gzip = promisify(gzipCb);
const PIB_URL = "https://pibs.nats.co.uk/operational/pibs/PIB.xml";
const STORE_NAME = "fisofid-live-pib";
const XML_KEY = "latest-pib.xml.gz";
const STATUS_KEY = "status.json";
const CHANGES_KEY = "changes.json";

async function fetchXml() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(PIB_URL, {
      headers: {
        "User-Agent": "FISOFID/DEV430 Server PIB",
        Accept: "application/xml,text/xml,*/*",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`NATS PIB returned HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > 25 * 1024 * 1024) throw new Error("PIB XML too large");
    return {
      body: Buffer.from(arrayBuffer),
      lastModified: response.headers.get("last-modified") || "",
      etag: response.headers.get("etag") || "",
    };
  } finally {
    clearTimeout(timer);
  }
}

function hashBuffer(buf) {
  let h = 2166136261;
  for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0") + ":" + buf.length;
}

function extractPibTimes(xml, now = Date.now()) {
  const issued = (xml.match(/<(?:[\w.-]+:)?Issued>\s*([^<]+)\s*<\/(?:[\w.-]+:)?Issued>/i) || [])[1] || "";
  const validFrom = (xml.match(/<(?:[\w.-]+:)?ValidFrom>\s*([^<]+)\s*<\/(?:[\w.-]+:)?ValidFrom>/i) || [])[1] || "";
  const validTo = (xml.match(/<(?:[\w.-]+:)?ValidTo>\s*([^<]+)\s*<\/(?:[\w.-]+:)?ValidTo>/i) || [])[1] || "";
  const validToMs = Date.parse(validTo);
  return { issued, validFrom, validTo, stale: !Number.isFinite(validToMs) || validToMs <= now };
}

function nextQuarterHour() {
  return new Date(Math.ceil((Date.now() + 1000) / 900000) * 900000).toISOString();
}

export function createHandler(deps = {}) {
 const storeFactory = deps.getStore || getStore;
 const retrieveXml = deps.fetchXml || fetchXml;
 const now = deps.now || Date.now;
 return async function handler() {
  const attemptedAt = new Date(now()).toISOString();
  // IMPORTANT: Functions v2 (default export + Request/Response) is required so
  // Netlify injects the Blobs runtime context automatically.
  let store, previous = null;
  try {
    store = storeFactory(STORE_NAME);
    try { previous = await store.get(STATUS_KEY, { type: "json", consistency: "strong" }); } catch (_) {}
    const result = await retrieveXml();
    if (!result.body || result.body.length < 100) throw new Error("NATS PIB returned no usable XML");
    const xml = result.body.toString("utf8");
    if (!/<(?:[\w.-]+:)?Notam\b/i.test(xml)) throw new Error("NATS PIB XML contains no NOTAM records");

    const hash = hashBuffer(result.body);
    const changed = !previous || previous.hash !== hash;
    const pibTimes = extractPibTimes(xml, now());
    let snapshotSlot = previous?.snapshotSlot, snapshotRevision = previous?.snapshotRevision, preparedSnapshot=null;
    if (!changed && ['a', 'b'].includes(snapshotSlot) && snapshotRevision) {
      let existing=null;
      try{existing=await store.get('prepared-pib-'+snapshotSlot+'.json',{type:"json",consistency:"strong"});}catch(_){}
      if(!existing||existing.revision!==snapshotRevision||!Array.isArray(existing.dataset?.notams)){snapshotSlot=null;snapshotRevision=null;}
      else preparedSnapshot=existing;
    }
    if (changed || !['a', 'b'].includes(snapshotSlot) || !snapshotRevision) {
      const snapshot = prepared.buildSnapshot(xml, { checkedAt: attemptedAt, lastModified: result.lastModified });
      preparedSnapshot=snapshot;
      snapshotSlot = previous?.snapshotSlot === 'a' ? 'b' : 'a';
      snapshotRevision = snapshot.revision;
      await store.setJSON('prepared-pib-' + snapshotSlot + '.json', snapshot);
    }

    const ids=preparedSnapshot.dataset.notams.map(record=>record.notamId).sort();
    let added = [], removed = [];
    if (previous && Array.isArray(previous.notamIds)) {
      const old = new Set(previous.notamIds), next = new Set(ids);
      added = ids.filter(id => !old.has(id));
      removed = previous.notamIds.filter(id => !next.has(id));
    }

    if (changed || !previous?.lastSuccessfulUpdate) {
      const compressed = await gzip(result.body, { level: 6 });
      const payload = compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);
      await store.set(XML_KEY, payload);
    }

    const status = {
      ok: true,
      dev: 448,
      source: "NATS contingency/live PIB",
      sourceUrl: PIB_URL,
      lastAttempt: attemptedAt,
      lastSuccessfulUpdate: attemptedAt,
      snapshotSlot, snapshotRevision,
      natsLastModified: result.lastModified,
      etag: result.etag,
      hash,
      changed,
      notamCount: ids.length,
      notamIds: ids,
      xmlBytes: result.body.length,
      pibIssued: pibTimes.issued,
      pibValidFrom: pibTimes.validFrom,
      pibValidTo: pibTimes.validTo,
      stale: pibTimes.stale,
      nextScheduledCheck: nextQuarterHour(),
    };
    await store.setJSON(STATUS_KEY, status);
    if (added.length || removed.length) {
      await store.setJSON(CHANGES_KEY, { checkedAt: status.lastSuccessfulUpdate, added, removed, previousCount: previous?.notamCount ?? null, newCount: ids.length });
    }
    console.log("DEV448 PIB scheduled update OK", { changed, stale: pibTimes.stale, pibValidTo: pibTimes.validTo, notamCount: ids.length, added: added.length, removed: removed.length, bytes: result.body.length });
    return new Response(null, { status: 204 });
  } catch (err) {
    const status = { ...(previous || {}), ok: false, dev: 448, lastAttempt: attemptedAt, error: String(err?.message || err), nextScheduledCheck: nextQuarterHour() };
    try { if(store)await store.setJSON(STATUS_KEY, status); } catch (writeErr) { console.error("DEV448 could not write failure status", writeErr); }
    console.error("DEV448 PIB scheduled update failed", err);
    return new Response(null, { status: 500 });
  }
 };
}
export default createHandler();
