const admin = require('firebase-admin');

const DATABASE_URL = 'https://fisofid-default-rtdb.europe-west1.firebasedatabase.app';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function getAdminApp() {
  if (admin.apps.length) return admin.app();

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('Server notification credentials are not configured.');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (err) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
  }

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL,
  });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    getAdminApp();

    const authHeader = String(event.headers.authorization || event.headers.Authorization || '');
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return json(401, { ok: false, error: 'Authentication required.' });
    }

    const decoded = await admin.auth().verifyIdToken(match[1], true);
    const body = JSON.parse(event.body || '{}');
    const token = String(body.token || '').trim();

    if (!token || token.length > 4096) {
      return json(400, { ok: false, error: 'A valid registered device token is required.' });
    }

    const snapshot = await admin.database().ref('fiso/pushTokens').once('value');
    const records = snapshot.val() || {};
    const registered = Object.values(records).find((record) => record && record.token === token);

    if (!registered || registered.enabled === false || registered.uid !== decoded.uid) {
      return json(403, { ok: false, error: 'This device token is not registered to the signed-in user.' });
    }

    const testType = String(body.testType || 'TEST').toUpperCase();
    const isSimilar = testType === 'SIMILAR';
    const isHazplot = testType === 'HAZPLOT';
    const title = isSimilar ? 'FISO FID – SIM CALLSIGN' : isHazplot ? 'FISO FID – HAZPLOT' : 'FISO FID – TEST';
    const notificationBody = isSimilar
      ? 'TEST · GAVGA and GTSGA · similar callsign detected'
      : isHazplot
        ? 'TEST · GBNNZ · Gliding Pin 1 · plotted hazard occurrence'
        : 'Push notifications are working correctly on this device.';
    const tag = isSimilar ? 'fisofid-sim-callsign-test' : isHazplot ? 'fisofid-hazplot-test' : 'fisofid-test';

    const message = {
      token,
      notification: { title, body: notificationBody },
      webpush: {
        notification: {
          title,
          body: notificationBody,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag,
        },
        fcmOptions: { link: '/' },
      },
      data: {
        type: isSimilar ? 'SIMILAR_TEST' : isHazplot ? 'HAZPLOT_TEST' : 'TEST',
        eventKey: tag,
      },
    };

    const messageId = await admin.messaging().send(message);
    return json(200, { ok: true, messageId });
  } catch (err) {
    console.error('FISO FID Netlify test push failed', err);
    return json(500, {
      ok: false,
      error: err && err.message ? err.message : 'Test notification could not be sent.',
    });
  }
};
