# FISO FID Push Notification setup — Release 282

Release 282 configures the Firebase Web Push public VAPID key and retains device registration plus seven per-device alert preferences.

Alert categories: HAZPLOT, HAZDAM, SIMILAR, SQ0027, SQ0030, SQ7700 and PCH.

The old Telegram process remains disabled. Live server-side alert generation remains disabled while push delivery is commissioned.

## Device commissioning
1. Deploy Release 282 to the HTTPS Netlify DEV site.
2. Open the deployed site on the target device and sign in.
3. Where the platform requires it, install/add FISO FID to the Home Screen.
4. Open Notifications and select **Enable notifications on this device**.
5. Allow notification permission when prompted.
6. Confirm the device shows **Notifications ON** before proceeding to a controlled test push.

Do not place a Firebase service-account private key or other server secret in browser code. The configured VAPID key is the public Web Push key.

## Release 285 — Netlify test-push backend
Firebase Cloud Functions are not required. The test notification is sent by `netlify/functions/send-test-push.js`.

Netlify must have one secret environment variable:

`FIREBASE_SERVICE_ACCOUNT_JSON`

Set its value to the complete JSON contents of a Firebase/Google service-account key for the FISOFID project. Treat this value as a private credential. Never put it in `index.html`, `app.js`, a ZIP shared publicly, or a client-side environment variable.

The function requires a valid Firebase ID token from the signed-in FISO FID user and checks that the FCM device token is registered in `fiso/pushTokens` to the same Firebase UID before it sends anything.


## Release 286 SIM CALLSIGN test
On a registered device, press **TEST SIM CALLSIGN**. Expected notification:
- Title: `FISO FID – SIM CALLSIGN`
- Body: `TEST · GAVGA and GTSGA · similar callsign detected`
This is a synthetic delivery test only and does not create a live similar-callsign event.

## Release 287 live SIM CALLSIGN
Live SIM CALLSIGN push is now enabled through `netlify/functions/send-operational-push.js`.
The browser's existing last-two-character detector submits only newly observed qualifying pairs. The Netlify relay:
- verifies the signed-in Firebase user has `admin` or `operational` custom claims;
- validates the pair has matching final two callsign characters;
- validates both squawks are alert-enabled and the pair is within 30 NM;
- sends only to registered devices with `preferences.SIMILAR !== false`;
- suppresses duplicate notifications for the same callsign pair for 10 minutes.

Other live operational push types remain disabled in Release 287.

## Release 288 — Persistence and live HAZPLOT
Once a device is enabled, the browser stores an explicit device-enabled preference and silently renews/re-registers its FCM token on subsequent app loads. Pressing **Disable on this device** removes the server registration, deletes the FCM token, and stores the disabled state so a later reload does not silently re-enable it.

Live HAZPLOT is generated from the same canonical HAZBUF calculation used by the map: a valid, currently rendered operational plotted hazard plus an eligible aircraft satisfying the configured HAZPLOT lateral/vertical checks. The browser relays only the transition into a new aircraft/hazard conflict. The Netlify function verifies Firebase authentication, constructs the notification server-side, honours each registered device's HAZPLOT preference, and deduplicates the same aircraft/hazard pair for two minutes across open sessions.


## Release 289 — all seven live alert categories
Live operational push is enabled for HAZPLOT, HAZDAM, SIMILAR, SQ0027, SQ0030, SQ7700 and PCH.

- HAZDAM uses the current browser HAZDAM conflict-engine output and excludes synthetic DEV test traffic.
- SQ0027, SQ0030 and SQ7700 trigger on transition onto the relevant squawk.
- PCH uses the existing live 3 NM / 500 ft aircraft-to-aircraft condition.
- The Netlify relay verifies Firebase Authentication/Admin-or-Operational claims, validates the submitted event, honours each registered device preference, logs sends under `fiso/pushEventLog`, and deduplicates repeated submissions from multiple open sessions.
- Telegram delivery remains disabled.
