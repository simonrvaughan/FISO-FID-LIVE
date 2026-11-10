# DEV461 — missing EGD290A/B/C

Status: implemented, locally verified and published to https://dev461--fisofid.netlify.app . No production deployment or shared Firebase writes performed. GitHub branch dev461-fix-egd290 is published.

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

Only a draft preview is authorised. Never use --prod or Publish deploy. Netlify CLI is not yet authenticated. Project dashboard: https://app.netlify.com/projects/fisofid/deploys/6af0c5b8b8227d099f9c3313 . Netlify authorisation completed. Draft deploy 6af234e19be473c4e0d0e152 is ready and published_at is null. The alias is https://dev461--fisofid.netlify.app . Production deployment 6af0ce15c9762e6940a354f9 is unchanged before/after publication. Source files were prepared from the user-supplied deployment ZIP. GitHub branch dev461-fix-egd290 contains the original-source baseline, fixes and tests; write access was restored and the branch was pushed successfully.

Preview-only safeguards: on fisofid draft Netlify hostnames, app AUTO PLOT uses local storage without opening the shared Firebase database, HAZPLOT push sending is suppressed, and account-management callables/sign-in logging are blocked. Firebase authentication itself remains in place. Production hostnames retain their original behaviour.

## Follow-up: D4412/26 and D4413/26 — Marham

Root cause: EGD220A/B were absent from the built-in dangerAreas collection and ENR metadata. Both NOTAMs are correctly ingested and classified as permanent Danger Area activations, but autoPibDangerAreaPayloads intentionally skips an activation when no permanent architecture matches. These are not TDAs and need no fabricated NOTAM polygon or Q-line fallback.

Source: UK AIP ENR 5.1 effective 29 October 2026, https://www.aurora.nats.co.uk/htmlAIP/Publications/2026-10-29-AIRAC/html/eAIP/EG-ENR-5.1-en-GB.html . The two source table rows are retained in tests/fixtures/marham-aip.html. Both areas are a 5 NM circle centred at 523854N 0003302E. A: SFC–FL105; B: FL105–FL195. Both are activated by NOTAM, not H24. Native HAZDAM circle properties preserve the published centre/radius; 360 WGS84 vertices also provide geometry for existing conflict calculations.

The screenshot NOTAMs have B=2611101030 and C=2611101900, with D absent. Tests verify inactive before the 15-minute warning, pending at 10:15, active from 10:30, inactive at 19:00 UTC. The existing B/C fallback required no change. Shared-footprint styling now uses the most active vertical band, preventing a B-only activation from appearing inactive because A owns the common outline. Independent labels, levels, activations and selection remain intact. Versioned aviationdata/hazdam/auth URLs invalidate the old immutable cached assets.

Verification: npm test passes all ten test groups. Actual browser AUTO PLOT attaches D4412/26 and D4413/26 to the two programmed areas, draws one shared 9260 m circle with two independent labels, marks it active at 11:00, and inactive at 19:00 UTC. A B-only activation retains an active footprint. Prior TDA polygon/timing checks also pass. No external data writes or production deployment were performed during testing.

## Chart labels and stalks for eight requested areas

D290A, D290B, D290C and D388 now use chart-style identifier/upper/lower/time labels with stalks anchored on their respective published boundary vertices, replacing the numbered TDA pin appearance. Labels are fanned out for stacked Holbeach areas. Clicks retain existing NOTAM popups; clicking a tessellated arc no longer creates hundreds of vertex annotations. Underlying hazard records, geometry, conflict calculations and published activation periods are unchanged.

The existing HAZDAM stalks/labels for D324A/B and D220A/B retain their normal positions and styling, with UTC activation dates/times added. Each vertical band retains its own label and levels. Timing follows the selected operational date and controlling NOTAM activation record, including successive Waddington day/evening NOTAMs. D388 honours its recurring D) schedule instead of displaying the full B/C envelope as continuous activity. Unknown schedules say CHECK NOTAM; future/expired windows are identified as NEXT/ENDED. No activation record shows BY NOTAM rather than fabricated times.

Verification: all fourteen unit/integration test groups pass. Actual app/Leaflet browser checks verify eight separate labels, four new TDA stalks, retained permanent-area stalks, time text, independent limits, popup selection, map movement/zoom, mobile layout, and TDA label/stalk hiding at expiry. Changing the clock to 11 November 21:00 updates D324A/B labels to 11 NOV 2000–2300Z. The original Marham B-only activation and expiry checks still pass. All frontend dependencies use new cache versions; no backend/function changes were necessary. Preview only; production remains untouched.

## Label readability revision

The eight requested area labels now form one aligned column to the right/east of visible geometry. Stacked A/B/C bands stay together in order; leaders attach to published boundary points and end at the label's left edge. Positions are recomputed in screen coordinates after pan, zoom or resize, with viewport clamping when the area extends beyond the screen. Off-screen area labels are hidden. Geometry and activation logic are untouched.

Larger text, dark backing and brighter stalks improve contrast. Mobile labels combine upper/lower limits on one line and reserve space above/below the column for map controls. Fifteen tests pass, including layout grouping/spacing and viewport limits; browser checks verify one column, non-overlapping desktop labels, mobile layout, popup clicks, changed dates and expiry.

## D203-style presentation revision

Removed dark label backgrounds, borders and padding. The eight labels now inherit the normal danger-area chart font sizes and white halo, use thinner red lettering (weight 500), and retain their levels and activation times in red. Stalks use the original subtle danger-area line style. Column width is reduced to 108 px and row spacing to 44 px; stacked-band order and pan/zoom layout are preserved. Fifteen tests and the desktop/mobile browser checks pass. Preview-only deployment; production unchanged.

## Ten-second selection feedback

Clicking a TDA polygon/label or selecting a programmed Danger Area now adds a gentle two-second pulse to a separate unfilled outline for ten seconds. Selecting another area removes the old pulse immediately and starts a fresh ten-second timer. It uses the monotonic display clock rather than the editable operational UTC clock. The outline is runtime-only and cannot change operational activation state, warning animations, stored geometry, labels or shared data. Redraws preserve the original expiry; hidden/expired TDAs lose the outline immediately.

Nineteen tests pass, covering exact expiry, switching selections, redraws, hidden geometry and unchanged operational values. Browser checks exercise an actual TDA label click, a shared-band Marham label click, native redraw, CSS animation/fill, and automatic outline removal after ten seconds. Existing geometry, labels, date switching, activation and expiry checks still pass. Preview only; production unchanged.
