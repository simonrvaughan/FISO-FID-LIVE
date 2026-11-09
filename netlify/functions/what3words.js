exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: { message: 'Method not allowed' } }) };
  }
  const words = String((event.queryStringParameters && event.queryStringParameters.words) || '')
    .trim().toLowerCase().replace(/^\/{0,3}/, '');
  if (!/^[^.\s]+\.[^.\s]+\.[^.\s]+$/.test(words)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: { message: 'Enter a valid three-word address.' } }) };
  }
  const key = String(process.env.WHAT3WORDS_API_KEY || '').trim();
  if (!key) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: { message: 'what3words is not configured on this deployment.' } }) };
  }
  try {
    const url = 'https://api.what3words.com/v3/convert-to-coordinates?words=' + encodeURIComponent(words) + '&key=' + encodeURIComponent(key);
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : 'what3words lookup failed';
      return { statusCode: response.status >= 400 && response.status < 500 ? 400 : 502, headers, body: JSON.stringify({ error: { message: msg } }) };
    }
    const c = data && data.coordinates;
    if (!c || !Number.isFinite(Number(c.lat)) || !Number.isFinite(Number(c.lng))) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: { message: 'No coordinates returned.' } }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ words: data.words || words, coordinates: { lat: Number(c.lat), lng: Number(c.lng) } }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: { message: 'Unable to contact what3words.' } }) };
  }
};
