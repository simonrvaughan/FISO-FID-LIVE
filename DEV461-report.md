# DEV461 — missing EGD290A/B/C

Status: implemented, locally verified and published to https://dev461--fisofid.netlify.app . No production deployment or shared Firebase writes performed. GitHub push was attempted through Git and the connector; both were rejected with HTTP 403 (Resource not accessible by integration).

## Root cause

The TDA classifier calls autoPibGlidingCoords, whose whole-second-only regex cannot read the decimal-second coordinates in J3978/26, J3979/26 and J3980/26. It falls back to the rounded Q-line centre, with no polygon. Existing hideRadius policy suppresses the coarse radius. The general coordinate-list parser also does not interpret arc construction instructions: on whole-second arc definitions it connects the centre as a polygon vertex.

Ingestion is not the cause in the supplied version: the live NATS XML and prepared snapshot builder retain all three IDs, decimal coordinate text, B/C and F/G. D is absent. The supplied notam-schedule.js already implements DEV469's continuous B/C fallback, which is retained and regression-tested. These NOTAMs are future-dated on 9 November; they become active on 10 November 08:30 UTC and expire at 17:00 UTC. Existing 30-minute warning behaviour is preserved.

## Implementation

A TDA-specific ordered geometry parser supports decimal or integer seconds, published straight lines, latitude segments, clockwise and anticlockwise circular arcs. GeographicLib 2.2.0 provides WGS84 direct/inverse geodesics (MIT licence included). Arc centres are construction data, not polygon vertices. Published endpoints are preserved; circular segments use the specified radii, with tessellation chord error below one metre apart from source endpoint/radius rounding. Unsupported arcs fail rather than silently becoming straight polygons. Boundary parsing no longer inherits the unrelated route parser's 80-coordinate cap.

The classifier feeds the generated points to the unchanged map renderer. A/B are separate NOTAM records sharing horizontal geometry; C is independent. Levels: A 7000FT AMSL–FL195; B 2300FT AMSL–7000FT AMSL; C SFC–2300FT AMSL. Existing red styling, pin architecture, filters, time evaluator and hideRadius policy remain unchanged. Versioned startup URLs ensure cached clients fetch the new scripts. Existing Netlify and Firebase function source/configuration remain byte-for-byte unchanged.

## Verification

- npm test: eight focused test groups passed. Covers published text ingestion, three independent records and vertical limits, decimal seconds and validation, published arc endpoints and radii/directions (including A/B's 285-degree clockwise sweep), absent-D timing boundaries including exclusion at C, authoritative D schedules, unsupported schedules, ordinary circles, permanent-area exclusion, existing D098/trigger suppression and unsupported arcs.
- Browser regression: actual app.js, workspace HTML, Leaflet renderer and normal AUTO PLOT path, with external requests blocked and Firebase absent. No JavaScript page errors. Four TDA candidates produced. All three EGD290 polygons visible at 10 November 10:00 UTC; all invisible at C. Desktop 1440x1000 and mobile 390x844 screenshots captured locally. The chart tile layer was deliberately offline; live sign-in/traffic integration was not exercised.
- Live NATS feed fetched 9 November 2026: 1052 unique NOTAMs, 68 with TDA wording, 20 bounded TDA definitions, zero geometry parsing failures. Four arc-bearing TDAs: J3954/26 plus the three reported NOTAMs. J3954/26 (EGD388) has the same old arc-centre-as-vertex defect and is fixed by the shared parser. Audit parsing took approximately 48 ms in the local Node run (not a device performance guarantee).
- Netlify CLI functions:build completed successfully for all 15 supplied Netlify functions. Static frontend has no compilation step. Runtime here: Node 24; deployed package requests Node 20. Original referenced historical test scripts were not in the uploaded deployment and therefore cannot be run.
- All 87 original files retained; only app.js, ffapp-auth.js and index.html changed. Added TDA geometry module, GeographicLib vendor files/licence and focused tests/source fixtures.

## Publication

Only a draft preview is authorised. Never use --prod or Publish deploy. Netlify CLI is not yet authenticated. Project dashboard: https://app.netlify.com/projects/fisofid/deploys/6af0c5b8b8227d099f9c3313 . Netlify authorisation completed. Draft deploy 6af234e19be473c4e0d0e152 is ready and published_at is null. The alias is https://dev461--fisofid.netlify.app . Production deployment 6af0ce15c9762e6940a354f9 is unchanged before/after publication. Source files were prepared from the user-supplied deployment ZIP. GitHub local branch dev461-fix-egd290 contains an original-source baseline and the fix/test commit; remote writes require GitHub integration contents-write access.

Preview-only safeguards: on fisofid draft Netlify hostnames, app AUTO PLOT uses local storage without opening the shared Firebase database, HAZPLOT push sending is suppressed, and account-management callables/sign-in logging are blocked. Firebase authentication itself remains in place. Production hostnames retain their original behaviour.
