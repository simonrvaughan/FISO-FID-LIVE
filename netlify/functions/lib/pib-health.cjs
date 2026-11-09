'use strict';
// Assessment only: never writes cache or history and never reports HTTP success as fresh PIB data.
function assessStatus(status, now = Date.now()) {
  const successful = Date.parse(status?.lastSuccessfulUpdate || '');
  const validTo = Date.parse(status?.pibValidTo || '');
  const checkedAgeSeconds = Number.isFinite(successful) ? Math.max(0, Math.floor((now - successful) / 1000)) : null;
  const reasons = [];
  if (!status) reasons.push('NO_STATUS');
  if (status?.ok !== true) reasons.push('LAST_UPDATE_FAILED');
  if (!Number.isFinite(successful) || successful > now + 300000) reasons.push('INVALID_LAST_SUCCESS');
  else if (now - successful > 20 * 60000) reasons.push('UPDATES_DELAYED');
  if (!Number.isFinite(validTo)) reasons.push('INVALID_PIB_VALIDITY');
  else if (validTo <= now) reasons.push('PIB_EXPIRED');
  if (status?.stale === true) reasons.push('SOURCE_MARKED_STALE');
  if (!Number.isInteger(status?.notamCount) || status.notamCount <= 0) reasons.push('NO_NOTAMS');
  return { ok: reasons.length === 0, dev: 447, checkedAt: new Date(now).toISOString(),
    lastAttempt: status?.lastAttempt || null, lastSuccessfulUpdate: status?.lastSuccessfulUpdate || null,
    pibIssued: status?.pibIssued || null, pibValidTo: status?.pibValidTo || null,
    notamCount: status?.notamCount ?? null, checkedAgeSeconds, reasons };
}
module.exports = { assessStatus };
