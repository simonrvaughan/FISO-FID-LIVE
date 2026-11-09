"use strict";

/*
  FFApp / FISO FID - Conflict Engine - Release 216

  Purpose:
  - Generic aircraft-vs-airspace conflict calculations.
  - Used by HAZDAM now and designed for controlled airspace later.

  Release 036:
  - Adds vertical filtering with a configurable 500 ft tolerance.
  - Aircraft 500 ft or more above/below an active/pending area are ignored.
  - Adds vertical text/status to conflicts.
  - Keeps prediction, nearest-boundary vectors and protected squawk filtering.
*/

(function () {
  const CONFIG = {
    protectedSquawks: ["1177", "0027", "0030", "0037", "7400", "7500", "7600", "7700"],
    warningDistanceNm: 3.0,
    verticalToleranceFt: 500,
    predictionMinutes: 5,
    predictionStepMinutes: 0.5,
    activeStates: ["pending", "active", "PENDING", "ACTIVE"],
  };

  const state = {
    conflicts: [],
    lastRunAt: null,
    lastCheckedAircraft: 0,
    lastProtectedAircraft: 0,
  };

  window.FISO_CONFLICT_ENGINE = {
    config: CONFIG,
    state,

    getProtectedSquawks,
    isProtectedSquawk,
    normaliseAircraft,
    getDangerAreas,
    getAreaOperationalState,
    isAreaOperationallyRelevant,

    parseVerticalLimitFt,
    assessVerticalConflict,

    pointInArea,
    distanceToAreaNm,
    bearingToAreaDeg,
    projectAircraft,
    findNearestAreaConflict,
    evaluateAircraft,
    evaluateAircraftList,

    getConflicts,
    clearConflicts,
  };

  function getProtectedSquawks() {
    try {
      if (window.FFAPP_PROTECTED_SQUAWKS && typeof window.FFAPP_PROTECTED_SQUAWKS.get === "function") {
        const live = window.FFAPP_PROTECTED_SQUAWKS.get();
        if (Array.isArray(live) && live.length) return live;
      }
    } catch (e) {}
    return CONFIG.protectedSquawks.slice();
  }

  function isProtectedSquawk(squawk) {
    const sqk = String(squawk || "").replace(/\D/g, "").padStart(4, "0").slice(-4);
    return getProtectedSquawks().includes(sqk);
  }

  function normaliseAircraft(raw) {
    if (!raw) return null;

    const lat = firstNumber(raw.lat, raw.latitude);
    const lon = firstNumber(raw.lon, raw.lng, raw.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return {
      hex: String(raw.hex || raw.icao || raw.id || raw.flight || "").trim(),
      callsign: String(raw.callsign || raw.flight || raw.r || raw.hex || "").trim(),
      squawk: String(raw.squawk || raw.sqk || "").trim().padStart(4, "0"),
      lat,
      lon,
      altitude: firstNumber(raw.alt_baro, raw.alt_geom, raw.altitude, raw.alt),
      track: firstNumber(raw.track, raw.heading, raw.hdg),
      groundSpeed: firstNumber(raw.gs, raw.speed, raw.groundSpeed),
      raw,
    };
  }

  function firstNumber(...values) {
    for (const value of values) {
      if (value === null || typeof value === "undefined" || value === "ground") continue;
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  function getDangerAreas() {
    const data = window.FISO_DATA && window.FISO_DATA.dangerAreas;
    if (!data) return [];

    return Object.keys(data)
      .map((id) => data[id])
      .filter((area) => area && Array.isArray(area.coords) && area.coords.length >= 3);
  }

  function getAreaOperationalState(area) {
    if (!area) return "inactive";
    const explicit = area.operationalState || area.state || area.status;
    if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
    return "active";
  }

  function isAreaOperationallyRelevant(area) {
    const areaState = getAreaOperationalState(area);
    return CONFIG.activeStates.includes(areaState);
  }

  function parseVerticalLimitFt(value, role) {
    const text = String(value || "").trim().toUpperCase();
    if (!text) return null;
    if (text === "SFC" || text === "SURFACE" || text === "GND") return 0;
    if (text === "UNL" || text === "UNLIMITED") return Infinity;

    const fl = text.match(/\bFL\s*(\d{2,3})\b/);
    if (fl) return Number(fl[1]) * 100;

    const ft = text.match(/(\d{3,6})\s*FT/);
    if (ft) return Number(ft[1]);

    const plain = text.match(/^\d{3,6}$/);
    if (plain) return Number(text);

    // AUP/UUP or complex notified levels cannot be evaluated safely.
    // Treat unknown lower as unknown and unknown upper as unknown, not as a block.
    return null;
  }

  function assessVerticalConflict(ac, area) {
    const altitude = Number(ac && ac.altitude);
    const tolerance = Number(area && area.verticalToleranceFt) || CONFIG.verticalToleranceFt;
    const lowerFt = parseVerticalLimitFt(area && area.lower, "lower");
    const upperFt = parseVerticalLimitFt(area && area.upper, "upper");

    if (!Number.isFinite(altitude)) {
      return {
        hazardCandidate: true,
        withinLimits: true,
        withinTolerance: true,
        status: "UNKNOWN",
        text: "Vertical unknown",
        deltaFt: null,
        lowerFt,
        upperFt,
        toleranceFt: tolerance,
      };
    }

    if (Number.isFinite(upperFt)) {
      const above = altitude - upperFt;
      if (above >= tolerance) {
        return {
          hazardCandidate: false,
          withinLimits: false,
          withinTolerance: false,
          status: "ABOVE",
          text: `${Math.round(above)} ft above upper limit`,
          deltaFt: Math.round(above),
          lowerFt,
          upperFt,
          toleranceFt: tolerance,
        };
      }
      if (above > 0) {
        return {
          hazardCandidate: true,
          withinLimits: false,
          withinTolerance: true,
          status: "ABOVE_BUFFER",
          text: `${Math.round(above)} ft above upper limit`,
          deltaFt: Math.round(above),
          lowerFt,
          upperFt,
          toleranceFt: tolerance,
        };
      }
    }

    if (Number.isFinite(lowerFt)) {
      const below = lowerFt - altitude;
      if (below >= tolerance) {
        return {
          hazardCandidate: false,
          withinLimits: false,
          withinTolerance: false,
          status: "BELOW",
          text: `${Math.round(below)} ft below lower limit`,
          deltaFt: -Math.round(below),
          lowerFt,
          upperFt,
          toleranceFt: tolerance,
        };
      }
      if (below > 0) {
        return {
          hazardCandidate: true,
          withinLimits: false,
          withinTolerance: true,
          status: "BELOW_BUFFER",
          text: `${Math.round(below)} ft below lower limit`,
          deltaFt: -Math.round(below),
          lowerFt,
          upperFt,
          toleranceFt: tolerance,
        };
      }
    }

    return {
      hazardCandidate: true,
      withinLimits: true,
      withinTolerance: true,
      status: "WITHIN",
      text: "Within vertical limits",
      deltaFt: 0,
      lowerFt,
      upperFt,
      toleranceFt: tolerance,
    };
  }

  function pointInArea(point, area) {
    if (!window.FISO_GEOMETRY || !window.FISO_GEOMETRY.pointInPolygon) {
      console.warn("FISO_CONFLICT_ENGINE: geometry engine not loaded");
      return false;
    }
    if (!area || !Array.isArray(area.coords)) return false;
    return window.FISO_GEOMETRY.pointInPolygon(point, area.coords);
  }

  function distanceToAreaNm(point, area) {
    const nearest = nearestPointOnArea(point, area);
    return nearest ? nearest.distanceNm : Infinity;
  }

  function bearingToAreaDeg(point, area) {
    const nearest = nearestPointOnArea(point, area);
    return nearest ? bearingDeg(point.lat, point.lon, nearest.lat, nearest.lon) : null;
  }

  function nearestPointOnArea(point, area) {
    if (!area || !Array.isArray(area.coords) || area.coords.length < 2) return null;

    let best = null;
    for (let i = 0; i < area.coords.length; i++) {
      const a = arrayPoint(area.coords[i]);
      const b = arrayPoint(area.coords[(i + 1) % area.coords.length]);
      const n = nearestPointOnSegmentNm(point, a, b);
      if (!best || n.distanceNm < best.distanceNm) best = n;
    }
    return best;
  }

  function findNearestAreaConflict(aircraft, areas) {
    const ac = normaliseAircraft(aircraft);
    if (!ac) return null;
    if (!isProtectedSquawk(ac.squawk)) return null;

    const candidateAreas = Array.isArray(areas) ? areas : getDangerAreas();
    const currentPoint = { lat: ac.lat, lon: ac.lon };

    let best = null;

    for (const area of candidateAreas) {
      if (!isAreaOperationallyRelevant(area)) continue;

      const vertical = assessVerticalConflict(ac, area);
      if (!vertical.hazardCandidate) continue;

      const current = buildConflictCandidate(ac, area, currentPoint, 0, vertical);
      if (current && (current.inside || current.distanceNm <= CONFIG.warningDistanceNm)) {
        const status = current.inside ? "INSIDE" : "NEAR";
        const severity = severityFor(status, vertical);
        const conflict = Object.assign(current, {
          status,
          severity,
          etaMinutes: 0,
          etaText: status === "INSIDE" ? "NOW" : "CURRENT",
          distanceText: status === "INSIDE" ? "INSIDE" : `${current.distanceNm.toFixed(1)} NM`,
        });
        best = chooseBetterConflict(best, conflict);
        continue;
      }

      // Release 216: HAZDAM is CURRENT-position only. Do not flash an aircraft because
      // a projected track may enter the area later. Current 3 NM lateral and 500 ft
      // vertical criteria are the sole trigger and therefore clear immediately on exit.
    }

    return best;
  }

  function severityFor(status, vertical) {
    if (vertical && vertical.withinLimits === false && vertical.withinTolerance) return 3;
    if (status === "INSIDE") return 0;
    if (status === "NEAR") return 1;
    if (status === "PREDICTED") return 2;
    return 4;
  }

  function buildConflictCandidate(ac, area, point, etaMinutes, vertical) {
    if (!point) return null;
    const inside = pointInArea(point, area);
    const nearest = nearestPointOnArea(point, area);
    const distanceNm = inside ? 0 : (nearest ? nearest.distanceNm : Infinity);
    const bearing = inside || !nearest ? null : bearingDeg(point.lat, point.lon, nearest.lat, nearest.lon);
    const v = vertical || assessVerticalConflict(ac, area);
    return {
      aircraftHex: ac.hex,
      callsign: ac.callsign || ac.hex || "UNKNOWN",
      squawk: ac.squawk,
      dangerAreaId: area.id,
      dangerArea: area.display || area.id,
      areaType: area.type || "dangerArea",
      areaState: getAreaOperationalState(area),
      inside,
      distanceNm,
      bearingToArea: bearing,
      etaMinutes,
      aircraftLat: ac.lat,
      aircraftLon: ac.lon,
      conflictLat: point.lat,
      conflictLon: point.lon,
      nearestBoundaryLat: nearest ? nearest.lat : null,
      nearestBoundaryLon: nearest ? nearest.lon : null,
      verticalStatus: v.status,
      verticalText: v.text,
      verticalDeltaFt: v.deltaFt,
      verticalWithinLimits: v.withinLimits,
      verticalWithinTolerance: v.withinTolerance,
      verticalLowerFt: v.lowerFt,
      verticalUpperFt: v.upperFt,
      verticalToleranceFt: v.toleranceFt,
      aircraft: ac,
      area,
      createdAt: new Date().toISOString(),
    };
  }

  function findPredictedConflict(ac, area, vertical) {
    if (!Number.isFinite(ac.track) || !Number.isFinite(ac.groundSpeed) || ac.groundSpeed <= 5) return null;

    for (let t = CONFIG.predictionStepMinutes; t <= CONFIG.predictionMinutes + 1e-9; t += CONFIG.predictionStepMinutes) {
      const point = projectAircraft(ac, t);
      const candidate = buildConflictCandidate(ac, area, point, t, vertical);
      if (!candidate) continue;
      if (candidate.inside || candidate.distanceNm <= CONFIG.warningDistanceNm) {
        return Object.assign(candidate, {
          status: "PREDICTED",
          severity: severityFor("PREDICTED", vertical),
          etaText: formatEta(t),
          distanceText: candidate.inside ? "WILL ENTER" : `${candidate.distanceNm.toFixed(1)} NM IN ${formatEta(t)}`,
        });
      }
    }
    return null;
  }

  function chooseBetterConflict(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (b.severity !== a.severity) return b.severity < a.severity ? b : a;
    if ((b.etaMinutes || 0) !== (a.etaMinutes || 0)) return (b.etaMinutes || 0) < (a.etaMinutes || 0) ? b : a;
    return b.distanceNm < a.distanceNm ? b : a;
  }

  function evaluateAircraft(aircraft, areas) {
    return findNearestAreaConflict(aircraft, areas);
  }

  function evaluateAircraftList(aircraftList, areas) {
    const list = Array.isArray(aircraftList) ? aircraftList : [];
    const results = [];
    let checked = 0;
    let protectedCount = 0;

    for (const aircraft of list) {
      const ac = normaliseAircraft(aircraft);
      if (!ac) continue;
      checked++;
      if (isProtectedSquawk(ac.squawk)) protectedCount++;
      const conflict = evaluateAircraft(ac.raw || aircraft, areas);
      if (conflict) results.push(conflict);
    }

    results.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity - b.severity;
      if ((a.etaMinutes || 0) !== (b.etaMinutes || 0)) return (a.etaMinutes || 0) - (b.etaMinutes || 0);
      return a.distanceNm - b.distanceNm;
    });

    state.conflicts = results;
    state.lastRunAt = new Date().toISOString();
    state.lastCheckedAircraft = checked;
    state.lastProtectedAircraft = protectedCount;

    return results;
  }

  function getConflicts() {
    return state.conflicts.slice();
  }

  function clearConflicts() {
    state.conflicts = [];
    state.lastRunAt = new Date().toISOString();
  }

  function projectAircraft(ac, minutes) {
    const speedNmMin = Number(ac.groundSpeed) / 60;
    const distanceNm = speedNmMin * Number(minutes);
    return destinationPoint(ac.lat, ac.lon, ac.track, distanceNm);
  }

  function destinationPoint(lat, lon, bearing, distanceNm) {
    const R = 3440.065;
    const d = Number(distanceNm) / R;
    const brng = toRad(Number(bearing));
    const lat1 = toRad(Number(lat));
    const lon1 = toRad(Number(lon));

    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

    return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
  }

  function arrayPoint(pair) {
    return { lat: Number(pair[0]), lon: Number(pair[1]) };
  }

  function nearestPointOnSegmentNm(point, start, end) {
    const lat0 = toRad(Number(point.lat));
    const nmPerDegLat = 60.0;
    const nmPerDegLon = 60.0 * Math.cos(lat0);

    const px = Number(point.lon) * nmPerDegLon;
    const py = Number(point.lat) * nmPerDegLat;
    const ax = Number(start.lon) * nmPerDegLon;
    const ay = Number(start.lat) * nmPerDegLat;
    const bx = Number(end.lon) * nmPerDegLon;
    const by = Number(end.lat) * nmPerDegLat;

    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const abLenSq = abx * abx + aby * aby;

    let t = 0;
    if (abLenSq > 0) t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));

    const cx = ax + t * abx;
    const cy = ay + t * aby;
    const dx = px - cx;
    const dy = py - cy;

    return {
      lat: cy / nmPerDegLat,
      lon: cx / nmPerDegLon,
      distanceNm: Math.sqrt(dx * dx + dy * dy),
    };
  }

  function bearingDeg(lat1, lon1, lat2, lon2) {
    const phi1 = toRad(lat1);
    const phi2 = toRad(lat2);
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function formatEta(minutes) {
    const totalSeconds = Math.max(0, Math.round(Number(minutes) * 60));
    const mm = Math.floor(totalSeconds / 60);
    const ss = totalSeconds % 60;
    return String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
  }

  function toRad(deg) { return (Number(deg) * Math.PI) / 180; }
  function toDeg(rad) { return (Number(rad) * 180) / Math.PI; }
})();
