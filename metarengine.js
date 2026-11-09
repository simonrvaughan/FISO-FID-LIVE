"use strict";

/* FFApp - Live METAR Engine
   Fetches METARs on demand from the aviationweather.gov Data API and keeps
   a short in-memory cache so repeated clicks don't hammer the API.

   aviationweather.gov does not send CORS headers, so browsers block direct
   calls ("Load failed"). The primary route is therefore the same-origin
   Netlify function proxy (netlify/functions/metar-proxy.js); the direct
   API is kept as a fallback in case the proxy is unavailable.

   Public interface (unchanged from the old local-cache engine):
     window.FFAppMetarEngine.load()              -> Promise (kept for compatibility, resolves immediately)
     window.FFAppMetarEngine.getMetar(icao)      -> Promise<string|null>  latest raw METAR
     window.FFAppMetarEngine.getAllMetars(icaos) -> Promise<{ICAO: raw}>  batch lookup
     window.FFAppMetarEngine.status()            -> {loaded, count, loadedAt, error, source} */
(function () {
  var PROXY_URL = "/.netlify/functions/metar-proxy";
  var API_URL = "https://aviationweather.gov/api/data/metar";
  var TTL_MS = 60 * 1000; // treat a METAR as fresh for 1 minute
  var CHUNK_SIZE = 100; // max ICAOs per batch request

  var cache = Object.create(null); // ICAO -> { raw, at }
  var lastError = null;
  var lastFetchAt = null;

  function normaliseIcao(icao) {
    return String(icao || "").trim().toUpperCase();
  }

  function isFresh(entry) {
    return entry && Date.now() - entry.at < TTL_MS;
  }

  function fetchJson(baseUrl, icaos) {
    var url = baseUrl + "?ids=" + encodeURIComponent(icaos.join(",")) + "&format=json";
    return fetch(url, { cache: "no-store" }).then(function (response) {
      if (!response.ok) {
        throw new Error("METAR source returned HTTP " + response.status);
      }
      return response.json();
    });
  }

  /* Fetch one batch of ICAOs (proxy first, direct API as fallback) and
     merge into the cache. Resolves with ICAO -> raw METAR for stations
     that reported. */
  function fetchBatch(icaos) {
    return fetchJson(PROXY_URL, icaos)
      .catch(function () {
        return fetchJson(API_URL, icaos);
      })
      .then(function (rows) {
        var now = Date.now();
        var result = Object.create(null);
        // Mark every requested ICAO as checked so "no METAR" is also cached
        icaos.forEach(function (icao) {
          if (!isFresh(cache[icao])) cache[icao] = { raw: null, at: now };
        });
        (Array.isArray(rows) ? rows : []).forEach(function (row) {
          var icao = normaliseIcao(row && row.icaoId);
          var raw = row && row.rawOb ? String(row.rawOb).trim() : "";
          if (icao && raw) {
            cache[icao] = { raw: raw, at: now };
            result[icao] = raw;
          }
        });
        lastError = null;
        lastFetchAt = new Date();
        return result;
      })
      .catch(function (err) {
        lastError = err;
        throw err;
      });
  }

  /* Latest raw METAR for a single ICAO, or null if the station has none. */
  function getMetar(icao) {
    var key = normaliseIcao(icao);
    if (!key) return Promise.resolve(null);
    if (isFresh(cache[key])) return Promise.resolve(cache[key].raw);
    return fetchBatch([key]).then(function () {
      return cache[key] ? cache[key].raw : null;
    });
  }

  /* Batch lookup. Pass an array of ICAOs; stale ones are refetched in
     chunks, fresh ones served from cache. Resolves with {ICAO: raw}. */
  function getAllMetars(icaos) {
    var wanted = (Array.isArray(icaos) ? icaos : Object.keys(cache))
      .map(normaliseIcao)
      .filter(function (icao, i, arr) {
        return icao && arr.indexOf(icao) === i;
      });

    var stale = wanted.filter(function (icao) {
      return !isFresh(cache[icao]);
    });

    var chunks = [];
    for (var i = 0; i < stale.length; i += CHUNK_SIZE) {
      chunks.push(stale.slice(i, i + CHUNK_SIZE));
    }

    return Promise.all(chunks.map(fetchBatch)).then(function () {
      var out = {};
      wanted.forEach(function (icao) {
        if (cache[icao] && cache[icao].raw) out[icao] = cache[icao].raw;
      });
      return out;
    });
  }

  /* Kept for compatibility with the old cache-file engine. Nothing to
     preload any more - METARs are fetched on demand. */
  function load() {
    return Promise.resolve({});
  }

  function status() {
    var count = 0;
    Object.keys(cache).forEach(function (icao) {
      if (cache[icao].raw) count++;
    });
    return {
      loaded: true,
      count: count,
      loadedAt: lastFetchAt,
      error: lastError ? String(lastError.message || lastError) : null,
      source: API_URL,
    };
  }

  window.FFAppMetarEngine = {
    load: load,
    getMetar: getMetar,
    getAllMetars: getAllMetars,
    status: status,
  };
})();
