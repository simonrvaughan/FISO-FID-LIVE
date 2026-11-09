// FFApp ADS-B proxy - last-resort fallback when direct browser calls to the
// public ADS-B feeds fail (CORS changes, corporate networks, outages).
// Tries each upstream in order and returns the first success, normalised to
// the readsb {"ac":[...]} shape the app expects.
//
//   Point:  /api/adsb?lat=51.33&lon=0.03&radius=30
//   Search: /api/adsb?kind=hex&value=4b1edb   (kind: hex|callsign|reg|squawk)
//
// (/api/adsb redirects here via netlify.toml)

const UPSTREAMS = [
  {
    name: "airplanes.live",
    point: (lat, lon, r) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${r}`,
    search: (kind, v) => `https://api.airplanes.live/v2/${kind}/${v}`,
    key: "ac",
  },
  {
    name: "adsb.lol",
    point: (lat, lon, r) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}`,
    search: (kind, v) => `https://api.adsb.lol/v2/${kind}/${v}`,
    key: "ac",
  },
  {
    name: "adsb.fi",
    point: (lat, lon, r) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${r}`,
    search: (kind, v) => `https://opendata.adsb.fi/api/v2/${kind}/${v}`,
    key: "aircraft",
  },
];

const KINDS = ["hex", "callsign", "reg", "squawk"];

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async function (event) {
  const qs = (event && event.queryStringParameters) || {};
  let urlOf;

  if (qs.kind != null || qs.value != null) {
    const kind = String(qs.kind || "").toLowerCase();
    const value = String(qs.value || "").trim().toUpperCase();
    if (KINDS.indexOf(kind) === -1) return respond(400, { error: "kind must be one of " + KINDS.join("|") });
    if (!/^[A-Z0-9-]{1,10}$/.test(value)) return respond(400, { error: "Invalid value." });
    urlOf = (u) => u.search(kind, encodeURIComponent(value));
  } else {
    const lat = parseFloat(qs.lat), lon = parseFloat(qs.lon), radius = parseFloat(qs.radius);
    if (!isFinite(lat) || lat < -90 || lat > 90) return respond(400, { error: "Invalid lat." });
    if (!isFinite(lon) || lon < -180 || lon > 180) return respond(400, { error: "Invalid lon." });
    if (!isFinite(radius) || radius <= 0 || radius > 250) return respond(400, { error: "Invalid radius (1-250)." });
    urlOf = (u) => u.point(lat, lon, radius);
  }

  const errors = [];
  for (const upstream of UPSTREAMS) {
    try {
      const r = await fetch(urlOf(upstream), {
        headers: { "User-Agent": "FFApp-ADSB-proxy" },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const ac = (d && (d[upstream.key] || d.ac || d.aircraft)) || [];
      return respond(200, { ac, source: upstream.name, now: Date.now() });
    } catch (err) {
      errors.push(upstream.name + ": " + (err && err.message ? err.message : String(err)));
    }
  }
  return respond(502, { error: "All upstream ADS-B feeds failed.", detail: errors });
};
