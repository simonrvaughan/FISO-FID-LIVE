# FFApp Source Protection and Privacy Notes

## Scope

This document records the practical source-protection measures added to the FFApp static Netlify deployment.

These controls reduce accidental exposure, indexing, stale caching and basic client-side disclosure. They do **not** make browser-delivered source code confidential.

## Implemented protections

The release includes the following measures:

- Proprietary licence notice.
- `robots.txt` rules blocking crawling and indexing.
- Netlify response headers that block indexing, framing and MIME sniffing.
- `no-store` caching for application HTML, JavaScript and CSS to reduce stale-release problems.
- Removal of the previous raw admin password from `app.js`; the client-side check was changed to use a SHA-256 hash.
- Browser-console/legal deterrent warning.

## Security limitation of a static web application

A static web application must deliver its HTML, CSS and JavaScript to the user's browser. A determined visitor can therefore inspect client-side code and assets regardless of the protections above.

The measures in this document should be treated as practical deterrence and exposure reduction, not as a secure boundary for proprietary or privileged application logic.

## Logic that requires server-side protection

To properly protect sensitive or proprietary application behaviour, move the relevant logic behind authenticated server-side services such as Netlify Functions, Firebase Functions or other server-side APIs.

The original release notes specifically identify the following as candidates for server-side protection:

- Alert logic.
- NOTAM parsing.
- Datasets.
- Telegram logic.
- Admin functions.

Authentication should be required before protected server-side functionality is made available.

## Release 117 note

Release 117 made no changes to the security model.

Its changes were limited to hazard edit/save state and optional-time handling.

## Release 276 security model
- No Operator/Admin password or password hash is embedded in the browser code.
- Firebase Authentication verifies users before the operational JavaScript is loaded.
- Firebase custom claims determine Admin vs Operational role.
- Realtime Database rules are deny-by-default and are included as `database.rules.json`.
- Operational shared reads require authentication; operational shared writes require the `Admin` claim.
- Firebase Admin SDK activity in Cloud Functions bypasses browser rules as intended.
- The Firebase web configuration is public project-identification data; it is not used as an authorization secret.
