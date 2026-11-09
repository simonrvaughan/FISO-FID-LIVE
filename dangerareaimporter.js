"use strict";

/*
  FFApp / FISO FID - Danger Area Importer
  Release 037

  Purpose:
  - Import UK AIP ENR 5.1 danger area text pasted by the user.
  - Store imported danger areas in browser localStorage.
  - Merge imported areas into window.FISO_DATA.dangerAreas before HAZDAM starts.

  Notes:
  - Polygon areas are imported from listed coordinate vertices.
  - Simple circle areas are approximated as 48-point polygons.
  - Arc descriptions are imported using their listed vertices and flagged as approximate.
  - FBZ / flight-planning buffer zones are excluded by default.
*/

(function () {
  const LS_KEY = "ffapp_imported_danger_areas_v1";
  const SOURCE_LABEL = "User import from UK AIP ENR 5.1 text";

  const state = {
    imported: loadImported(),
    lastPreview: [],
  };

  window.FISO_DANGER_IMPORTER = {
    parseDangerAreasFromText,
    mergeImportedAreas,
    getImportedAreas: () => Object.assign({}, state.imported),
    clearImportedAreas,
  };

  mergeImportedAreas();

  document.addEventListener("DOMContentLoaded", initImporterPanel);

  function loadImported() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      console.warn("Danger area importer: failed to load imported areas", e);
      return {};
    }
  }

  function saveImported() {
    localStorage.setItem(LS_KEY, JSON.stringify(state.imported));
  }

  function clearImportedAreas() {
    state.imported = {};
    localStorage.removeItem(LS_KEY);
    mergeImportedAreas();
  }

  function mergeImportedAreas() {
    window.FISO_DATA = window.FISO_DATA || {};
    window.FISO_DATA.dangerAreas = window.FISO_DATA.dangerAreas || {};
    Object.keys(state.imported).forEach((id) => {
      const area = state.imported[id];
      if (area && Array.isArray(area.coords) && area.coords.length >= 3) {
        window.FISO_DATA.dangerAreas[id] = area;
      }
    });
  }

  function initImporterPanel() {
    const panel = document.getElementById("hazdamImporterPanel");
    if (!panel) return;

    panel.innerHTML = `
      <div class="haz-importer">
        <p class="hint">Paste text copied from UK AIP ENR 5.1, or load a plain-text export. Imported areas are saved in this browser and appear after reload.</p>
        <div class="field">
          <label for="hazImportFile">Optional text file</label>
          <input type="file" id="hazImportFile" accept=".txt,text/plain">
        </div>
        <div class="field">
          <label for="hazImportText">ENR 5.1 danger area text</label>
          <textarea id="hazImportText" rows="7" placeholder="Paste ENR 5.1 text here, e.g. EG D044 LYDD RANGES ..."></textarea>
        </div>
        <div class="field haz-importer-options">
          <label><input type="checkbox" id="hazImportIncludeFbz" style="width:auto;margin-right:6px;">Include FBZ / Z buffer areas</label>
          <label><input type="checkbox" id="hazImportReplace" checked style="width:auto;margin-right:6px;">Replace existing areas with same identifier</label>
        </div>
        <div class="btn-row">
          <button class="btn" id="hazImportPreview">Preview</button>
          <button class="btn primary" id="hazImportSave">Import & Reload</button>
          <button class="btn danger" id="hazImportClear">Clear Imported</button>
        </div>
        <p class="hint" id="hazImportStatus">Imported areas stored: ${Object.keys(state.imported).length}</p>
        <div id="hazImportPreviewList" class="haz-import-preview"></div>
      </div>
    `;

    const file = document.getElementById("hazImportFile");
    const text = document.getElementById("hazImportText");
    const preview = document.getElementById("hazImportPreview");
    const save = document.getElementById("hazImportSave");
    const clear = document.getElementById("hazImportClear");

    file?.addEventListener("change", () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        text.value = String(reader.result || "");
        runPreview();
      };
      reader.readAsText(f);
    });

    preview?.addEventListener("click", runPreview);
    save?.addEventListener("click", importAndReload);
    clear?.addEventListener("click", () => {
      if (!confirm("Clear all browser-imported danger areas? Built-in areas will remain.")) return;
      clearImportedAreas();
      setStatus("Imported areas cleared. Reloading…");
      setTimeout(() => location.reload(), 300);
    });
  }

  function runPreview() {
    const text = document.getElementById("hazImportText")?.value || "";
    const includeFbz = !!document.getElementById("hazImportIncludeFbz")?.checked;
    const result = parseDangerAreasFromText(text, { includeFbz });
    state.lastPreview = result.areas;
    renderPreview(result);
  }

  function importAndReload() {
    const text = document.getElementById("hazImportText")?.value || "";
    const includeFbz = !!document.getElementById("hazImportIncludeFbz")?.checked;
    const replaceExisting = !!document.getElementById("hazImportReplace")?.checked;
    const result = parseDangerAreasFromText(text, { includeFbz });

    if (!result.areas.length) {
      renderPreview(result);
      setStatus("No importable danger areas found.", true);
      return;
    }

    const builtIn = (window.FISO_DATA && window.FISO_DATA.dangerAreas) || {};
    let importedCount = 0;
    let skippedCount = 0;

    result.areas.forEach((area) => {
      if (!replaceExisting && (builtIn[area.id] || state.imported[area.id])) {
        skippedCount += 1;
        return;
      }
      state.imported[area.id] = area;
      importedCount += 1;
    });

    saveImported();
    setStatus(`Imported ${importedCount} area(s). Skipped ${skippedCount}. Reloading…`);
    setTimeout(() => location.reload(), 500);
  }

  function renderPreview(result) {
    const box = document.getElementById("hazImportPreviewList");
    if (!box) return;

    const warnings = result.warnings.length
      ? `<div class="haz-import-warnings"><b>Warnings</b><br>${result.warnings.slice(0, 12).map(safe).join("<br>")}${result.warnings.length > 12 ? "<br>…" : ""}</div>`
      : "";

    if (!result.areas.length) {
      box.innerHTML = `${warnings}<p class="empty-note">No importable danger areas found.</p>`;
      setStatus("No importable danger areas found.", true);
      return;
    }

    box.innerHTML = `
      ${warnings}
      <div class="haz-import-summary">Preview: ${result.areas.length} area(s)</div>
      ${result.areas.slice(0, 20).map((a) => `
        <div class="haz-import-row">
          <b>${safe(a.display)}</b> ${safe(a.name)}<br>
          <span>${safe(a.lower)} – ${safe(a.upper)} · ${a.coords.length} vertices${a.approximate ? " · approximate" : ""}</span>
        </div>
      `).join("")}
      ${result.areas.length > 20 ? `<p class="hint">Showing first 20 of ${result.areas.length}.</p>` : ""}
    `;
    setStatus(`Preview found ${result.areas.length} importable area(s).`);
  }

  function setStatus(message, error) {
    const el = document.getElementById("hazImportStatus");
    if (!el) return;
    el.textContent = message;
    el.style.color = error ? "var(--red)" : "var(--text-dim)";
  }

  function parseDangerAreasFromText(input, options) {
    const includeFbz = !!(options && options.includeFbz);
    const text = normaliseText(input);
    const warnings = [];
    const areas = [];

    if (!text.trim()) return { areas, warnings: ["No text supplied."] };

    const matches = [];
    const re = /(?:^|\n)\s*(EG\s+D\d{3}[A-Z0-9]*)(?:\s+([^\n]*))?/g;
    let m;
    while ((m = re.exec(text))) {
      matches.push({ index: m.index, code: m[1], nameLine: (m[2] || "").trim() });
    }

    matches.forEach((match, i) => {
      const nextIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const block = text.slice(match.index, nextIndex).trim();
      const parsed = parseDangerAreaBlock(match.code, match.nameLine, block, includeFbz, warnings);
      if (parsed) areas.push(parsed);
    });

    if (!matches.length) warnings.push("No EG Dxxx designators found in the supplied text.");
    return { areas, warnings };
  }

  function parseDangerAreaBlock(code, nameLine, block, includeFbz, warnings) {
    const id = normaliseDesignator(code);
    let name = cleanName(nameLine);

    if (!id) return null;
    const isFbz = /Z\d*$/i.test(id) || /\bFBZ\b/i.test(block) || /FLIGHT PLANNING PURPOSES ONLY/i.test(block);
    if (isFbz && !includeFbz) return null;

    if (!name) name = id.replace(/^EGD/, "D");

    const upper = pickLimit(block, "upper") || "UNKNOWN";
    const lower = pickLimit(block, "lower") || "UNKNOWN";
    const remarks = pickRemarks(block);
    const service = pickLine(block, "Service") || "";
    const contact = pickLine(block, "Contact") || "";
    const authority = pickAuthority(block) || "";

    const circle = parseCircle(block);
    let coords = [];
    let approximate = false;

    if (circle) {
      coords = circleToPolygon(circle.center, circle.radiusNm, 48);
      approximate = true;
    } else {
      const tokens = extractCoordinateTokens(block);
      coords = tokens.map(dmsToDecimal).filter(Boolean);
      if (coords.length >= 3) {
        if (!samePoint(coords[0], coords[coords.length - 1])) coords.push(coords[0].slice());
        if (/\barc\b|clockwise|anti\s*clockwise|anti-clockwise/i.test(block)) approximate = true;
      }
    }

    if (coords.length < 3) {
      warnings.push(`${id}: skipped - insufficient usable coordinates.`);
      return null;
    }

    const validation = validateCoords(id, coords);
    if (validation) warnings.push(validation);

    return {
      id,
      type: "dangerArea",
      group: id.match(/^EGD(\d{3})/) ? "D" + id.match(/^EGD(\d{3})/)[1] : "DANGER",
      name,
      display: id.replace(/^EG/, ""),
      lower,
      upper,
      authority,
      service,
      contact,
      officialRemarks: remarks,
      source: SOURCE_LABEL,
      imported: true,
      approximate,
      geometryType: circle ? "circle" : "polygon",
      circleCenter: circle ? circle.center.slice() : null,
      circleRadiusNm: circle ? circle.radiusNm : null,
      coords,
    };
  }

  function normaliseText(input) {
    return String(input || "")
      .replace(/\r/g, "")
      .replace(/[‐‑‒–—]/g, "-")
      .replace(/\u00a0/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n");
  }

  function normaliseDesignator(code) {
    const m = String(code || "").toUpperCase().match(/EG\s*D\s*(\d{3}[A-Z0-9]*)/);
    return m ? "EGD" + m[1] : "";
  }

  function cleanName(name) {
    return String(name || "")
      .replace(/\s+/g, " ")
      .replace(/Upper limit:.*/i, "")
      .trim()
      .toUpperCase();
  }

  function pickLimit(block, kind) {
    const re = kind === "upper" ? /Upper\s+limit:\s*([^\n]+)/i : /Lower\s+limit:\s*([^\n]+)/i;
    const m = block.match(re);
    return m ? m[1].trim().replace(/\s+/g, " ") : "";
  }

  function pickLine(block, label) {
    const re = new RegExp(label + ":\\s*([^\\n]+)", "i");
    const m = block.match(re);
    return m ? m[1].trim().replace(/\s+/g, " ") : "";
  }

  function pickAuthority(block) {
    const m = block.match(/Danger\s+Area\s+Authority:\s*([^\n]+)/i);
    return m ? m[1].trim().replace(/\s+/g, " ") : "";
  }

  function pickRemarks(block) {
    const parts = [];
    ["Activity", "Hours", "Remarks"].forEach((label) => {
      const line = pickLine(block, label);
      if (line) parts.push(`${label}: ${line}`);
    });
    return parts.join(" | ");
  }

  function extractCoordinateTokens(block) {
    const seen = new Set();
    const out = [];
    const re = /(\d{6}[NS])\s*(\d{7}[EW])/gi;
    let m;
    while ((m = re.exec(block))) {
      const token = (m[1] + m[2]).toUpperCase();
      if (!seen.has(token)) {
        seen.add(token);
        out.push(token);
      }
    }
    return out;
  }

  function parseCircle(block) {
    const re = /A\s+circle,\s*([\d.]+)\s*(NM|M|METRE|METRES|METER|METERS)\s+radius,\s*cent(?:red|ered)\s+at\s+(\d{6}[NS])\s*(\d{7}[EW])/i;
    const m = block.match(re);
    if (!m) return null;
    const radiusValue = Number(m[1]);
    if (!Number.isFinite(radiusValue) || radiusValue <= 0) return null;
    const unit = m[2].toUpperCase();
    const radiusNm = unit === "NM" ? radiusValue : radiusValue / 1852;
    return { radiusNm, center: dmsToDecimal((m[3] + m[4]).toUpperCase()) };
  }

  function circleToPolygon(center, radiusNm, points) {
    const lat = center[0];
    const lon = center[1];
    const out = [];
    const earthRadiusNm = 3440.065;
    const angular = radiusNm / earthRadiusNm;
    const latRad = toRad(lat);
    const lonRad = toRad(lon);

    for (let i = 0; i <= points; i++) {
      const brg = (2 * Math.PI * i) / points;
      const lat2 = Math.asin(Math.sin(latRad) * Math.cos(angular) + Math.cos(latRad) * Math.sin(angular) * Math.cos(brg));
      const lon2 = lonRad + Math.atan2(Math.sin(brg) * Math.sin(angular) * Math.cos(latRad), Math.cos(angular) - Math.sin(latRad) * Math.sin(lat2));
      out.push([round6(toDeg(lat2)), round6(toDeg(lon2))]);
    }
    return out;
  }

  function dmsToDecimal(token) {
    const m = String(token || "").trim().toUpperCase().match(/^(\d{2})(\d{2})(\d{2})([NS])(\d{3})(\d{2})(\d{2})([EW])$/);
    if (!m) return null;
    let lat = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
    let lon = Number(m[5]) + Number(m[6]) / 60 + Number(m[7]) / 3600;
    if (m[4] === "S") lat = -lat;
    if (m[8] === "W") lon = -lon;
    return [round8(lat), round8(lon)];
  }

  function validateCoords(id, coords) {
    for (const p of coords) {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return `${id}: invalid coordinate detected.`;
      if (p[0] < 48 || p[0] > 62 || p[1] < -12 || p[1] > 4) return `${id}: coordinate outside expected UK/near-UK range.`;
    }
    return "";
  }

  function samePoint(a, b) {
    return a && b && Math.abs(a[0] - b[0]) < 1e-8 && Math.abs(a[1] - b[1]) < 1e-8;
  }

  function toRad(v) { return (v * Math.PI) / 180; }
  function toDeg(v) { return (v * 180) / Math.PI; }
  function round6(v) { return Math.round(v * 1e6) / 1e6; }
  function round8(v) { return Math.round(v * 1e8) / 1e8; }

  function safe(value) {
    return String(value ?? "").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  }
})();
