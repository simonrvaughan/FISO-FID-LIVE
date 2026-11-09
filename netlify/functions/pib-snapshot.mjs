import { getStore } from '@netlify/blobs';
import snapshotModel from '../../pib-snapshot.js';
import health from './lib/pib-health.cjs';
export function createHandler({ storeFactory = getStore, now = Date.now } = {}) {
  return async request => {
    const headers = { 'X-FISOFID-Source': 'SERVER-PREPARED-CACHE', 'X-FISOFID-Dev': '448', 'Cache-Control': 'private, max-age=0, must-revalidate', 'Content-Type': 'application/json; charset=utf-8' };
    try {
      const store = storeFactory('fisofid-live-pib');
      const status = await store.get('status.json', { type: 'json', consistency: 'strong' });
      if (!status || !['a', 'b'].includes(status.snapshotSlot) || !/^[a-f0-9]{64}$/.test(status.snapshotRevision || '')) throw new Error('Prepared snapshot not initialised');
      const snapshot = await store.get('prepared-pib-' + status.snapshotSlot + '.json', { type: 'json', consistency: 'strong' });
      if (!snapshot || snapshot.revision !== status.snapshotRevision) throw new Error('Prepared snapshot revision mismatch');
      // Report latest successful check without reparsing/rebuilding unchanged XML.
      const result = { ...snapshot, checkedAt: status.lastSuccessfulUpdate, dataset: { ...snapshot.dataset,
        meta: { ...snapshot.dataset.meta, feedCheckedAt: status.lastSuccessfulUpdate } } };
      snapshotModel.validate(result, now());
      const assessment = health.assessStatus(status, now());
      headers.ETag = '"' + snapshot.revision + ':' + Date.parse(result.checkedAt) + ':' + assessment.ok + '"';
      headers['X-FISOFID-PIB-Stale'] = assessment.ok ? 'false' : 'true';
      if (request.headers.get('If-None-Match') === headers.ETag) return new Response(null, { status: 304, headers });
      return Response.json({ ...result, serverHealth: assessment }, { headers });
    } catch (error) {
      console.warn('DEV448 prepared PIB unavailable', { message: error.message });
      return Response.json({ ok: false, code: 'PREPARED_PIB_UNAVAILABLE' }, { status: 503, headers: { ...headers, 'Cache-Control': 'no-store' } });
    }
  };
}
export default createHandler();
