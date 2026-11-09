"use strict";

/*
  FISO FID - Geometry Engine
  Used by HAZDAM and future airspace/hazard engines.
*/

window.FISO_GEOMETRY = {
  pointInPolygon,
  distanceNm,
  dmsToDecimal,
  convertCoordinateList,
};

function pointInPolygon(point, polygon) {
  const lat = Number(point.lat);
  const lon = Number(point.lon);

  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = Number(polygon[i][0]);
    const xi = Number(polygon[i][1]);
    const yj = Number(polygon[j][0]);
    const xj = Number(polygon[j][1]);

    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function distanceNm(a, b) {
  const R_NM = 3440.065;

  const lat1 = toRad(Number(a.lat));
  const lat2 = toRad(Number(b.lat));
  const dLat = toRad(Number(b.lat) - Number(a.lat));
  const dLon = toRad(Number(b.lon) - Number(a.lon));

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R_NM * Math.asin(Math.sqrt(h));
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}
function dmsToDecimal(token) {
  const m = String(token)
    .trim()
    .match(/^(\d{2})(\d{2})(\d{2})([NS])(\d{3})(\d{2})(\d{2})([EW])$/);

  if (!m) throw new Error("Invalid coordinate: " + token);

  let lat = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
  let lon = Number(m[5]) + Number(m[6]) / 60 + Number(m[7]) / 3600;

  if (m[4] === "S") lat = -lat;
  if (m[8] === "W") lon = -lon;

  return [lat, lon];
}

function convertCoordinateList(list) {
  return list.map(dmsToDecimal);
}
