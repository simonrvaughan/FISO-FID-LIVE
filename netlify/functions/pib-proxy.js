"use strict";

const https = require("https");
const PIB_URL = "https://pibs.nats.co.uk/operational/pibs/PIB.xml";

function getXml() {
  return new Promise((resolve, reject) => {
    const req = https.get(PIB_URL, {
      headers: { "User-Agent": "FISOFID/DEV405 Live PIB", "Accept": "application/xml,text/xml,*/*" },
      timeout: 12000
    }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error("NATS PIB returned HTTP " + res.statusCode));
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; if (body.length > 20 * 1024 * 1024) req.destroy(new Error("PIB XML too large")); });
      res.on("end", () => resolve({ body, lastModified: res.headers["last-modified"] || "", etag: res.headers.etag || "" }));
    });
    req.on("timeout", () => req.destroy(new Error("NATS PIB request timed out")));
    req.on("error", reject);
  });
}

exports.handler = async function () {
  try {
    const r = await getXml();
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Access-Control-Allow-Origin": "*",
        "X-FISOFID-Source": "NATS-PIB",
        "X-NATS-Last-Modified": r.lastModified,
        "ETag": r.etag
      },
      body: r.body
    };
  } catch (err) {
    return { statusCode: 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify({ ok:false, error:String(err && err.message || err) }) };
  }
};
