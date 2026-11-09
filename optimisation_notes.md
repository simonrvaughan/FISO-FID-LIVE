# FISO FID Release 271 — Optimisation Pass

This build preserves the Release 271 operational feature set while applying a conservative cleanup to the main runtime files.

## Refactored runtime files

- `app.js` — duplicate handlers/functions removed; repeated logic consolidated; Release 271 Intense Aerial Activity fly-in classifier retained.
- `aviationData.js` — static aviation geometry/data preserved; setup and metadata merge logic cleaned.
- `hazdam.js` — Danger Area operational logic preserved; low-risk iteration and merge cleanup only.
- `styles.css` — genuinely duplicate CSS/keyframes removed while preserving later release overrides.
- `index.html` — explicit button types added and build/cache references aligned to Release 271.

## Supporting documentation cleaned

- `NOTAMUPLOAD_INTEGRATION.md`
- `SECURE_LOGIN_DEPLOYMENT.md`
- `SECURITY_PRIVACY_NOTES.md`
- `SUP_AIP_101_2026_EN.html`

## Regression validation

The supplied regression suite was run against the assembled build, including D129, Red Arrows, information-only exercises, D202D, DEACTIVATED handling, D207 precedence, and Release 271 Intense Aerial Activity classification.


Release 314 startup findings:
- The login page previously waited for deferred GeoTIFF, XLSX, Firebase Database, Firebase Messaging and Leaflet before ffapp-auth.js could execute because defer scripts preserve document order.
- All app JS/CSS was explicitly served with Cache-Control: no-store, forcing repeat downloads on every visit.
- handleSignedIn forced a second Firebase token network refresh immediately after authentication.
- Several dynamic loader URLs used filename casing that did not match the ZIP filenames, which is unsafe on case-sensitive Netlify/Linux hosting.
Release 314 removes these bottlenecks while preserving operational logic.
