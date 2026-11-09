// FFApp live METAR proxy.
// The aviationweather.gov Data API does not allow cross-origin browser
// requests, so the app calls this same-origin function instead and the
// fetch happens server-side. Returns the API's JSON unchanged.
//
//   GET /.netlify/functions/metar-proxy?ids=EGKB,EGLL

const API_URL = "https://aviationweather.gov/api/data/metar";

function respond(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign(
      {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60", // METARs cached 1 min at the CDN
        "Access-Control-Allow-Origin": "*",
      },
      extraHeaders || {},
    ),
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

exports.handler = async function (event) {
  const qs = (event && event.queryStringParameters) || {};
  const ids = String(qs.ids || "").toUpperCase().replace(/\s+/g, "");

  // Comma-separated ICAO/station ids only - keeps the proxy un-abusable.
  if (!/^[A-Z0-9]{3,8}(,[A-Z0-9]{3,8})*$/.test(ids)) {
    return respond(400, { error: "Invalid or missing ids parameter." });
  }
  if (ids.split(",").length > 150) {
    return respond(400, { error: "Too many stations requested (max 150)." });
  }

  try {
    const upstream = await fetch(
      API_URL + "?ids=" + encodeURIComponent(ids) + "&format=json",
      { headers: { "User-Agent": "FFApp-METAR-proxy" } },
    );
    if (!upstream.ok) {
      return respond(502, {
        error: "aviationweather.gov returned HTTP " + upstream.status,
      });
    }
    const text = await upstream.text();
    return respond(200, text);
  } catch (err) {
    return respond(502, {
      error: "Could not reach aviationweather.gov: " + (err && err.message ? err.message : String(err)),
    });
  }
};
