// FFApp Release058 legacy Telegram watcher kill-switch.
// This old endpoint is deliberately disabled so older Telegram alert logic cannot send PCH/HAZPLOT/Similar/Squawk spam.
exports.config = { schedule: "" };
function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body, null, 2) };
}
exports.handler = async function(event) {
  const qs = (event && event.queryStringParameters) || {};
  return json(200, {
    ok: true,
    release: "058",
    endpoint: "telegram-alert-watcher",
    disabled: true,
    reason: "All legacy Telegram messaging is disabled in Release 278 pending complete redesign.",
    activeWatcher: null,
    testLink: null,
    sendsTelegram: false,
    activeAlerts: [],
    newAlerts: 0,
    updatedAt: new Date().toISOString()
  });
};
