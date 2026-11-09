## DEV448 — Lightweight startup, prepared PIB cache and aircraft archive viewer

- Split the initial sign-in shell from deferred operational markup/styles, bind local form controls before auth SDK readiness, retain unchanged cached asset versions and share concurrent workspace loads. Expose the usable map while NOTAM validation continues in the background.
- Generate a server-prepared PIB snapshot using the same NOTAM engine in the existing Netlify fallback scheduler. Add bounded alternating slots, read-only ETag cache delivery, optional asynchronous device caching and exact-source checks to avoid redundant XML parsing. Keep stale-data warnings and existing XML fallback; never republish bootstrap data to Firebase.
- Add a source-labelled readsb archive importer with local position storage, aircraft/day selection, a separate trail overlay and rewind slider. Preserve sample timestamps/coordinates, break trails at gaps and keep archives out of live traffic/hazard state. No dummy positions or automatic merged-feed retention.
- Add loading/auth/viewer, snapshot/cache and aircraft archive regressions. Existing DEV447 cancellation/history checks remain intact.
- Three-second iPad display and genuine archive replay remain unverified. See `docs/DEV448-REPORT.md`, integration notes and offline measurements. Nothing was deployed or pushed; DEV446 and DEV447 are preserved.

## DEV447 — Central history evidence checks, mobile work reduction and diagnostics

- Integration preparation follow-up: add a DEV446 source-only collection runbook, exact required code/interface roles, fixture-only iPad checklist and version-gated Node 20 test runner. Node 20 execution remains blocked by missing runtime and download DNS failure; no production source/data was accessed.

- Read central daily history for both the main indicator and history viewer; remove browser-local daily snapshot persistence. Keep acknowledgement local only.
- Distinguish verified NOTAMC pairs, unresolved cancellation evidence and plain feed removals. Show both cancellation/original references and preserve source text. Replacement references alone cannot establish cancellation.
- Apply the 00:01 UTC window, suppress repeated snapshots and duplicate original-removal cards, report incomplete/delayed coverage, retain the last successful history display on errors, and paginate cards in batches of 100.
- Skip hidden history polling and known constrained-connection asset warming; yield between secondary modules; avoid unchanged-PIB serialisation; refresh all operational asset versions to DEV447.
- Add read-only cache-health assessment and a bounded NATS diagnostic with structured public errors. Keep request deadlines active through body consumption and preserve last successful feed timestamps on failure.
- Add 31 offline regression tests and a local JSON verification CLI. See `docs/DEV447-REPORT.md` for results and limits.
- DEV446 Mac mini source is unavailable locally. Backend history/cancellation/health integration is documented in `docs/DEV447-INTEGRATION.md`; no backend writer, deployment or production service was changed.

## DEV432 — NOTAM search five descending black target rings

- Replaced the DEV431 amber pulsing cue with five sequential black circles.
- The circles start large and reduce in size once per second, with the fifth/smallest circle centred exactly on the searched NOTAM location.
- No tab, label or popup is added to the map. The cue clears automatically after approximately five seconds.
- Existing NOTAM search, ticker highlighting and automatic map centring are preserved.
- Updated scheduled PIB log label to DEV432 for build traceability.


## DEV431 — NOTAM search map centring and 5-second location cue
- Exact NOTAM ticker searches now centre the Leaflet map on the corresponding AUTO-PLOT/published NOTAM location.
- AUTO-PLOT geometry is preferred; polygon NOTAMs use the centre of their plotted geometry. If no plot record exists, the published E-field coordinate or Q-line centre is used.
- A gentle amber map ring pulses for five seconds and then removes itself automatically. It does not alter the NOTAM or create a persistent map object.
- Background ticker refreshes do not move the map; only a deliberate search does.
- Updated scheduled PIB success/error log label to DEV431 for build traceability.
# DEV 430 – PIB Freshness & Fail-Safe

- Parses PIB `<Issued>` and `<ValidTo>` timestamps on every scheduled server retrieval.
- Server status records whether the upstream PIB is stale even when the HTTP retrieval succeeds.
- `pib-cache` exposes PIB issued/valid-to/stale metadata in response headers.
- FISO FID distinguishes a successful server check from a current PIB.
- Green `NATS LIVE PIB` is only shown while the PIB is within its stated validity.
- Expired PIB changes to red `NATS PIB STALE`, displays issued/valid-to/server-check times, and retains the last valid plot/reference while checks continue.
- Existing direct PIB endpoint remains the fallback if the server-cache endpoint is unavailable.

## DEV428 — 24/7 server-side AUTO PIB refresh
- Added a Netlify Scheduled Function running every 15 minutes (`*/15 * * * *`, UTC), independent of logged-in users.
- Server fetches the NATS contingency/live PIB, validates it, hashes it, records NOTAM IDs and persists the latest successful PIB in Netlify Blobs.
- Added `/api/pib-cache` so clients load the server-cached PIB first, with the existing direct `/api/pib` proxy retained as an automatic fallback.
- Server status records last attempt, last successful update, NATS last-modified value, NOTAM count, hash, change state and next scheduled check.
- Added server-side added/removed NOTAM comparison metadata.
- Client AUTO PIB parsing/plotting remains unchanged after retrieval, preserving existing operational plotting logic.

## DEV427
- Replotted EG D012 Lyme Bay North so its northern boundary follows the coastline between 504106N 0030544W and 504220N 0024500W, rather than drawing a straight chord offshore.

## DEV426
- Startup loading screen now remains visible until operational loading is complete and the UTC clock has started ticking.
- Added clearer loading-stage information for slower iPad starts.

## DEV399 — Reporting points legibility
- Changed FISOFID LOW and FISOFID HIGH reporting/significant-point symbols to solid black.
- Increased symbol definition slightly while keeping the points compact in dense areas.
- Changed reporting-point names to heavier black text with a crisp white halo for readability over both land and sea.
- Applied the same black, better-defined treatment to the standard-map reporting-point reference layer for visual consistency.


## DEV398 — FISOFID LOW/HIGH map control + thinner chart linework
- Added **FISOFID Low** and **FISOFID High** to the compact on-map **LAYERS → BASE MAP** selector, mirroring the INFO-panel selector.
- Reduced FISOFID LOW/HIGH chart line weights for a cleaner SkyVector-reference visual density.
- Added SkyVector-reference arrowhead rendering infrastructure for airway/route geometry **only when explicit direction metadata is present**; controlled-airspace boundary lines are never assigned invented direction.
- Preserved operational overlays and brightness behaviour unchanged.

# DEV 396 — Sync operator-unchecked NOTAM ticker choices

- Imported every NOTAM marked `NOTAM TICKER: NO` with the operator-selectable `Click to change YES / NO` control from `FISOFID AutoPlot PIB(3).pdf`.
- 79 operator-unchecked NOTAM IDs from the attachment are now excluded from the bottom ticker by default.
- Existing fixed filters for CRANE and ordinary NOTAMs at or below 800FT remain unchanged.
- AUTO-PLOTTED NOTAMs remain eligible for the ticker even at or below 800FT, per DEV395.
- Auto plotting/map display is unaffected by these ticker exclusions.

# DEV 395 — Auto-plotted low-level NOTAMs included in ticker

- Changed the NOTAM ticker filter so an **AUTO-PLOTTED** NOTAM is included even when its upper limit is **800FT AMSL or lower**.
- This specifically covers auto-plotted TDAs such as **EGD098F**, **EGD098H** and **EGD492** shown in the AutoPlot PIB.
- The normal **800FT OR LOWER** exclusion remains in force for non-auto-plotted NOTAMs.
- Existing **CRANE** and **D323** exclusions remain unchanged.
- AutoPlot PIB will now show these qualifying low-level auto-plotted NOTAMs as **NOTAM TICKER: YES** rather than a fixed 800FT exclusion.

# DEV393

- Reduced airfield-map clutter: the dense current/legacy reference airfield dots are now hidden below zoom level 9.
- Reference airfield dots appear from zoom 9.
- Reference airfield names remain hidden until zoom 11.
- The existing Airfields layer on/off control continues to override the zoom behaviour.

# DEV 388 — server-side what3words lookup

- Removed the browser API-key prompt completely.
- Removed use of localStorage/window API keys for what3words.
- what3words lookups now go through a Netlify Function so the API key can remain in the Netlify environment as `WHAT3WORDS_API_KEY`.
- Three-word entry and automatic crosshair/map centring are retained from DEV 387.
- DMS validation and compact map controls are unchanged.

# DEV 387 — constrained DMS + what3words snap

- Latitude/longitude entry remains in DMS and keeps the DEV386 formatting.
- Minutes are constrained to 00–59 and seconds to 00.0–59.9; latitude/longitude degree limits are also enforced.
- Valid DMS edits now move the map immediately, so the fixed centre crosshair follows the newly entered coordinate without requiring a separate confirmation.
- what3words entry is now three separate word fields with fixed dot separators; Tab moves naturally from word 1 to word 2 to word 3.
- Completing all three words resolves the address and centres the map/crosshair on that what3words position. This uses the official what3words convert-to-coordinates API and stores the user-provided API key locally in the browser.

# DEV 386 — DMS position entry

- Centre LAT/LONG display now uses Degrees, Minutes, Seconds (DMS), not DDM.
- Kept the existing compact W3W / coordinate / Layers formatting.
- Clicking the coordinate readout opens a compact DMS position-entry panel with hemisphere, degrees, minutes and seconds fields; the ° ′ ″ units are fixed in the UI and the map centres on the entered position.
- Clicking `/// W3W` opens the same compact position panel in WHAT3WORDS mode. Typed spaces, slashes and punctuation are normalised automatically to `word.word.word`; the address opens in what3words in a new tab.
- Added a FORMAT dropdown to switch between DMS and WHAT3WORDS entry without adding permanent map clutter.

# DEV 385 — Compact Centre Reference

- Reduced the fixed map-centre crosshair to approximately half its DEV384 size.
- Moved the live centre LAT/LONG readout away from the crosshair and immediately to the left of the LAYERS button.
- Added a compact `/// W3W` control immediately to the left of LAT/LONG. Clicking it opens the current map-centre coordinate in what3words.
- Kept LAYERS and TIME behaviour unchanged.

# DEV 384

- Removed the DEV383 Route / Track Check by building forward from DEV382.
- Added a fixed, SkyVector-style crosshair at the exact centre of the map.
- Added a deliberately small, semi-transparent latitude/longitude readout immediately below the crosshair.
- Centre coordinates update continuously as the map is panned or zoomed.
- Crosshair/readout are non-interactive so they do not interfere with map clicks, double-click What's Here, aircraft, R&B, Layers or Time controls.

# DEV 382

- Removed the intrusive on-map Map-at-Time slider completely.
- Added a small **TIME** button directly beneath the compact **LAYERS** control.
- TIME opens a compact popup for selecting UTC date, hour and minute, with APPLY and RETURN TO LIVE controls.
- Selected time drives operational NOTAM and Danger Area activation logic.
- ADS-B can follow the selected time only when that position history has been recorded locally since the current browser tab/session began; arbitrary historical or future ADS-B remains live.
- Returning to LIVE restores current UTC and live aircraft.

# DEV 381

- Reworked Map-at-Time into a small unobtrusive control at the lower-right of the map.
- Reduced preview window to 15 minutes back and 5 minutes forward.
- Slider now uses 1-minute steps, with small − / + controls and a NOW reset button.
- Removed the large scale and explanatory text from the map display.
- ADS-B aircraft remain live; only timed operational overlays follow the selected map time.

# DEV 380

- Added a compact **Map-at-Time** slider above the NOTAM ticker.
- Range: **6 hours back to 12 hours ahead**, in 15-minute steps.
- Timed operational overlays use the selected UTC time, including HAZDAM/Danger Area and AARA/NOTAM activation logic.
- ADS-B aircraft remain live at all times.
- Non-live preview mode is highlighted amber and clearly labelled **TIME PREVIEW**.
- One-click **LIVE** button returns all operational layers to the current UTC picture.
- NOTAM ticker refreshes when the selected operational time changes.

# DEV 379 — What’s Here? map interrogation

- Double-click any map position to open a compact WHAT’S HERE? panel.
- Shows editable LAT/LONG and decimal coordinates.
- Shows nearest UK FIR waypoint/reporting point and distance.
- Shows nearest loaded airfield and distance.
- Identifies active/soon plotted hazards whose polygon/radius covers the selected point.
- Identifies active/forthcoming plotted NOTAM circles affecting the selected point.
- Keeps direct R&B and Centre-map actions.
- Preserves double-click-without-zoom behaviour.
- Retains all DEV378 layers, brightness and operational plotting functionality.

# DEV 378

- Added compact on-map **LAYERS** control.
- Quick switches for Aircraft, data blocks, range rings, hazard pins, NOTAM pins, airfields, UK FIR waypoints, vectors, rain radar, cloud and Danger Areas.
- Base-map selector for Standard/eVFR chart.
- Moved map brightness into LAYERS (35–140%; double-click slider resets to 100%).
- Existing INFO > Layers controls remain available and are mirrored rather than duplicated.
- Operational overlays remain full brightness.

# DEV 377

- Added a compact **MAP brightness** slider directly on the map.
- Range: **35% to 140%**, default **100%**; double-click the slider to reset to 100%.
- Brightness affects the basemap/eVFR imagery only, leaving aircraft, NOTAMs, Danger Areas, labels and operational overlays at full visibility.
- Brightness setting is remembered locally between sessions.
- Retains DEV376 basemap resilience and all previous operational functionality.

# DEV 376 — 13 Sep 2026

- Replaced the DEV 375 CARTO Voyager standard basemap with **Esri World Street Map** to remove the visible `API KEY REQUIRED` watermark.
- Continues to avoid direct use of the public `tile.openstreetmap.org` raster servers, preventing the large OSM `403 Access blocked` panels seen previously.
- Retains a transparent failed-tile fallback so base-map provider errors cannot cover NOTAMs, aircraft, HAZDAMs, Danger Areas, R&B or other operational overlays.
- No operational plotting logic changed from DEV 375.

# DEV 375 — resilient standard basemap / OSM 403 fix

- Removed direct use of the public `*.tile.openstreetmap.org` raster tile servers for the Standard map.
- Standard map now uses CARTO Voyager raster tiles (with OpenStreetMap data attribution), avoiding the OSM 403 Access blocked panels seen in the published app.
- Added a transparent failed-tile fallback so an upstream tile error cannot obscure aircraft, NOTAM, hazard, R&B or airspace overlays.
- Bumped application/cache version to 375.
- No operational plotting, NOTAM, HAZDAM, aircraft, R&B or chart-import logic changed.

# DEV 374 — H5891/26 Celtic Sea live firing

- Added NOTAM H5891/26 (PIB page 24) as a HAZDAM Danger Area polygon.
- Limits: SFC–FL300. Valid 13 Sep 2026 0700 UTC to 15 Sep 2026 1900 UTC, active daily 0700–1900 UTC.
- Uses standard HAZDAM pending/active styling and aircraft conflict behaviour.
- Popup/source data includes cease-fire frequency 121.500 MHz, HMS QUEEN ELIZABETH callsign, contact 02392 726867 and AR-2026-8468/01.

# DEV 373 — compact draggable R&B + editable LAT/LONG

- Range & Bearing popup reduced substantially in size.
- R&B opens at the top-left of the map and can be dragged by its title bar.
- LAT/LONG popup fields are now editable; click either value and overtype with a waypoint, full position, or single coordinate.
- Double-click coordinate popup continues to keep the current map zoom unchanged.

## DEV372 — Range & Bearing popup + fixed double-click zoom
- Double-clicking the map opens the LAT/LONG readout without changing the current map zoom.
- Added a **Range & Bearing** link directly to the LAT/LONG popup.
- The floating R&B window opens over the map with a cyan line centred across the current map midpoint.
- Start or End can be set by typing a UK reporting point / waypoint or a position (decimal degrees or common aviation DMS formats).
- With the R&B window open, focus Start or End and click an aircraft to snap that end of the line to the live aircraft; the endpoint continues to follow the aircraft as its position updates.
- Added Start/End aircraft-hook buttons, Centre Line, Clear Line, live range in NM and true bearing readout.
- Bumped application/cache assets to build 372.

## Dev 371 — 12 Sep 2026
- Coordinate LAT/LONG popup now opens on double-click instead of single-click.
- Single map clicks no longer open the coordinate popup.

- 11 Sep 2026: Updated the bottom NOTAM ticker manual exclusion trigger to match the operator-unchecked NOTAMs in the supplied AutoPlot PIB (34 manual exclusions). Existing CRANE and 800FT-or-lower filters remain unchanged.
## DEV368 — NOTAM ticker popup X-only close
- Hovering a NOTAM code now immediately pins the full PIB NOTAM popup open.
- Moving the pointer away, clicking elsewhere, dragging the ticker, and focus changes no longer close the popup.
- The popup closes only when the user presses the small × button in its top-right corner.
- iPad tap behaviour remains supported.

# DEV367

- NOTAM ticker popup now remains pinned until the user presses the popup close ×.
- Clicking elsewhere on the app no longer closes a pinned NOTAM popup.
- Added direct pointer-up pinning so Safari/iPadOS clicks are reliable even when ticker drag handling uses pointer capture.
- Dragging the ticker no longer hides an already pinned popup.


## DEV366 — pinned NOTAM ticker popup
- Hover over a ticker NOTAM code still previews the full PIB NOTAM.
- Click/tap the NOTAM code to pin the popup open.
- Pinned popup remains until clicking elsewhere or pressing the X in the top-right.
- Pinned popup stays interactive on desktop and iPad/touch devices.
- Build/cache version advanced to 366.


## DEV365 — iPad NOTAM ticker fix
- Forces the NOTAM ticker visible on iPad/tablet layouts using fixed viewport positioning.
- Keeps the ticker above the mobile bottom navigation and iOS safe-area inset.
- Preserves touch drag/scrub interaction.
- Adds tap-on-NOTAM-code full PIB popup for touch devices, where hover is unavailable.
- Cache-busts app/style/auth assets to v365.
## DEV361 — AutoPlot PIB NOTAM Ticker YES/NO controls
- Open AutoPlot PIB now shows a clear **NOTAM TICKER: YES / NO** status on every NOTAM.
- Eligible NOTAMs default to **YES**. Click the checkbox to change an individual NOTAM to **NO** without removing it from the PIB or map.
- Ticker NO choices are saved in the browser and persist across reloads/PIB uploads until changed or reset.
- Added **Reset ticker choices to YES** to the AutoPlot PIB toolbar.
- Existing fixed ticker filters remain enforced: CRANE/LIT CRANE, 800 ft and below, and D323 display as NO with the filter reason.
- AutoPlot PIB header now shows counts for TICKER YES and TICKER NO.

## DEV360 — EGD213 Kineton AUTO-PLOT fix
- Added the permanent **EGD213 KINETON** ENR 5.1 Danger Area architecture so explicit PIB activations such as **D3373/26** can be matched by the standard HAZDAM AUTO-PLOT path.
- Uses the published ENR boundary: **700 m radius centred on 520902N 0012656W**, SFC to 2400 FT ALT.
- The NOTAM Q-line 20 NM value is not used as the danger-area boundary; it remains only Q-line filtering information.
- EGD213 remains inactive unless supported by its NOTAM activation, and future same-day activations stay attached to the area until their B/C window becomes active.

## DEV359 — NOTAM ticker filtering
- Excludes any NOTAM containing **CRANE** or **LIT CRANE**.
- Excludes NOTAMs with a published upper limit of **800 ft or lower**.
- Excludes **D323 / EGD323** NOTAMs.
- Shows all other current PIB NOTAMs, including **AUTO-PLOT** NOTAMs.
- Retains manual per-NOTAM ticker exclusions and PIB page-number suffixes.

# DEV358 — NOTAM ticker: all PIB NOTAMs + source page

- Every NOTAM in the ACTIVE PIB is now included in the bottom ticker by default, regardless of height or AUTO-PLOT status.
- The operator-maintained manual exclusion list remains the only ticker suppression mechanism, so individual superfluous NOTAMs can be removed on request without deleting them from the PIB or map.
- Each ticker item now ends with its source PIB page where available, shown as `PAGE n`.
- Retains the thick `|` separator, local DEV preview login, and all prior functionality.

## DEV358 — Restore downloaded local DEV preview

- Restores the pre-publish workflow where the downloaded `index.html` can be opened directly from Finder/Safari using `file://`.
- When opened locally, user 001 can enter the login screen and open a full local DEV preview without waiting for Firebase Authentication.
- The bypass is strictly limited to `file://`; published `https://` builds continue to use the secure Firebase login and the DEV354 legacy account compatibility.
- Retains DEV356 NOTAM ticker separators and DEV355 ticker timing/filter logic.

## DEV356 — NOTAM ticker separator
- Replaced the dot separator between ticker NOTAMs with a thick vertical bar (`|`) so the end of one NOTAM and start of the next are clearer.

# Dev355 — Full NOTAM ticker + AUTO-PLOT 60-minute timing

- The bottom ticker now includes every NOTAM in the current PIB except NOTAMs whose published upper limit is 800 ft or lower.
- AUTO-PLOT NOTAMs are treated differently: they enter the ticker 60 minutes before activation, remain throughout the active period, and are removed as soon as that activation window ends.
- Recurring D) schedules are handled per activation window, so AUTO-PLOT NOTAMs do not remain on the ticker during inactive gaps.
- Airport and LARS closure items remain priority items at the front of the ticker.
- Added a dedicated `NOTAM_TICKER_MANUAL_EXCLUSIONS` list so individual superfluous NOTAM IDs can be removed from the ticker on request without removing them from the PIB or map.
- The existing readability speed cap is retained.

# Dev354

- Fixed secure-login compatibility for original Firebase users created under the legacy hidden `@fisofid.local` alias.
- Login now tries the current `@fisofid.internal` account first and, only for an invalid-credential response, automatically retries the legacy alias.
- Updated the bootstrap user script so all newly provisioned users consistently use `@fisofid.internal`.
- Advanced the authentication asset version to 354 so the published site cannot reuse the previous login script.


## Dev346 — NOTAM ticker readability speed cap
- Replaced the fixed 34-second ticker loop with a distance-based duration.
- Ticker movement is now capped at approximately 55 px/sec on desktop and 45 px/sec on smaller screens.
- Longer NOTAM lists now take longer to complete a loop instead of scrolling faster.
- Airport/LARS permanent closure logic and the 15-minute-to-end behaviour for all other NOTAMs are unchanged.

# Release 345 — Full NOTAM ticker with 15-minute look-ahead

- Airport and LARS closure NOTAMs remain the permanent priority ticker feature.
- Every other NOTAM now appears from 15 minutes before its next active period until that active period ends.
- Recurring D) schedules appear only during the 15-minute lead-in and the actual active window, not in inactive gaps.
- Airport/LARS closure items are always placed before general NOTAM ticker items.
- General NOTAM text is shortened in the ticker for readability; the full NOTAM remains available in the normal PIB views.

## Dev344 — 15-minute advance closure ticker
- Airport and LARS closure NOTAMs now enter the bottom ticker up to 15 minutes before they become active.
- Upcoming closures are labelled `CLOSURE SOON` and show `ACTIVE IN X MINS`.
- Both B) start times and recurring D) schedules are honoured; D) windows are checked minute-by-minute across the 15-minute look-ahead so short activity periods are not missed.
- Active closures continue to display exactly as before.


## Dev343 — NOTAM airport/LARS closure ticker
- Added a persistent scrolling ticker at the bottom of the map.
- Reads the active PIB and shows only currently active whole-aerodrome and LARS closures.
- Honours NOTAM B)/C) validity and interpretable D) recurring UTC schedules.
- Excludes ordinary runway/taxiway/apron closures from the airport-closed headline.
- Refreshes on PIB changes and every 30 seconds, including the app test-time clock.
# Dev353

- Fixes published-login regression introduced by Dev352.
- Controlled-airspace vector dataset is no longer on the authentication/core startup path.
- Core map now opens first; CAS vectors load as a deferred module after first paint.
- If the user is already at CAS zoom level, the overlay renders automatically when the deferred dataset becomes available.
- Keeps the crisp vector controlled-airspace display from Dev352.

# Dev352

- Replaced the controlled-airspace raster image overlay with true Leaflet vector lines and HTML text labels.
- Controlled-airspace boundaries and associated levels remain sharp when zoomed; no raster blur.
- CAS lines are thinner and muted; labels are 7px Arial and deliberately unobtrusive.
- CAS still appears at zoom 8, matching reporting-point label visibility.
- Removed the large CAS PNG from the build and kept the login-recovery changes from Dev351.


## Dev348 — Latitude labels on both chart edges
- Latitude values now display on both the west and east sides of the map.
- Latitude labels use the same small font/size treatment as longitude labels.
- Labels are anchored inward and raised above map layers so they remain visible without becoming intrusive.
# Dev343

- Added a compact map coordinate popup on left-click.
- Shows clicked LAT and LONG in aviation-style degrees/minutes/seconds plus decimal degrees.
- Popup text is deliberately small so it does not obscure the chart.

# DEV344

- Restored ADMIN navigation for PARA SITES and DANGER AREAS.
- Removed obsolete DEV340 redirect that forced those submenu selections back to NOTAMs.
- Advanced build/cache version to 344.

# DEV343

- Fixed VIEW APP startup so Firebase anonymous authentication can no longer hang the Viewer indefinitely.
- Viewer anonymous read-session handshake now times out after 2.2 seconds and continues into read-only mode using existing fallback data paths.
- Added a 15-second operational-app load escape path for Viewer startup.
- Restored PARA SITES and DANGER AREAS workspaces for ADMIN users.
- PARA SITES and DANGER AREAS remain hidden from Viewer/Operator navigation while their underlying operational map data remains available.
- Build/cache version advanced to 343.

## DEV342 — 02 Sep 2026

- Added a guaranteed six-second FISO FID startup/loading screen on first load.
- Added startup guidance: “If no NOTAM pins seen: Go to INFO → NOTAM PLOTTING → Initiate AUTOPLOT”.
- The splash remains visible for the full six seconds even when authentication/app initialisation completes sooner.
- Advanced app/auth/static cache keys to DEV342.

## DEV341 — 02 Sep 2026

- Replaced the separate View Only application behaviour with one unified FISO FID application path.
- `VIEW APP` now enters the normal app using a read-only Viewer role.
- Viewer retains normal map, search, INFO tabs, pins, popups, AUTO PIB and live shared data viewing.
- Editing controls are disabled with both static and dynamic UI guards.
- Firebase anonymous Viewer sessions can read shared operational data but Firebase rules reject operational writes.
- Removed the special Viewer map-width/INFO-tab restrictions from permission application.
- Advanced all bootstrap/cache keys to DEV341.

## DEV340 — 02 Sep 2026

- Removed the user-facing PARA SITES and DANGER AREAS workspaces from the main INFO/navigation UI.
- Retained the underlying parachute-site and danger-area data/DOM for map and operational plotting compatibility.
- View Only INFO now opens on NOTAMs rather than PARA SITES.
- Changed the reference numbers above black MISC pins to black.
- Advanced shared cache/build key to DEV340.

## DEV339 — 02 Sep 2026

- Fixed startup hang at **Checking secure session…** when Firebase saved-session restoration does not resolve.
- Added a 3.5-second authentication bootstrap watchdog which reveals the normal login/View Only screen instead of leaving the startup overlay indefinitely.
- Added a 6.5-second timeout around restored-account token/claims loading. A stale saved session now falls back safely to login rather than blocking the whole app.
- Added explicit **Restoring saved sign-in…** startup status so the operator can see which phase is running.
- Direct `file://` testing now has a deterministic escape path even when browser/Firebase persistence is unavailable.
- Advanced shared cache/build key to DEV339.

# DEV337 — Aerial Filming AUTO PLOT rebuild

- Rebuilt Aerial Filming recognition around the literal AREA BOUNDED BY boundary.
- Recovers NOTAM id/times from raw text when parsed fields are incomplete.
- Adds immediate post-paint hazard visibility refresh for ADMIN test-clock changes.
- Regression-tested L5097/26 at 02 SEP 2026 0845 UTC.

# DEV336

- R2484/26 (AIP SUP 101/26 trigger RA(T), Pin 1) remains plotted for situational awareness but is explicitly excluded from aircraft HAZPLOT/HAZBUF conflict detection.
- Added a defensive live HAZBUF exclusion for R2484/26 / SUP 101 trigger wording so previously stored copies cannot make aircraft flash or show a HAZBUF strip warning.
- The Pin 1 marker and popup are retained; only hazard recognition is removed.
- Build/cache key advanced to 336.

# DEV335

- Fixed the root cause preventing newer Aerial Filming code from appearing after deployment: the bootstrap still requested operational scripts using the old `?v=331` cache key while those files were served as one-year immutable assets.
- `ffapp-auth.js` now owns a single `FFAPP_BUILD_VERSION=335` cache key and applies it to every operational JavaScript asset.
- `index.html` now loads `ffapp-auth.js?v=335`.
- `ffapp-auth.js` is now `no-store`, ensuring each deployment can deliver the current asset manifest while large operational scripts remain safely cacheable behind build-version URLs.
- Retains the rebuilt Aerial Filming parser from DEV334, normal HAZPLOT visibility from 30 minutes before B), temporary light-yellow polygon on pin click, and polygon-entry-only aircraft conflict logic.
- Regression tested with L5097/26 and U7096/26.

# Dev 334 — Aerial Filming parser hardening

- Reconstructs Aerial Filming E-field text from every available PIB representation instead of trusting a possibly partial `eText`.
- Adds a tolerant full-seconds coordinate extractor for published Aerial Filming boundaries.
- Gives Aerial Filming first refusal in the AUTO PIB classifier chain so generic rules cannot consume it.
- Retains normal HAZPLOT timing: pin visible from 30 minutes before B), active through the applicable NOTAM schedule.
- Retains light-yellow click-to-reveal polygon and 5-second persistence after popup close.
- Retains polygon-entry-only aircraft conflict logic (no lateral HAZPLOT buffer).

# DEV 331 — Cold-start map recovery

- Fixed dynamic `app.js` startup code that could miss `DOMContentLoaded` after authentication.
- Added a post-load Leaflet health check before the loading screen is dismissed.
- If the first map initialisation fails, the app performs one automatic recovery reload while retaining the signed-in session.
- Loading screen now reports `Finalising operational map…` during the health check/recovery.
- Retains Dev 330 Aerial Filming auto-plot and Dev 329 consolidated Danger Area activations.

# Dev 329 — consolidated Danger Area activations

- Multiple PIB NOTAMs for the same permanent Danger Area now attach to one map geometry instead of competing/overwriting each other.
- Each NOTAM retains its own B/C/D timing, F/G vertical limits, source page and NOTAM identity.
- HAZDAM resolves the applicable activation against the current operational UTC time and applies that activation's levels to conflict checking.
- Future activations remain attached and automatically become controlling at their published time without replotting the Danger Area.
- Overlapping records are evaluated deterministically; an active deactivation promulgation supersedes an overlapping activation for safety.
- Danger Area popups now include a PIB activation schedule showing all attached current/future/completed promulgations and their individual levels.
- AUTO PIB annotation recognises every NOTAM attached to a consolidated Danger Area, so each original PIB record remains stamped AUTO PLOTTED.
- D324A and D305 dedicated recovery paths now preserve all matching promulgations rather than selecting only the first record.
- Firebase HAZDAM schema bumped to 5 so activation bundles sync as structured records.

# Dev 327 — startup performance

- Removed the artificial 3-second startup delay and forced page reload.
- Added a real progress splash tied to authentication, runtime loading, core script loading and first map paint.
- Reduced first-paint blocking modules from seven operational scripts to three.
- Deferred aviation data, geometry, HAZDAM/conflict and library helpers until after the map has painted.
- Deferred modules still preload in the background and remain fully available.
- Added double-requestAnimationFrame handoff so the browser gets a genuine paint opportunity before secondary initialization.

# Release 326 — 01 Sep 2026

- Rectified View Only AUTO PIB cross-device sync. View Only now signs into Firebase anonymously for read access and consumes the same `fiso/fisoradar_hazards_v1` snapshot as authenticated Operational/Admin users.
- Anonymous View Only remains strictly read-only because Firebase writes still require Admin claims.
- Retained the dedicated public AUTO PIB channel only as a fallback when Anonymous Authentication is unavailable.
- Prevented the auth observer from treating anonymous View Only sessions as normal operational accounts.
- Bumped all operational asset cache versions to 326.

## Release 324

- Fixed regression where broad Q-code `QWY..` caused Pipeline Inspection Notification Procedure System (PINS) NOTAMs to be misclassified as AIR EX.
- PIPELINE INSPECTION / PINS NOTAMs are now explicitly excluded from AUTO PIB AIR EX plotting.
- Removed generic `QWY..` as a standalone AIR EX trigger; genuine aerial survey records still require explicit AERIAL SURVEY wording, while QWF remains valid for air-to-air refuelling.
- Prevents 999NM pipeline NOTAMs such as H5615/26 from creating an AIR EX pin/circle.
- Bumped release/cache marker to 324.

## Release 323

- Fixed authenticated Operational/User sessions losing AUTO PIB NOTAM plots when the dedicated shared AUTO PIB Firebase path is absent or has not yet been seeded.
- The normal authenticated `fisoradar_hazards_v1` AUTO records are now retained as a fallback until a real dedicated AUTO PIB snapshot exists.
- An explicit dedicated snapshot containing `hazards: []` still correctly clears AUTO PIB plots on every device.
- Bumped operational asset cache versions to 323 so mobile Safari and other clients fetch the corrected code immediately after deployment.
- View Only still requires the supplied Firebase Realtime Database rules to be deployed once, because View Only is unauthenticated and reads only the public read-only AUTO PIB path.

## Release 297 — TEMPO CTA polygons / RA(T) radius cleanup

- AUTO PLOT now recognises `TEMPO CTA (CTA n) CLASS D INSTALLED WI AREA BOUNDED BY:` NOTAMs directly from the active PIB.
- The polygon uses the exact full-seconds latitude/longitude boundary points published in E), not the rounded Q-line centre/radius.
- TEMP CTA fill is very light transparent blue (5.5%) with a thin blue outline, and the polygon is kept behind aircraft/TDB symbology.
- TEMP CTA appears/flashes only during the five minutes before B), is steady while active, and disappears at C).
- TEMP CTA is situational-only and excluded from HAZPLOT/HAZBUF aircraft warnings.
- AUTO RA(T) broad dashed radius circles are suppressed; precise multi-point geometry/pin information remains.

# Release 293 — AIR EX hard exclusion from HAZPLOT

- AIR EX / military exercise NOTAM overlays are information-only and can never create HAZPLOT/HAZBUF aircraft alerts.
- Added a defensive exclusion in the canonical HAZBUF gate using `INFO_EXERCISE`, the information-exercise AUTO rule and exercise wording, so even restored/legacy AIR EX records with missing flags remain non-hazardous.
- Existing red click-to-reveal AIR EX polygon display is unchanged.
- Bumped the application cache reference to **293**.

# Release 292 — D005 Predannack + D307 Donna Nook + AIR EX exercise NOTAMs

- Added permanent UK AIP ENR 5.1 architecture for **EGD005A Predannack** (3 NM circle) and **EGD005B Predannack Corridor**, including its published clockwise 3 NM arc.
- Added permanent UK AIP ENR 5.1 architecture for **EGD307 Donna Nook**, including its published clockwise 5 NM arc.
- Added official ENR limits, activity, service/contact, authority, hours and remarks metadata for D005A/B and D307.
- Existing generic PIB Danger Area matching now recognises **EGD005A**, **EGD005B** and **EGD307** by explicit designator and applies B/C/D timing plus F/G notified levels without inventing Q-line geometry.
- Activation and deactivation NOTAMs can therefore update the programmed polygons; D307 deactivation can temporarily supersede its routine ENR hours during the NOTAM window.
- Added short-form military exercise recognition for NOTAM wording such as **“EXER. MIL FIXED-WING AND HEL OPR WI AREA BOUNDED BY …”**.
- These records display as a **red AIR EX pin**. The published polygon is hidden until the pin is selected, then shaded red for information only.
- AIR EX exercise records are explicitly **situational only** and cannot create HAZPLOT/HAZBUF or operational hazard notifications.
- Bumped app and aviation-data cache identifiers to **292**.

# Release 291 — D138 Shoeburyness complex architecture

- Built permanent ENR 5.1 geometry for **EGD138A, EGD138B, EGD138C and EGD138D**.
- Each D138 sub-area is a separate HAZDAM/ENR object so activation and deactivation NOTAMs apply to the correct polygon only.
- Added official limits, DAAIS, Range Control contact, authority, activity and remarks for all four areas.
- Preserved the special ENR relationship for **D138C**, which may be activated as a separate activity at the same time as D138A and/or D138D.
- With the current PIB, **M5744/26** can now associate with the permanent **D138D** architecture instead of having no programmed area to update.
- D138D's published boundary uses the north coast of Foulness Island; the current map polygon follows all published coordinate turning points and closes the coastal section between its published endpoints.
- Bumped app release and aviation-data cache identifiers to **291**.

# Release 290 — Underslung Loads + AARA NOTAM details

- Added AUTO PLOT support for Civil Aircraft Notification Procedure **UNDERSLUNG LOADS** NOTAMs as black **Misc** pins labelled **Underslung Loads**.
- H5406/26 on PIB page 24 is plotted from its published Princetown track, with the single pin centred on the two track points and no artificial Q-line circle.
- Fixed AARA activation matching for compact EAST/WEST suffixes such as **AAR AREA 10W** and **AAR AREA 10E**. H5423/26 now matches **AARA10 WEST** only.
- Every AARA popup now shows matching current/future activation NOTAM details from the uploaded PIB, including NOTAM number, E-field activity text, B/C/D timing data and F/G levels.
- Added **SCHEDULED BY NOTAM** status when an AARA has a matching activation later in the validity period, while retaining the existing 15-minute pre-activation flash.
- Split E-field AAR windows are honoured where D) is absent. For H5423/26, AARA10 WEST is active only **0815-1115 UTC** and **1345-1645 UTC**, not continuously from B) to C).
- Bumped the operational app cache-buster/release identifier to **290**.

# Release 289 — All operational device alerts live

- Retains persistent per-device notification registration from Release 288.
- Live push is now enabled for all seven configured alert categories: **HAZPLOT, HAZDAM, SIM CALLSIGN, 0027, 0030, 7700 and PCH**.
- **HAZDAM**: notifies on a new aircraft/Danger Area conflict generated by the existing HAZDAM engine; synthetic DEV-test conflicts are excluded.
- **0027 / 0030 / 7700**: notifies when an aircraft transitions onto that squawk. A continuous unchanged squawk does not re-trigger in the browser session.
- **PCH**: notifies when a new aircraft pair enters the existing 3 NM lateral / 500 ft vertical PCH condition.
- Existing SIM CALLSIGN and HAZPLOT live relays remain unchanged.
- The secure Netlify relay validates each alert type, honours each device's individual notification preferences and applies server-side duplicate suppression.
- 7700 Web Push is sent with high urgency.
- Telegram remains hard-stopped.

# Release 287 — Live SIM CALLSIGN push notifications

- Connected the live last-two-character SIM CALLSIGN detector to the secure Netlify push relay.
- When a new qualifying similar-callsign pair is detected, FISO FID now automatically sends **FISO FID – SIM CALLSIGN** to registered devices whose SIM CALLSIGN preference is enabled.
- Notification body identifies both callsigns, e.g. `GBILR and GXXLR · similar callsign detected`.
- Preserves the current rule that both aircraft must be on an alert-enabled squawk and within 30 NM.
- Added server-side cross-device deduplication so multiple open FISO FID sessions do not repeatedly notify the same pair; the same pair is suppressed for 10 minutes.
- Netlify verifies the triggering Firebase user has Admin or Operational claims before accepting a live alert event.
- Invalid/expired FCM tokens are automatically removed when encountered.
- Existing TEST SIM CALLSIGN and standard test-notification buttons remain available.
- Live HAZPLOT, HAZDAM, 0027, 0030, 7700 and PCH push generation remain disabled for now; this release enables live SIM CALLSIGN only.
- Telegram remains hard-stopped.

# Release 286 — SIM CALLSIGN annunciator + notification test

- Changed all user-facing **SIM CALL SIGN** wording to **SIM CALLSIGN** (callsign is one word).
- Changed the background behind the map and strip SIM CALLSIGN annunciators to solid black with amber text so the warning stands out clearly.
- Preserved the existing gentle amber flash until the individual aircraft annunciator is acknowledged; acknowledged warnings remain steady amber while the match persists.
- Added **TEST SIM CALLSIGN** to Device notifications. It sends a synthetic SIM CALLSIGN push to the currently registered device only, allowing the push presentation to be tested without creating a live operational event.
- The standard **SEND TEST NOTIFICATION** remains available.
- Live server-side operational alert generation remains disabled at this stage; the SIM CALLSIGN test only proves the end-to-end notification delivery path and presentation.

# Release 284 — Similar Callsign annunciator fix

- Fixed the similar-callsign warning so **SIM CALL SIGN** appears above the always-visible aircraft TDB/mini-label (the small 1177/callsign/type/altitude box on the map), not only above the expanded aircraft detail box.
- The label appears **only** on aircraft currently participating in a live last-two-character similar-callsign match.
- The label gently pulses orange until that aircraft is clicked/acknowledged, then remains steady orange while the match continues.
- When the similar-callsign condition clears, the label disappears and acknowledgement state resets for that aircraft.
- Existing Release 283 notification-test work and all prior security/NOTAM/Telegram-stop changes are retained.

# Release 283 — Test Push Notification

- Added **SEND TEST NOTIFICATION** to the Notifications panel.
- Test sends only to the current registered device token.
- Server verifies Firebase Authentication and that the token belongs to the signed-in user.
- Test title: **FISO FID – TEST**.
- Test body: **Push notifications are working correctly on this device.**
- Operational alert generation remains disabled. Legacy Telegram delivery remains stopped.

# Release 282 — 23 Aug 2026

- Configured the Firebase Cloud Messaging public Web Push/VAPID key supplied from the FISOFID Firebase project.
- Renamed Apple-specific notification wording to **Device notifications** for compatible phones, tablets, computers and other supported devices.
- Updated PCH wording from phone/watch to device.
- Updated Firebase Messaging service-worker cache/version registration to Release 282.
- Retains Release 281 Danger Area fail-safe rendering: NOTAM-activated areas remain visually inactive unless current activation evidence exists.
- Old Telegram delivery remains stopped.
- Live server-side alert generation remains disabled until a controlled device test push succeeds.

# Release 281 — Notification foundation + fail-safe inactive Danger Areas

- Added a dedicated **Notifications** tab for iPhone / Apple Watch push setup.
- Added per-device switches for HAZPLOT, HAZDAM, SIM CALL SIGN, 0027, 0030, 7700 and PCH.
- Push-token registrations now carry the selected alert preferences so the future server alert engine can filter per device.
- Added a Disable-on-this-device control.
- Telegram delivery remains hard-stopped.
- This release intentionally does **not** enable the 24/7 server alert generator yet; first configure Firebase Web Push and prove a test notification on the iPhone.
- Danger Areas in INACTIVE state now render with a transparent interior and boundary only. In particular, an ENR area whose hours are **Activated by NOTAM** cannot appear visually active merely because no current supporting NOTAM has been loaded.
- Release 280 similar-callsign TDB annunciator, nautical-mile scale, secure Firebase login and previous NOTAM fixes retained.

# Release 280 — Similar Callsign TDB annunciator + wide NM scale

- Similar-callsign aircraft now show **SIM CALL SIGN** immediately above their TDB only while a live similar-callsign match exists.
- The SIM CALL SIGN text gently pulses orange until that individual aircraft is clicked/acknowledged, then remains steady orange for as long as the match exists.
- If the similar-callsign condition clears or changes, the annunciator is removed/reset automatically.
- Removed the redundant Similar Callsign detail row from inside the TDB.
- Expanded the nautical-mile scale to approximately half of the current map width.
- Removed the scale's dark surround and changed the scale line/text to a thinner black presentation.
- Release 279 clock flicker fix, Release 278 Telegram hard-stop, Firebase authentication/security, and all existing operational logic retained.

# Release 279 — UTC clock flicker fix

- Removed the duplicate legacy 1-second header clock writer.
- The adjustable operational UTC clock is now the sole writer of the header time/date.
- Added tabular-number/fixed-width clock styling to prevent digit-width layout movement.
- No operational timing, NOTAM, Danger Area, authentication or Telegram hard-stop logic changed.

# Release 278 — Telegram hard stop

- Stopped all existing Telegram message delivery while the Telegram integration is redesigned from scratch.
- Removed the scheduled Netlify execution of `hazdam-1177-watcher`.
- Removed the scheduled 2100 UTC `daily-hazard-report` Telegram delivery.
- Hard-disabled Telegram API sending in `hazdam-1177-watcher.js` and `daily-hazard-report.js`, including direct/test routes.
- Hard-disabled the Firebase Functions Telegram sender regardless of environment variables.
- Kept non-Telegram FISO FID functionality and the watcher queue/diagnostic processing available so the operational application is not unnecessarily disrupted.
- No Telegram bot token or chat ID is required by this release for message delivery because no Telegram delivery occurs.

# Release 275 — Current PIB Danger Area authority

- Fixed stale Danger Area NOTAM promulgations being retained from an older PIB (for example M5721/26 from 21 AUG).
- The single current uploaded/shared PIB is now authoritative for AUTO Danger Area NOTAM information.
- Stale AUTO PIB NOTAM fields from localStorage or Firebase are cleared back to ENR 5.1 data if the NOTAM is absent from the current PIB.
- Danger Area popup/card NOTAM promulgation details are only shown when that NOTAM exists in the current PIB.
- AUTO Danger Area reset now recognises legacy AUTO records even where their source label had already been rewritten to ENR.
- Prevents stale activation state from producing an incorrect active red fill on startup.
- Retains Release 274 Cranwell J2809/26 trigger-NOTAM suppression.

# Release 274 — RAF Cranwell SUP 094 trigger handling

- J2809/26 (TRIGGER NOTAM for AIP SUP 094/2026, RAF Cranwell Protector diversion) is retained in the PIB/NOTAM data but is explicitly information-only for AUTO PLOT.
- J2809/26 creates no TDA pin, no TDA shape and no HAZBUF hazard.
- EGD397A/B are no longer blanket-suppressed: a separate genuine RAF Cranwell TDA activation NOTAM can create the normal TDA pin/area for its promulgated activation period.
- Retains Release 273 Southampton FMC highlighting and all earlier functionality.

# Release 273 — Southampton FMC highlight

- Clicking EGHI (Southampton) now temporarily highlights the current Southampton Frequency Monitoring Code area in light yellow.
- The highlight displays a small information label: SSR 7011 / Monitor SOLENT RADAR / 120.230 MHz.
- The highlight remains while the EGHI popup is open.
- After the EGHI popup is closed/clicked off, the highlight and information label remain for 5 seconds, then disappear automatically.
- Clicking EGHI again cancels/restarts the hide timer.
- FMC boundary uses the permanent C4906/26 amendment: 511031N 0012021W - 510648N 0010232W - 505836N 0005856W - 504656N 0005626W - 503435N 0011753W - 503945N 0013529W - 504229N 0013301W - 505442N 0013925W - 510128N 0013420W - 511031N 0012021W.
- Retains Release 272 independent SIM acknowledgements and dynamic NM scale.

# Release 272

- Similar callsign TDB warning changed to a compact amber **SIM** badge on every affected aircraft TDB.
- Each aircraft must be acknowledged independently by clicking its own SIM badge. Acknowledging one aircraft does not stop the other aircraft from flashing.
- After acknowledgement, SIM remains visible as a steady amber badge while the similar-callsign condition continues.
- If the match disappears, the SIM badge is removed; if that aircraft later receives a new/changed similar-callsign match, the badge flashes again.
- Added a dynamic nautical-mile scale at the bottom-right of the map. The scale recalculates from Leaflet geodesic distance after zoom, pan and resize and displays a rounded value in **NM**.
- Retains Release 271 Intense Aerial Activity Display-pin handling and all earlier functionality.

# Release 267
- Rebuilt Danger Area ENR/NOTAM precedence. DEACTIVATED NOTAMs now temporarily suppress ENR only during their promulgated window; ENR resumes afterwards. Bracketed ENR times are treated as UTC and seasonal month windows are respected.

# Release 266

- Danger Area DEACTIVATED hard exclusion.

# Release 264

See RELEASE264_CHANGELOG.md.

# Release 256

RA(T)/TDA popup headings now include radius and levels before the location. Active PIB changes also automatically re-sync Danger Area NOTAM promulgations, ensuring D129 recognises D3186/26 without requiring an extra manual AUTO PLOT click.

## Release 248
- Red Arrows moving aircraft now follows every timed transit leg, handing over at each published waypoint time.
- Keeps the 22×18 px aircraft and zoom >= 9 visibility threshold.
- Supports concurrent Red Arrows transit routes.

## Release 247
- Red Arrows moving aircraft icon reduced to a genuinely small 22×18 px marker; asset itself resized to prevent oversized rendering.

# Release 245

Red Arrows transit waypoint labels are now compact, de-duplicated and zoom-dependent to prevent clutter on wide-area views. See RELEASE245_CHANGELOG.md.

# FISO FID DEV Release 240

## Adjustable UTC operational clock
- Added a live UTC clock at the top-right of the FISO FID screen.
- Admin-only **Edit time** control opens a UTC date/time editor.
- **Save** starts a continuously-running test clock from the selected UTC instant.
- **Reset to UTC** immediately returns the display and activation engine to real UTC.
- Test time is session/device-local only and is never written to Firebase.
- The adjusted clock drives operational display evaluation for plotted NOTAM hazards, Red Arrows route legs, Danger Area B/C validity, D-field schedules and ENR SR/SS scheduling.
- Persistent expiry/deletion and audit timestamps continue to use real UTC, preventing a future test time from deleting operational data.
- Changing or resetting the test clock immediately redraws hazard and HAZDAM layers.
# Release 238

D129 combined ENR + NOTAM activation: published Mon-Fri SR-SS is now calculated from sunrise/sunset and remains active while D3186/26 adds SS-SR activation, producing continuous activity through the NOTAM validity before reverting to ENR-only SR-SS.

# Release 235

Definitive D129/D3186 Auto Plot repair: cache-busting corrected, explicit EGD129 matching hardened, and SS-SR regression-tested.

# Release 233

Fixed recurring/overnight Danger Area NOTAM persistence so SS-SR activations such as D129 remain attached through their full B/C validity and switch state dynamically.

# Release 232

Added visible PIB loading/pressed-button feedback and a reliable AutoPlot PIB webpage opening sequence.

# Release 230

Added the Southampton/Solent FMC advisory area, EGHI FMC information, and a non-flashing live strip advisory for aircraft inside the monitoring area.

# Release 229
SUP101 label declutter: smaller D098-scale annotations, corrected D398/D399 paired labels, and R1426 trigger pin suppressed.

# Release 227

SUP AIP 101/26 map declutter: coloured architecture retained, D098-style red labels added, all architecture pins removed except one combined TDA Pin 1 for LF-R400G & LF-R402D.

## Release 226
- Fixed SUP101 TDAs disappearing after Firebase sync and corrected D398/D399 TDA classification/colours.

## Release 225
- SUP AIP 101/26 polygons now use the supplied chart colours; LF-D398/LF-D399 zones are explicitly TDA.

## Release 224
- Added visible DEV 224 version identification and JavaScript cache-busting for deployment verification.

## Release 223
- Rebuilt SUP AIP 101/26 with all 16 ZRT and 4 ZDT polygons using the supplied published lateral/vertical limits.

## Release 222
- Added SUP AIP 101/26 LF-D398A/B and LF-D399A/B TDA architecture and English translation links.

## Release 221
- R1426/26 is information-only: pin retained, radius removed, HAZPLOT disabled, SUP AIP 101/26 link added to popup.

## Release 220
- Danger Area AUTO promulgation now applies only today's UTC-valid NOTAMs; future-day NOTAMs cannot overwrite today's map state.

## Release 219
- Added EGD129 Weston-on-the-Green permanent ENR 5.1 Danger Area architecture (2 NM circle, SFC-FL120) for NOTAM activation/matching.

## Release 218
- Fixed false HAZBUF flashing from invisible/stale hazard records; only visible valid hazards can alert, with human-readable reasons and automatic clearing.

## Release 217
- Fixed blank STRIPS panel caused by an out-of-scope PCH variable in strip rendering; live aircraft strips reinstated.

## Release 214
- Hazard flashing is now self-clearing when the live conflict condition ends, and strips explain HAZBUF, HAZDAM and PCH flash reasons.

## Release 213
- AUTO Plotter globally excludes NOTAMs explicitly stating UAS ONLY and removes persisted AUTO plots from them.

## Release 212
- HAZDAM, all HAZBUF/HAZPLOT checks and all aircraft-to-aircraft PCH checks standardised to 3 NM lateral / 500 ft vertical.

## Release 210
- Removed the remaining Cranwell D397 AUTO TDA pins (J2199/26 and J2210/26) while retaining the programmed D397 architecture.

## Release 208
- Removed duplicate TDA pins/overlays from the D397A/D397B complex, as already done for D098.

## Release 207
- Removed the black outline from GPS/GNSS jamming areas; light-grey shading only.
- GPS/GNSS/radio-frequency jamming is excluded from HAZPLOT/HAZBUF for all aircraft.

## Release 206
- Removed TDA pins from the D098 complex, including legacy/persisted overlays.

## Release 205
- AUTO plots all RA(T)s with the RA(T) pin.
- Removes duplicate D098 TDA pin/radius overlays.
- Updates GNSS/GPS jamming to the preferred light-grey polygon shading.

## Release 204
- AUTO PLOT now recognises Temporary Danger Areas and plots them with the dedicated TDA pin and published radius/geometry.

## Release 203
- Fixed ENR Danger Areas showing Inactive while inside their displayed AIP UTC activity period.
- State, times and levels now share one ENR resolver; current NOTAM still supersedes ENR.

## Release 202
- All Danger Areas are forced to Auto — FISFID ENR DA.
- State, Start/End UTC and levels display live ENR/NOTAM-derived values.

## Release 201
- Corrected automatic ENR Hours scheduling for all programmed Danger Areas.
- Bracketed UTC hours drive state; NOTAM timing/levels supersede ENR.

## Release 200
- AUTO plots GNSS/GPS jamming/spoofing as Misc (black pin) with light-grey multi-point area shading.
- GPS/GNSS jamming is excluded from HAZPLOT/HAZBUF alerts.

## Release 199
- Every Airfield NOTAM popup now includes its D) operational schedule when published, before E).

## Release 198
- Added Open AutoPlot PIB: temporary full ACTIVE PIB viewer with AUTO PLOTTED annotations for HAZPLOTs and Danger Areas.
- Viewer includes source page references and Print / Save PDF.

## Release 197
- NOTAM PLOTTING > Danger Areas now shows effective Start/End UTC and Lower/Upper levels using NOTAM-over-ENR precedence.
- H24 displays 00:00–23:59; ENR daily schedules populate from the published UTC bracket times.

## Release 196
- Added EGD132, EGD408, EGD397A and EGD397B architecture; EGD397 popups include AIP SUP 077/2026.

## Release 195
- ENR `Hours: H24` Danger Areas are permanently ACTIVE at published levels unless superseded by a current NOTAM.
- H24/NOTAM precedence is now consistent across map labels, popups and conflict calculations.

## Release 194
- HAZPLOT popup-and-arrow architecture now mirrors Danger Areas for AUTO and manual plots.

# Release 149 — Operator-controlled AUTO PLOT

PIB upload no longer triggers plotting. The operator explicitly initiates a clean AUTO refresh; AUTO removal preserves manual hazards.

## Release 146
- Fixed Firebase-invalid NOTAM keys in the PIB page-number index.
- NOTAM page provenance now survives PIB upload and Firebase publication.

# Release 145

Fixed PIB PDF upload compatibility with Firebase while preserving page provenance and automatic gliding plotting.

# Release 130

- Restored the hidden `apiStatus` element required by the ADS-B status code.
- Restored the hidden `clock` element required during application startup.
- Added null-safety to both code paths so future header changes cannot stop ADS-B polling.
- Preserved Release 129 header spacing and all Release 128 aircraft receiver fixes.

# FFApp Release — FL195 Only Aircraft Filter

- Removed the FL110 aircraft filter from settings and aircraft processing.
- Removed the “Hide traffic above FL110” checkbox.
- Added migration code that deletes any previously saved FL110 setting from browser storage.
- FL195 remains the only altitude ceiling.

# Release120 - Hazard Delete Verified Fix

- Rebuilt exact hazard deletion with immediate Leaflet cleanup and Firebase stale-snapshot protection.
- Both right-click Delete and Plotted Hazards Delete use the same deletion engine.

# Release 117 — Hazard Save Update Fix

- Save remains available while editing any hazard pin or multi-point hazard.
- Changes to lower level, upper level, start time, finish time, reference, coordinates or NOTAM text keep the SAVE button active and bright.
- Saving updates the existing Plotted Hazards entry rather than creating a duplicate.
- After saving, the button returns to Add hazard and the form is reset for the next plot.
- Fixed optional time handling for both single-point and multi-point hazards.
- Fixed multi-point saves using undefined time variables.
- Start/finish times remain optional for every pin type.

## Release 121 — TDA / (R)AT / SAR OPS save fix
- Radius hazard types now retain levels and optional UTC times.
- Blank times continue to mean active until edited or deleted.

## Release 122 — NOTAM expiry and PARA defaults
- Removed the **Clear plotted NOTAMs** button from the PIB upload area.
- Timed plotted NOTAM hazards are now deleted automatically after their UTC finish time, including their map pin, area/radius shape and Plotted Hazards entry.
- The NOTAM code or keyword field now uses a light high-contrast background to draw the operator's attention.
- HAZPARA Orange distance now defaults to **5 NM**; Red remains **3 NM**.

## Release 132
- Forced all ADS-B browser traffic through the same-origin Netlify proxy to eliminate Safari CORS blocking.
- Removed direct ADS-B provider calls from both live polling and aircraft search.

Release 150: AUTO PLOT Firebase undefined-field fix.

## DEV 241 — Manual UTC test clock controls
- Separate Date / Hour / Minute inputs make the ADMIN test clock directly editable.
- Save applies the chosen UTC time; Reset to UTC restores live time.


## Release 243
Red Arrows transit overlay repair for forwarded operational test time. See RELEASE243_CHANGELOG.md.


## DEV 244 — Editable UTC date & time
- Added manual ADMIN day/month/year editing alongside hour/minute for operational test-time checks.
- Added calendar-date validation and retained timed NOTAM re-rendering.

## DEV 246 — Red Arrows moving aircraft proof of concept
- Added moving Red Arrows aircraft on one timed transit leg for review.
- Aircraft position follows the operational/test UTC clock exactly between the leg's published waypoint times.
- Aircraft is shown only at zoom 9+ and rotates with route direction.

## Release 249
- GNSS/GPS/radio-frequency jamming popup is pin-only.
- Jamming LAT/LONG boundary is hidden by default, shown light grey when the pin is clicked, and retained for 5 seconds after popup close.

## Release 251
- Moved Playback from the map overlay into the Traffic section.
- Playback is only available while Traffic is selected and closes automatically when leaving the Traffic tab.

## DEV 252
- Fixed header UTC clock to follow ADMIN operational test date/time instead of being overwritten by real UTC.


## Release 253
Expired NOTAM records are retained for ADMIN test-clock rewind while remaining hidden outside validity. Historical expired AUTO NOTAMs are preserved across AUTO PIB rebuilds, including Red Arrows transit routes.

## Release 255
- GNSS jamming popup leader now points directly to the black jamming pin instead of the polygon centre.
- GNSS temporary grey area shading made darker for improved visibility.
- Retains pin-only popup activation and 5-second post-close highlight.

## Release 259
- D129 rebuilt as a dedicated ENR 5.1 + additive PIB NOTAM workflow with raw-PIB fallback matching and Firebase race protection.
- D3186/26 on PIB page 21 is recognised as an additional SS-SR, SFC-FL120 D129 activation through its B)-C) validity.

## Release 260
- Added information-only AUTO plotting for MULTIPLE FAST JET ACFT / FIGHTER CTL TRAINING NON-SEGREGATED NOTAMs such as H5038/26.
- One black exercise pin reveals separately parsed red AREA polygons on click; no HAZPLOT, HAZBUF or aircraft warnings are generated.


## Release 262
- Added permanent AARA 1-14 reference geometry (including AARA10 East/West) as thin dashed red outlines with centred labels.
- Matching AARA activation NOTAMs in the current PIB switch the relevant area to a solid red outline and red fill while operationally active.
- AARA overlays are situational/reference airspace only and do not participate in HAZPLOT/HAZBUF aircraft conflict logic.

## Release 263
- Fixed AARA activation matching for `AAR WILL TAKE PLACE IN AAR AREA nn` NOTAMs (including H5388/26 / AARA12).
- Active AARA now solid red + filled; exact 15-minute pre-activation state flashes red.
- Air-to-air refuelling AUTO pins are now labelled `Air To Air Refuelling` rather than `AIR EX`.

## Release 265
- Manual AARA activation form with shared Firebase sync, UTC times, levels and notes.
## Release 268
- Standardised all NOTAM popup headings to show Pin number followed by published radius (where applicable), vertical limits and location/name.
- Polygon/route NOTAMs do not fabricate a radius from Q-line area-of-influence values.



## Release 270
See RELEASE270_CHANGELOG.md.
## Release 271
See RELEASE271_CHANGELOG.md.


## Release 276 — Secure Firebase Authentication / database lock-down
- Replaced browser-only Operator/Admin password checking with Firebase Email/Password Authentication using allocated user numbers.
- Removed the hard-coded Operator password and Admin password hash from frontend JavaScript.
- Operational scripts now load only after a Firebase-authenticated session has been verified.
- Admin/Operational role is taken from Firebase custom claims and mapped to the existing FISO FID UI permissions.
- Added forced first-login password change, persistent Firebase device sessions, Log Off/Switch User, reset requests and Admin Manage Users controls.
- Added `database.rules.json` with deny-by-default Realtime Database rules; operational reads require authentication and operational shared writes require an Admin custom claim.
- Browser access to `fiso/auth`, alert state/history and push-token data is denied; authenticated clients can register push tokens without being able to read the token collection.
- Hardened `listLoginNumbers` callable so it is Admin-only.
- Initial-user seed script now generates random temporary passwords at run time instead of embedding bootstrap passwords in source.
- Retains Release 275 Danger Area/PIB stale-NOTAM cleanup and Release 274 Cranwell trigger-NOTAM handling.


## Release 277 — 3-digit secure-login bootstrap fix
- Accepts allocated user numbers from 3 to 10 digits, including User 001.
- Uses the existing Firebase Authentication address format `001@fisofid.internal`.
- Supports the bootstrap custom claims `admin: true` / `operational: true` already assigned to User 001, while retaining the normal `role` / `userNumber` claim model for managed users.
- Derives the user number from the authenticated internal email when a bootstrap account does not yet contain a `userNumber` claim.
- Updated Admin checks in Functions and Realtime Database rules to recognise either the normal Admin role claim or the bootstrap Admin boolean.

## Release 285
- Replaced the Firebase Cloud Functions test-push path with a Netlify Function, avoiding the Firebase Blaze requirement.
- `SEND TEST NOTIFICATION` now calls `/.netlify/functions/send-test-push` and includes the signed-in user's Firebase ID token.
- Netlify verifies the Firebase ID token, verifies the requested FCM token belongs to that same signed-in user, then sends the test notification using Firebase Admin SDK.
- Requires a Netlify environment variable named `FIREBASE_SERVICE_ACCOUNT_JSON`; the credential remains server-side and is never exposed to the browser.
- Live operational alert generation remains disabled; this release only proves secure test delivery.

## Release 288
- Device push registration is now persistent. Once enabled, FISO FID silently restores the device FCM token after refresh, app restart and redeploy until the user selects **Disable on this device** or the browser/device revokes permission.
- Added live HAZPLOT push notifications when a tracked aircraft newly enters a valid visible plotted-hazard HAZBUF condition.
- HAZPLOT push clears locally when the conflict clears, making a genuine later re-entry eligible for a new alert; Netlify applies 2-minute cross-session dedupe to prevent duplicate relays.
- Added per-device HAZPLOT preference enforcement in the secure Netlify operational push function.
- Added **TEST HAZPLOT** notification button.
- Live SIM CALLSIGN notifications remain enabled; HAZDAM, 0027, 0030, 7700 and PCH live push generation remain off.
- Legacy Telegram delivery remains stopped.

## Release 295 — TDA display / AUTO PLOT feedback
- AUTO-PLOT TDA records no longer draw the large dashed radius circle; TDA pins, published polygon geometry and timing remain available.
- Initiate AUTO PLOT now visibly depresses, displays `AUTO PLOTTING…`, and shows a short loading status before returning to its normal state.


## Release 298
- Reduced Red Arrows waypoint time/position label size and padding.
- Capped label width so long location names cannot create large map boxes.
- Preserved full location name in the label title while keeping the operational map compact.


## Release 299
- Restored EGD305 Beckingham as a genuine HAZDAM Danger Area AUTO-PLOT target, not a Misc pin.
- Added 1 NM D305 horizontal architecture centred on the current published Q-line position 5305N 00041W.
- D305 uses standard Danger Area HAZPLOT/HAZBUF conflict behaviour and NOTAM B/C/F/G activation data.
- Added DROPPING OF ARTICLES as a Misc AUTO-PLOT pin with its published E-field position, radius, levels and B/C timing.
- Dropping of Articles remains a pin visually but its published radius participates in HAZPLOT/HAZBUF.
- Danger Area parser now explicitly recognises ACTIVE as well as ACTIVATE/ACTIVATED/ACTIVATION.


## Release 300
- Fixed stale operational script cache references in ffapp-auth.js; app, aviationData and HAZDAM now load with v=300.
- Added deterministic D305 PIB binding so D3231/26 is attached to EGD305 even if the generic matcher misses it.
- D305 with no D) schedule is continuously ACTIVE throughout its absolute B)-C) validity (28 Aug 0900Z to 30 Aug 1530Z for D3231/26), with the standard pre-activation pending period.

## Release 301
- Added AUTO-PLOT architecture for formation fly-ins published as multi-point bounded areas.
- L5057/26 is classified as "Multiple Display" and uses all published E-field boundary coordinates.
- Multiple Display polygons use a transparent yellow fill with a thin yellow outline.
- Aircraft and TDB layers remain visually dominant above the yellow overlay.
- Retains B/C validity, D) 0900-1600 activity, and F/G 1500-6800FT AMSL limits.
- Multiple Display remains part of the normal Display HAZPLOT/HAZBUF hazard family.

## Release 302
- All AUTO-PLOT HOT AIR BALLOON NOTAMs now use the supplied hot-air-balloon artwork as their map symbol.
- Balloon NOTAMs remain in the Display hazard family, preserving existing NOTAM timing, levels, radius and HAZPLOT/HAZBUF behaviour.
- Added a small reference badge without reverting to the generic Display pin.


## Release 303
- Removed the photographic/cartoon hot-air-balloon image from map pins.
- Hot-air-balloon NOTAMs return to the standard compact Display pin while retaining their label, timing, levels, radius and HAZPLOT/HAZBUF behaviour.

## Release 304
- Added deterministic AUTO-PLOT binding for EGD324A Waddington Low / D3285/26.
- D324A with no D) schedule uses the full B)-C) window: 30 Aug 1600Z-1800Z.
- Fixed HAZDAM expiry handling so AUTO NOTAM data is not erased by the real device clock after C).
- Rewinding/forwarding the operational test UTC clock now correctly restores D324A ACTIVE/PENDING/INACTIVE state.
- Danger Area payload ranking now uses the operational/test UTC clock rather than the device clock.

## Release 305
- Added one-click VIEW ONLY entry on the login screen.
- VIEW ONLY loads the operational map and strips without requiring a user number/password.
- View-only strips are read-only and the normal information/admin workspaces remain closed.
- Pressing the INFO slider in VIEW ONLY prompts for a limited-edit password.
- Correct password unlocks only the Para Sites workspace and AARA manual activation controls for the current session.
- All other Admin/Operator editing controls remain locked.
- Limited-edit password is checked as a SHA-256 hash in browser code rather than stored as plaintext.

## Release 306
- VIEW ONLY now always opens in the fixed map + strips presentation.
- Strips are expanded on the left and INFO is collapsed on the right on every View Only entry.
- Search, Admin, panel menu, update banner and UTC edit controls are hidden in View Only.
- UTC clock, VIEW ONLY role label, Switch User and Log Off remain visible.
- Existing strip data remains visible but all strip editing controls are inert.
- INFO handle remains available solely to request the limited-edit password.

## Release 307
- Limited-edit INFO now opens the complete Parachute Sites workspace immediately after the password is accepted.
- Rebuilds all parachute-site cards, restores shared Start/Finish values, and rewires the editing controls on unlock.
- Para Sites is the only visible INFO tab in limited-edit mode.
- Reduced limited-edit INFO width to 340px, only slightly wider than the parachute-site cards, leaving substantially more map visible.

## Release 308
- VIEW ONLY now forces the INFO panel to true zero width on entry; no empty INFO workspace remains open.
- Leaflet is resized repeatedly during initialisation so the map expands into the reclaimed space.
- Limited-edit unlock explicitly reveals the Para Sites panel and rebuilds every parachute-site card.
- Para site cards, saved Start/Finish values and AUTO/ACTIVE/NOT ACTIVE controls are refreshed immediately and retried briefly while shared data restores.
- Clicking INFO again during an unlocked limited-edit session reopens the Para Sites workspace.
- Limited-edit header changes to VIEW + EDIT while unlocked.

## Release 309
- VIEW ONLY now starts with the INFO workspace completely collapsed.
- The desktop grid no longer reserves a blank INFO column on initial login.
- Map + strips occupy the available width immediately.
- INFO remains available from its handle and can still unlock the limited Para Sites editor.

## Release 310
- Rechecked Release309 against the actual layout: main is a flex container, not a CSS grid.
- Removed the ineffective grid-column override from the solution path.
- VIEW ONLY now removes INFO from the flex layout and explicitly expands #map into all remaining width.
- Added a Safari/file:// DOM sizing fallback using the measured main and strips widths.
- Recalculates the map width during startup and browser resizing, then invalidates Leaflet size.
- INFO handle remains visible at the far-right edge for password-protected Para Sites access.

## Release 311
- Simplified VIEW ONLY to a permanently read-only mode.
- INFO panel is fully removed from the View Only layout.
- INFO slider/handle is hidden and cannot be opened.
- Removed the View Only password prompt and limited-edit pathway.
- View Only now consists only of the map, read-only strips, UTC display, Switch User and Log Off.
- Operator and Admin INFO functionality remains unchanged.

## Release 312
- Removed only the VIEW ONLY login button from the login screen.
- Removed the associated View Only helper text.
- All Operator/Admin functionality remains unchanged.


## Release 313
- View Only INFO now always opens on PARA SITES rather than inheriting Danger Areas.
- PARA SITES is highlighted as the active NOTAM workspace sub-button in View Only.
- Para list is rebuilt/restored and scrolled to the top whenever INFO opens.
- INFO remains closed on initial View Only entry and opens only from the INFO handle.
- Para Site controls remain usable inside the View Only INFO workspace; other View Only controls remain locked.


## Release 314 — Startup performance deep clean
- Removed GeoTIFF, XLSX and Firebase Messaging from the login critical path; they now load only when their feature is used.
- Firebase Realtime Database and Leaflet JavaScript are loaded only after authentication, immediately before the operational app.
- Versioned operational JavaScript is warmed in the browser while the login screen is displayed, without executing it before authentication.
- Removed an unnecessary forced Firebase token refresh on every login; a forced refresh now occurs only if role claims are missing or a password-change flow requires it.
- Corrected operational script URLs to the exact lowercase filenames used in the deployment package.
- Added release query versions to every operational script, including files that were previously unversioned.
- Versioned JS/CSS now receives long-lived immutable browser caching on Netlify; index.html and the messaging service worker remain uncached.
- Silent push-notification restoration is deferred until the browser is idle / startup has settled.
- Added console startup timing for dependency load, operational-script load and total startup time.

## Release 315
- Suspended all device push notifications.
- Firebase Messaging SDK is never loaded.
- Push-token restoration, device registration, push tests and preference writes no longer run.
- Existing FISO FID messaging service-worker registrations are retired/unsubscribed where the browser permits.
- firebase-messaging-sw.js is now a self-unregistering no-op.
- In-app operational alerts and HAZPLOT/HAZDAM/HAZPARA/PCH logic remain unchanged.
- Fixed Release314 performance oversight: operational preloads were defined but never invoked.
- Operational JS now preloads at low priority while the login screen is idle or as soon as the user begins login.
- Leaflet and Firebase Realtime Database loading now overlap the Firebase authentication round-trip instead of starting afterwards.
- Added preconnect/DNS-prefetch hints for gstatic and unpkg.

## Release 316
- Restored the one-click VIEW ONLY login button.
- Retained the existing View Only permissions and Para Sites/View Only behaviour from the current application.
- Added an immediate technical startup splash so the app never appears frozen on first opening.
- Startup sequence displays ADS-B initialisation, NOTAM PIB loading, HAZDAM/HAZPLOT synchronisation and operational map-layer loading.
- Performs one controlled refresh after three seconds on the first opening of Release316 only.
- Uses a session guard to prevent any refresh loop.
- After the controlled refresh, the splash verifies the operational cache briefly and then reveals the login screen.
- View Only now starts operational asset warm-up immediately when selected.
- Push notifications remain suspended.

## Release 317
- INFO panel now always starts in the closed/collapsed state when the application opens.
- INFO is also reset closed when a user enters the application or a role is applied.
- This applies to normal authenticated login and View Only.
- Users can still deliberately open INFO afterwards where their role permits it.
- Startup loader, View Only login and Release315 push suspension remain unchanged.

## Release 318
- Fixed the blank right-hand area seen after entering View Only.
- The INFO panel was already collapsed; the problem was Leaflet retaining the old map viewport width from when INFO occupied 500px.
- View Only now removes stale explicit map widths and lets flexbox fill the complete available width.
- Added a ResizeObserver and repeated Leaflet invalidateSize calls during View Only startup/layout settling.
- View Only emits a dedicated post-login reflow event after the login overlay closes.
- INFO still starts closed; View Only permissions and Release316 startup loader remain unchanged.

## Release 319
- INFO is now collapsed in the static HTML before any JavaScript runs.
- Added authoritative final CSS rules so the initial collapsed state wins over legacy View Only rules.
- Role application no longer auto-opens INFO.
- View Only still opens INFO only after a deliberate user click.
- Map expands into the released width while INFO is collapsed.

## Release 320
- View Only INFO handle is now a true toggle.
- First click opens INFO and defaults to PARA SITES.
- Second click closes INFO.
- Further clicks alternate open/closed correctly.
- Map is reflowed after closing INFO so no blank right-hand area remains.

## Release 321
- Fixed View Only startup hanging at 78%.
- 78% represented 7 of 9 operational scripts having loaded; conflictengine/hazdam were holding the login overlay open.
- Core seven operational modules now load deterministically and unlock the app first.
- conflictengine.js and hazdam.js load immediately afterwards without blocking first paint/View Only entry.
- Replaced fragile batch dynamic-script startup with sequential execution backed by preload cache.
- Added per-script timeout and one cache-busting retry so a CDN/Netlify request cannot leave the UI stuck indefinitely.
- Loading status now includes the current module name for easier diagnosis.

## Release 322
- Added a dedicated Firebase channel for current AUTO PIB plots: fiso/fisoradar_auto_pib_hazards_v1.
- AUTO plots are now published separately from manual plotted hazards.
- Every browser listens to the shared AUTO channel and merges it with its local/manual hazard display.
- Fixed the startup race where hazards could arrive before the shared PIB and be filtered out permanently.
- Passwordless VIEW ONLY can read the dedicated AUTO plot channel.
- The dedicated path is public read-only; writes remain restricted to authenticated Admin users.
- Initiate AUTO PLOT now publishes the complete current AUTO set to both the legacy hazard path and the dedicated shared AUTO path.
- Admin Clear and AUTO removal clear the dedicated shared AUTO state as well.
- Includes a one-time legacy migration attempt when an authenticated Admin opens Release322 with existing AUTO records.


## Release 325
- Fixed cross-device AUTO PIB synchronisation for authenticated Operational users.
- Authenticated Admin/Operational sessions now treat the established `fisoradar_hazards_v1` Firebase path as authoritative for AUTO PIB plots; an empty/stale dedicated VIEW ONLY snapshot can no longer strip those plots from another logged-in device.
- The dedicated `fisoradar_auto_pib_hazards_v1` channel is now used as the AUTO overlay specifically for passwordless VIEW ONLY.
- Re-applies the AUTO snapshot when the final authenticated role is applied, removing the startup-role race.
- AUTO PLOT publish status now distinguishes normal Operational sync success from VIEW ONLY public-channel failure.
- Corrected cache busting: Release 324 still loaded core operational scripts with `?v=323`, allowing phones/other browsers to keep running cached Release 323 code. Release 325 changes all operational script query versions to `?v=325` and reports Release 325 from `app.js`.
- Retains Release 324 exclusion of PIPELINE INSPECTION / PINS NOTAMs from AUTO plotting.

## Dev328 - Aerial Filming transient area
- Aerial Filming NOTAM polygons are hidden by default and shown as light-yellow shading when the user clicks the associated pin.
- The shaded area remains visible for five seconds after the popup closes.
- Aerial Filming does not use the configured lateral HAZPLOT buffer; a conflict is created only when the aircraft is inside the published polygon (subject to the existing vertical check).

## Dev330 - Aerial Filming AUTO PIB classifier
- Fixed Dev329 regression/omission where Dev328 Aerial Filming rendering and polygon-entry conflict logic was present, but AUTO PIB did not classify AERIAL FILMING NOTAMs into hazards.
- Recognises `AERIAL FILMING` and `FILMING FROM AN ACFT/AIRCRAFT` wording and extracts the precise E-field boundary coordinates.
- Creates one Misc-family Aerial Filming pin with the exact published multi-point polygon.
- Polygon remains hidden until the pin is selected, displays as light-yellow shading, and remains visible for 5 seconds after popup close.
- Aircraft hazard remains inside-polygon only (no lateral HAZPLOT buffer) with the existing vertical limit check.


## Dev 332 – Aerial Filming advance awareness
- Keep AUTO-plotted Aerial Filming pins visible whenever their NOTAM is present in the ACTIVE PIB, including before B).
- Preserve strict B/C/D and vertical-limit gating for aircraft HAZPLOT conflict generation.
- Keep the light-yellow published polygon hidden until pin selection, then retain it for five seconds after popup close.

## Dev 333 — Aerial Filming normal HAZPLOT timing restored
- Restored the standard HAZPLOT visibility timing for Aerial Filming pins.
- Aerial Filming pins remain hidden until 30 minutes before the NOTAM B) time, then follow the existing soon/active timing rules.
- Retained Aerial Filming AUTO PIB classification and plotting.
- Retained light-yellow polygon reveal on pin click and five-second persistence after popup close.
- Retained polygon-entry-only aircraft conflict logic (no lateral HAZPLOT buffer).
- Retained Dev 331 cold-start map recovery and Dev 329 consolidated Danger Area activation handling.

## DEV339 — Aerial Filming MISC multi-plot reset
- Removed the dedicated Aerial Filming AUTO-plot creation path from the live classifier chain.
- AERIAL FILMING is now created as a standard MISC multi-point AUTO plot using the published AREA BOUNDED BY vertices.
- Normal HAZPLOT visibility applies: visible/soon from 30 minutes before B), active B)-C), hidden otherwise.
- Retains light-yellow click-to-reveal polygon presentation and polygon-entry-only aircraft conflict behaviour.
- Corrected the operational asset build constant to 339 so DEV339 cannot load cached DEV338 application JavaScript.
- Regression-tested L5097/26: 9 distinct vertices; B 02 Sep 0845Z; C 02 Sep 1545Z; timing boundaries pass.

- DEV363: NOTAM ticker codes now show the full PIB NOTAM in a hover/focus popup. The ticker reel can be click-held and dragged backward/forward, then resumes scrolling from the released position.

## DEV392 — Current UK airfield refresh
- Added a server-side Netlify endpoint (`current-airfields`) that retrieves the current public-domain OurAirports dataset and returns only active UK airports, airfields, heliports, seaplane bases and balloon sites.
- Added 24-hour browser caching plus CDN cache headers so the worldwide source file is not downloaded by each browser session.
- Current OurAirports sites are now the primary map reference layer; LAAS May 2017 sites remain only where no current site matches geographically/name-wise.
- Current and legacy points remain small/unobtrusive when zoomed out; names appear only at zoom level 10 or closer.
- Range & Bearing search now includes the current UK dataset automatically while retaining existing reporting-point, location and legacy fallback searches.
- Current airfield popups show code, type, municipality, position and source; legacy entries are explicitly marked as fallback data.

## 2026-09-14 — Cobra Warrior / generic military exercise AUTO plot
- Expanded information-only military exercise recognition to include UK PIB wording beginning `EXER ...` such as H4453/26 COBRA WARRIOR 26-2.
- Exercises with published `AREA BOUNDED BY` geometry plus aircraft/fast-jet/formation/high-energy/IFF exercise cues now use the same H5795/26 architecture: black information pin, red click-to-reveal polygon, no HAZPLOT/HAZBUF.
- Recognition is generic and not tied to H4453/26, so follow-up and future NOTAMs using the same pattern are handled automatically.


## DEV394 — Naval live-firing AUTO plot
- Added generic AUTO-PLOT recognition for NOTAMs such as H5891/26 containing `LIVE FIRING FROM NAVAL SHIP ... BOUNDED BY ...`.
- Uses every published E-field full-seconds coordinate to draw the exact live-firing polygon and places one MISC pin at the polygon centre.
- Uses the published B/C validity, D) daily schedule, and F/G vertical limits (H5891/26: SFC–FL300).
- Naval live firing remains an operational HAZPLOT/HAZBUF hazard; no Q-line radius circle is invented when exact polygon geometry is available.
- Recognition is generic for future `LIVE FIRING FROM [NAVAL] SHIP/WARSHIP ... BOUNDED BY` NOTAMs and is not hard-coded to H5891/26.
- Bumped authenticated operational asset cache version to 394 so browsers load the updated classifier immediately after publish.

## DEV397 — FISOFID LOW / HIGH bespoke base charts
- Added **FISOFID LOW** and **FISOFID HIGH** to Base map style.
- These are original FISOFID vector chart modes; no SkyVector tiles/artwork are used.
- FISOFID LOW renders the app's UK AIRAC 09/2026 controlled-airspace reference plus UK FIR significant points over the neutral geography basemap, with denser lower-airspace labelling.
- FISOFID HIGH renders a cleaner upper-airspace view using Class A/upper controlled-airspace geometry and significant points, with reduced clutter.
- Existing NOTAM, danger-area, hazard, aircraft, data-block, vector and airfield overlays remain independent and above the chart.
- Existing Standard and eVFR base-map modes are unchanged.


## DEV400 — LOW/HIGH declutter and airway arrow refinement
- FISOFID LOW/HIGH reporting-point symbols now remain hidden at the widest overview levels and appear progressively as the user zooms in.
- Reporting-point names are withheld until zoom 10, substantially reducing UK-wide clutter.
- When names appear they use heavier black text and a stronger white halo for readability.
- Existing route direction arrows are reduced to small unobtrusive chevrons; arrows are still only drawn where the source segment explicitly carries direction metadata, avoiding invented traffic direction.

## DEV423 — Aircraft zoom performance
- Keeps DEV421 FL195 / special-squawk display policy unchanged.
- Adds a dedicated class to rich aircraft DivIcons.
- Suppresses aircraft/TDB painting only during Leaflet zoom animation to prevent Safari repaint stalls with large under-FL195 traffic sets.
- Live polling/cache continues during zoom and markers restore at zoomend.


## DEV429 — LIVE AUTO PIB startup recovery
- Fixed downloaded file:// preview using relative /api/pib, which caused the NATS feed to fail. Local previews now use the published HTTPS PIB proxy with fallback.
- Added explicit LIVE PIB checking/complete/error state.
- Startup holding card closes only after clock + AUTO PIB success; terminal feed failure no longer leaves the card hung indefinitely and the red operational warning remains visible.
- Added 15-second endpoint timeout/fallback to avoid indefinite fetch waits.

## DEV423 — PARA continuous keyboard entry
- Pressing Tab from a PARA site's FL/ALT field now saves that level and moves focus directly to the next PARA site's Start HH field.
- The destination Start HH value is selected automatically, so the operator can immediately type the replacement hour without positioning the cursor.
- From the final PARA in the list, Tab wraps to the first PARA Start HH for continuous keyboard entry.


## DEV424
- Aircraft moved to a dedicated high-priority Leaflet pane above NOTAM and Danger Area overlays/pins.
- Aircraft TDB interactions are isolated from the map; Point out and all TDB controls stop click/touch propagation.
- Aircraft + TDB size slider now scales aircraft symbols, expanded TDBs, and always-visible mini TDB/data-block text together.

## DEV 429 — Netlify Blobs runtime fix (25 Sep 2026)
- Converted `pib-scheduled-update` from Lambda-compatible Functions v1 (`exports.handler`) to modern Netlify Functions v2 (`export default` + `Response`).
- Converted `pib-cache` to Functions v2 for the same reason.
- This allows Netlify to inject the Blobs site/token runtime context automatically and resolves `MissingBlobsEnvironmentError` seen in DEV 428.
- Kept the 15-minute UTC schedule unchanged (`*/15 * * * *`).
- Added DEV429 success/error logging and strong-consistency reads for verification.
