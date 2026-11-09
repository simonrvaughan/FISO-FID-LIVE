import { getStore } from "@netlify/blobs";
import { gunzip as gunzipCb } from "node:zlib";
import { promisify } from "node:util";

import health from "./lib/pib-health.cjs";
const gunzip = promisify(gunzipCb);
const STORE_NAME = "fisofid-live-pib";

export function createHandler(deps = {}) {
  const storeFactory = deps.getStore || getStore;
  const decompress = deps.gunzip || gunzip;
  const now = deps.now || Date.now;
  return async function handler(request) {
    // Functions v2 ensures Netlify's Blobs runtime context is injected.
    const url = new URL(request.url);
    try {
      const store = storeFactory(STORE_NAME);
      const status = await store.get("status.json", { type: "json", consistency: "strong" });
      if (url.searchParams.get("status") === "1") {
        const report = health.assessStatus(status, now());
        return Response.json(report, { status: report.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
      }
      const raw = await store.get("latest-pib.xml.gz", { type: "arrayBuffer", consistency: "strong" });
      if (!raw) throw new Error("No server-cached PIB is available yet");
      const xml = await decompress(Buffer.from(raw));
      return new Response(xml, {
        status: 200,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Access-Control-Allow-Origin": "*",
          "X-FISOFID-Source": "SERVER-CACHE",
          "X-FISOFID-Dev": "447",
          "X-FISOFID-Server-Checked": status?.lastSuccessfulUpdate || "",
          "X-NATS-Last-Modified": status?.natsLastModified || "",
          "X-FISOFID-PIB-Issued": status?.pibIssued || "",
          "X-FISOFID-PIB-Valid-To": status?.pibValidTo || "",
          "X-FISOFID-PIB-Stale": health.assessStatus(status, now()).ok ? "false" : "true",
        },
      });
    } catch (err) {
      console.error("DEV447 PIB cache read failed", { code: "PIB_CACHE_UNAVAILABLE", message: String(err?.message || err) });
      return Response.json({ ok: false, dev: 447, error: "PIB_CACHE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  };
}
export default createHandler();
