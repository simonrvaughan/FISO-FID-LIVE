'use strict';

// DEV392 — Current UK airfield supplement from the public-domain OurAirports dataset.
// The browser only receives active UK entries and never downloads the worldwide CSV directly.
const SOURCE_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const ALLOWED_TYPES = new Set([
  'small_airport',
  'medium_airport',
  'large_airport',
  'heliport',
  'seaplane_base',
  'balloonport'
]);

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function slimRows(csv) {
  const lines = String(csv || '').split(/\r?\n/);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]);
  const ix = {};
  header.forEach((h, i) => { ix[h] = i; });
  const required = ['ident','type','name','latitude_deg','longitude_deg','iso_country'];
  if (required.some(k => ix[k] == null)) throw new Error('Unexpected OurAirports CSV format');

  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.indexOf(',"GB",') === -1) continue;
    const r = parseCsvLine(line);
    if (r[ix.iso_country] !== 'GB') continue;
    const type = r[ix.type] || '';
    if (!ALLOWED_TYPES.has(type)) continue;
    const lat = Number(r[ix.latitude_deg]);
    const lon = Number(r[ix.longitude_deg]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const icao = String(r[ix.icao_code] || '').trim().toUpperCase();
    const ident = String(r[ix.ident] || '').trim().toUpperCase();
    const gps = String(r[ix.gps_code] || '').trim().toUpperCase();
    const iata = String(r[ix.iata_code] || '').trim().toUpperCase();
    const name = String(r[ix.name] || '').trim();
    const municipality = String(r[ix.municipality] || '').trim();
    const scheduled = String(r[ix.scheduled_service] || '').trim().toLowerCase() === 'yes';
    result.push({
      ident,
      icao: icao || (/^EG[A-Z0-9]{2}$/.test(gps) ? gps : ''),
      iata,
      name,
      lat,
      lon,
      type,
      municipality,
      scheduled
    });
  }
  return result;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { Allow: 'GET' }, body: 'Method Not Allowed' };
  }
  try {
    const response = await fetch(SOURCE_URL, {
      headers: {
        'Accept': 'text/csv,*/*;q=0.8',
        'User-Agent': 'FISO-FID-Airfield-Updater/392'
      }
    });
    if (!response.ok) throw new Error('OurAirports returned HTTP ' + response.status);
    const csv = await response.text();
    const airfields = slimRows(csv);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
        'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=86400, stale-while-revalidate=604800',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        source: 'OurAirports',
        source_url: SOURCE_URL,
        generated_at: new Date().toISOString(),
        count: airfields.length,
        airfields
      })
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: { message: String(err && err.message || err) } })
    };
  }
};
