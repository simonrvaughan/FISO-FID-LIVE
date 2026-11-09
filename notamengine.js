"use strict";

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.FFAPP_NOTAM_ENGINE = factory(root);
})(typeof window === "object" ? window : globalThis, function (window) {
  var ENGINE_VERSION = "448.0-prepared-pib-engine";

  function normaliseWhitespace(s) {
    return String(s || "")
      .replace(/\u00a0/g, " ")
      // Release237: PDF text extraction may preserve typographic dash glyphs in D) schedules (e.g. SS–SR).
      // Canonicalise them before field parsing so solar schedules are operational, not just display text.
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
      .replace(/[ \t]+\r?\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normaliseCode(code) {
    return String(code || "")
      .toUpperCase()
      .replace(/[^A-Z0-9/]/g, "")
      .trim();
  }

  function codeVariants(input) {
    var raw = normaliseCode(input);
    if (!raw) return [];
    var variants = [raw];
    var m = raw.match(/^([A-Z]?)(\d{3,4})(?:\/(\d{2}))?$/);
    if (m) {
      var prefix = m[1] || "";
      var num = m[2];
      var yr = m[3] || "";
      if (yr) {
        variants.push(prefix + num + "/" + yr);
        variants.push(num + "/" + yr);
      }
      variants.push(prefix + num);
      variants.push(num);
    }
    return Array.from(new Set(variants));
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function waitForPdfJs(timeoutMs) {
    timeoutMs = timeoutMs || 20000;
    return new Promise(function (resolve, reject) {
      if (window.__pdfjsLib) return resolve(window.__pdfjsLib);
      // Release 294: start the heavy PDF engine only when a PDF is actually used.
      if (typeof window.ffappLoadPdfJs === "function") {
        window.ffappLoadPdfJs().catch(function () { /* timeout/error below gives the user-facing message */ });
      }
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error("PDF engine did not load. Check internet access for PDF.js."));
      }, timeoutMs);
      window.addEventListener(
        "pdfjs-ready",
        function () {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(window.__pdfjsLib);
        },
        { once: true },
      );
    });
  }

  function pageItemsToText(items) {
    var sorted = (items || []).slice().sort(function (a, b) {
      var yDiff = b.transform[5] - a.transform[5];
      if (Math.abs(yDiff) > 2) return yDiff;
      return a.transform[4] - b.transform[4];
    });
    var lines = [];
    var current = null;
    var currentY = null;
    var THRESH = 2;
    sorted.forEach(function (it) {
      var y = it.transform[5];
      if (!current || Math.abs(y - currentY) > THRESH) {
        current = [];
        lines.push(current);
        currentY = y;
      }
      current.push(it);
    });
    return lines
      .map(function (line) {
        line.sort(function (a, b) {
          return a.transform[4] - b.transform[4];
        });
        var out = "";
        var lastEnd = null;
        line.forEach(function (it) {
          var x = it.transform[4];
          var str = it.str || "";
          if (lastEnd !== null && x - lastEnd > 2.5 && out && !/\s$/.test(out)) out += " ";
          out += str;
          lastEnd = x + (it.width || str.length * 4);
        });
        return out.trimEnd();
      })
      .join("\n");
  }

  async function extractPdfText(file, onProgress) {
    if (!file) throw new Error("No PDF selected.");
    if (!/\.pdf$/i.test(file.name || "") && file.type !== "application/pdf") {
      throw new Error("Selected file is not a PDF.");
    }
    var pdfjsLib = await waitForPdfJs();
    var buffer = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    var pages = [];
    var pageByNotam = {};
    function safeNotamPageKey(id) {
      return String(id || "").toUpperCase().trim().replace(/[.#$\[\]\/]/g, "_");
    }
    for (var i = 1; i <= pdf.numPages; i++) {
      var page = await pdf.getPage(i);
      var content = await page.getTextContent();
      var pageText = pageItemsToText(content.items);
      pages.push(pageText);
      var ids = pageText.match(/\b[A-Z]\d{3,4}\/\d{2}\b/g) || [];
      ids.forEach(function(id) {
        id = String(id || "").toUpperCase();
        var safeId = safeNotamPageKey(id);
        if (safeId && !pageByNotam[safeId]) pageByNotam[safeId] = i;
      });
      if (onProgress) onProgress({ page: i, pages: pdf.numPages });
    }
    return { text: normaliseWhitespace(pages.join("\n")), pages: pdf.numPages, pageByNotam: pageByNotam };
  }

  function extractMeta(text, fileName, pages) {
    var dateTime = text.match(/Date:\s*(\d{2}\s+[A-Z]{3}\s+\d{4})\s+Time:\s*(\d{2}:\d{2})\s*UTC/i);
    var validity = text.match(/VALIDITY\s*\(UTC\):[\s\S]{0,140}?([0-9]{2}\s+[A-Z]{3}\s+[0-9]{4}\s+[0-9]{2}:[0-9]{2}\s*-\s*[0-9]{2}\s+[A-Z]{3}\s+[0-9]{4}\s+[0-9]{2}:[0-9]{2})/i);
    var report = text.match(/Report reference no:\s*([A-Z0-9]+)/i);
    var heightBlock = text.match(/Height Limits\s*\(lower\/upper\):([\s\S]{0,260}?)(?=PIB includes:|Contents:|Briefing Type:|ADEP:|FIR:|AERODROMES|$)/i);
    var heightLimits = "";
    var heightLower = "";
    var heightUpper = "";
    if (heightBlock) {
      var hb = heightBlock[1].replace(/\s+/g, " ");
      var hm = hb.match(/First:\s*(\d{3})\s*\/\s*(\d{3})/i) || hb.match(/(\d{3})\s*\/\s*(\d{3})/);
      if (hm) {
        heightLower = hm[1];
        heightUpper = hm[2];
        heightLimits = "Lower: " + heightLower + ". Upper: " + heightUpper;
      } else {
        heightLimits = hb.replace(/Flight Rules:.*?(?=First:|$)/i, "").replace(/\s*\/\s*/g, "/").trim();
      }
    }
    return {
      engineVersion: ENGINE_VERSION,
      sourceFile: fileName || "PIB.pdf",
      reportReference: report ? report[1].trim() : "",
      pibDate: dateTime ? dateTime[1].toUpperCase() : "",
      pibTime: dateTime ? dateTime[2] + " UTC" : "",
      validity: validity ? validity[1].replace(/\s+/g, " ").trim().toUpperCase() : "",
      heightLimits: heightLimits,
      heightLower: heightLower,
      heightUpper: heightUpper,
      pages: pages || null,
      importedAt: new Date().toISOString(),
      notamCount: 0,
    };
  }

  function parseQLine(qLine) {
    var fields = String(qLine || "").split("/").map(function (s) { return s.trim(); });
    var out = { fir: "", code: "", lower: "", upper: "", qCoord: "", lat: null, lon: null, radiusNm: null };
    if (fields.length >= 1) out.fir = fields[0] || "";
    if (fields.length >= 2) out.code = fields[1] || "";
    if (fields.length >= 7) {
      out.lower = fields[5] || "";
      out.upper = fields[6] || "";
    }
    if (fields.length >= 8) {
      out.qCoord = fields[7] || "";
      var m = out.qCoord.match(/^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])(\d{3})$/);
      if (m) {
        var lat = parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
        var lon = parseInt(m[4], 10) + parseInt(m[5], 10) / 60;
        if (m[3] === "S") lat = -lat;
        if (m[6] === "W") lon = -lon;
        out.lat = lat;
        out.lon = lon;
        out.radiusNm = parseInt(m[7], 10);
      }
    }
    return out;
  }

  function getField(block, letter) {
    var next = "QABCDEFG".split("").filter(function (x) { return x !== letter; }).join("");
    var re = new RegExp("(?:^|\\s)" + letter + "\\)\\s*([\\s\\S]*?)(?=\\n\\s*[" + next + "]\\)|\\s+[" + next + "]\\)|\\n\\s*Page\\s+\\d+\\s+of|$)", "i");
    var m = block.match(re);
    return m ? normaliseWhitespace(m[1]).replace(/\n/g, " ").trim() : "";
  }

  // DEV468: old prepared/device snapshots may contain D) parsed from AD).
  // Repair from the original fielded text; never discard a genuine D) field.
  var preparedSchedules = new WeakMap();
  function repairPreparedSchedule(n) {
    if (!n || !/^E\)\s*/im.test(n.raw || "")) return n;
    if (preparedSchedules.has(n)) return preparedSchedules.get(n);
    var d = getField(normaliseWhitespace(n.raw), "D");
    var repaired = d === String(n.d || "") ? n : Object.assign({}, n, { d: d });
    preparedSchedules.set(n, repaired);
    return repaired;
  }

  function parseNotamBlock(block, index) {
    var clean = normaliseWhitespace(block)
      .replace(/\n?Page\s+\d+\s+of\s+\d+\s*$/i, "")
      .trim();
    var firstLine = (clean.split("\n")[0] || "").trim();
    var qMatch = firstLine.match(/^Q\)\s*(.*?)\s+([A-Z]\d{3,4}\/\d{2})\s*$/i);
    var legacyId = clean.match(/([A-Z]\d{3,4}\/\d{2})\s+NOTAM([NRC])/i);
    var notamId = qMatch ? qMatch[2].toUpperCase() : legacyId ? legacyId[1].toUpperCase() : "UNKNOWN-" + index;
    var cancelHeader = clean.match(/(?:^|\n|\()\s*([A-Z]\d{3,4}\/\d{2})\s+NOTAMC\s+([A-Z]\d{3,4}\/\d{2})\b/i);
    var cancelledNotamId = cancelHeader ? cancelHeader[2].toUpperCase() : "";
    if (cancelHeader && notamId.indexOf("UNKNOWN") === 0) notamId = cancelHeader[1].toUpperCase();
    var qLine = qMatch ? qMatch[1].trim().toUpperCase() : getField(clean, "Q").replace(/\s+[A-Z]\d{3,4}\/\d{2}\s*$/, "").toUpperCase();
    var q = parseQLine(qLine);
    var a = getField(clean, "A").toUpperCase();
    var icaoM = a.match(/[A-Z]{4}/);
    var b = getField(clean, "B");
    var c = getField(clean, "C");
    var d = getField(clean, "D");
    var e = getField(clean, "E");
    var f = getField(clean, "F");
    var g = getField(clean, "G");
    return {
      id: notamId.replace("/", "-"),
      notamId: notamId,
      type: cancelHeader ? "C" : legacyId ? legacyId[2].toUpperCase() : "",
      cancelledNotamId: cancelledNotamId,
      qLine: qLine,
      fir: q.fir,
      icao: icaoM ? icaoM[0] : "",
      a: a,
      b: b,
      c: c,
      d: d,
      eText: e,
      f: f,
      g: g,
      raw: clean,
      lat: q.lat,
      lon: q.lon,
      radiusNm: q.radiusNm,
      lower: q.lower,
      upper: q.upper,
    };
  }

  function splitNatsPibNotams(text) {
    var src = normaliseWhitespace(text).replace(/\nPage\s+\d+\s+of\s+\d+/gi, "\n");
    var re = /^\s*Q\).*?\s+[A-Z]\d{3,4}\/\d{2}\s*$/gim;
    var starts = [];
    var m;
    while ((m = re.exec(src)) !== null) starts.push(m.index);
    var blocks = [];
    for (var i = 0; i < starts.length; i++) {
      var end = i + 1 < starts.length ? starts[i + 1] : src.length;
      var block = src.slice(starts[i], end).trim();
      if (/^Q\)/i.test(block)) blocks.push(block);
    }
    return blocks;
  }

  function parsePibText(text, fileName, pages) {
    var meta = extractMeta(text, fileName, pages);
    var blocks = splitNatsPibNotams(text);
    var seen = Object.create(null);
    var notams = [];
    blocks.forEach(function (block, idx) {
      var rec = parseNotamBlock(block, idx + 1);
      if (!rec.notamId || rec.notamId.indexOf("UNKNOWN") === 0) return;
      seen[rec.notamId] = rec;
    });
    notams = Object.keys(seen).sort().map(function (k) { return seen[k]; });
    meta.notamCount = notams.length;
    return { meta: meta, notams: notams };
  }

  function buildIndex(dataset) {
    var byCode = Object.create(null);
    var byIcao = Object.create(null);
    (dataset && dataset.notams ? dataset.notams : []).forEach(function (n) {
      byCode[normaliseCode(n.notamId)] = n;
      var noPrefix = n.notamId.replace(/^[A-Z]/, "");
      byCode[normaliseCode(noPrefix)] = n;
      byCode[normaliseCode(n.notamId.replace(/\/\d{2}$/, ""))] = n;
      if (n.icao) {
        if (!byIcao[n.icao]) byIcao[n.icao] = [];
        byIcao[n.icao].push(n);
      }
    });
    return { byCode: byCode, byIcao: byIcao };
  }

  function findByCode(dataset, input, preparedIndex) {
    // Callers processing a dataset in a batch can reuse its index; default stays fresh.
    var idx = (preparedIndex || buildIndex(dataset)).byCode;
    var vars = codeVariants(input);
    for (var i = 0; i < vars.length; i++) {
      if (idx[normaliseCode(vars[i])]) return idx[normaliseCode(vars[i])];
    }
    return null;
  }

  function suggestions(dataset, input, limit) {
    limit = limit || 12;
    var raw = String(input || "").trim();
    if (!raw || !dataset || !Array.isArray(dataset.notams)) return [];

    // 1) NOTAM code matches (original behaviour)
    var q = normaliseCode(raw);
    var stripped = q ? q.replace(/^[A-Z]/, "") : "";
    var codeMatches = q
      ? dataset.notams.filter(function (n) {
          var code = normaliseCode(n.notamId);
          return code.indexOf(q) !== -1 || (stripped && code.replace(/^[A-Z]/, "").indexOf(stripped) !== -1);
        })
      : [];
    if (codeMatches.length >= limit) return codeMatches.slice(0, limit);

    // 2) Keyword matches across the NOTAM body (E line, aerodrome, D line,
    //    Q line). Every space-separated word must appear somewhere.
    var words = raw.toLowerCase().split(/\s+/).filter(Boolean);
    var kwMatches = dataset.notams.filter(function (n) {
      if (codeMatches.indexOf(n) !== -1) return false;
      var hay = (
        (n.eText || "") + " " + (n.icao || "") + " " + (n.d || "") + " " + (n.qLine || "")
      ).toLowerCase();
      return words.every(function (w) {
        return hay.indexOf(w) !== -1;
      });
    });
    return codeMatches.concat(kwMatches).slice(0, limit);
  }

  async function importPdf(file, onProgress) {
    var extracted = await extractPdfText(file, onProgress);
    var dataset = parsePibText(extracted.text, file.name, extracted.pages);
    dataset.rawText = extracted.text;
    var pageByNotam = extracted.pageByNotam || {};
    function safeNotamPageKey(id) {
      return String(id || "").toUpperCase().trim().replace(/[.#$\[\]\/]/g, "_");
    }
    // Release143: persist the full NOTAM -> PDF page map with the PIB dataset
    // so the shared Firebase copy can retain provenance even if individual
    // NOTAM records are transformed by another consumer.
    dataset.pageByNotam = pageByNotam;
    (dataset.notams || []).forEach(function(n) {
      if (n) {
        var pageKey = safeNotamPageKey(n.notamId);
        if (pageKey && pageByNotam[pageKey]) n.sourcePage = pageByNotam[pageKey];
      }
    });
    return dataset;
  }


  // DEV404: parser for the actual NATS PIB.xml <Notam> schema.
  // Example: <Notam><Series>H</Series><Number>6048</Number><Year>26</Year>...
  function parsePibXml(xmlText) {
    var src = String(xmlText || "").trim();
    if (!src) throw new Error("NATS PIB XML was empty.");
    var doc = new (window.DOMParser || DOMParser)().parseFromString(src, "application/xml");
    var pe = doc.getElementsByTagName("parsererror");
    if (pe && pe.length) throw new Error("NATS PIB XML could not be parsed.");

    function lname(el){ return String(el && (el.localName || el.nodeName) || "").replace(/^.*:/, "").toLowerCase(); }
    function clean(v){ return normaliseWhitespace(String(v || "").replace(/\u00a0/g, " ")).trim(); }
    function directChild(root, name){
      name=String(name||"").toLowerCase();
      for(var c=root.firstElementChild;c;c=c.nextElementSibling) if(lname(c)===name) return clean(c.textContent||"");
      return "";
    }
    function directElement(root, name){
      name=String(name||"").toLowerCase();
      for(var c=root.firstElementChild;c;c=c.nextElementSibling) if(lname(c)===name) return c;
      return null;
    }
    function pad3(v){ var n=String(v==null?"":v).replace(/\D/g,""); return n ? n.padStart(3,"0").slice(-3) : "000"; }
    function padRadius(v){ var n=String(v==null?"":v).replace(/\D/g,""); return n ? n.padStart(3,"0").slice(-3) : "000"; }
    function buildRecord(root, idx){
      var series=directChild(root,"Series").toUpperCase();
      var number=directChild(root,"Number").replace(/\D/g,"");
      var year=directChild(root,"Year").replace(/\D/g,"").slice(-2);
      if(!series || !number || !year) return null;
      var id=series + number.padStart(4,"0") + "/" + year;
      var qel=directElement(root,"QLine");
      var fir=qel?directChild(qel,"FIR").toUpperCase():"";
      var code23=qel?directChild(qel,"Code23").toUpperCase():"";
      var code45=qel?directChild(qel,"Code45").toUpperCase():"";
      var traffic=qel?directChild(qel,"Traffic").toUpperCase():"";
      var purpose=qel?directChild(qel,"Purpose").toUpperCase():"";
      var scope=qel?directChild(qel,"Scope").toUpperCase():"";
      var lower=qel?directChild(qel,"Lower"):"";
      var upper=qel?directChild(qel,"Upper"):"";
      var coord=directChild(root,"Coordinates").toUpperCase().replace(/\s+/g,"");
      var radius=directChild(root,"Radius");
      var qcode="Q" + code23 + code45;
      var qline=[fir,qcode,traffic,purpose,scope,pad3(lower),pad3(upper),coord+padRadius(radius)].join("/");
      var a=directChild(root,"ItemA").toUpperCase();
      var b=directChild(root,"StartValidity");
      var c=directChild(root,"EndValidity");
      var d=directChild(root,"ItemD") || directChild(root,"Schedule");
      var e=directChild(root,"ItemE");
      var f=directChild(root,"ItemF");
      var g=directChild(root,"ItemG");
      var classic="Q) "+qline+" "+id+"\nA) "+a+"\nB) "+b+"\nC) "+c+(d?"\nD) "+d:"")+"\nE) "+e+(f?"\nF) "+f:"")+(g?"\nG) "+g:"");
      var rec=parseNotamBlock(classic,idx+1);
      if(!rec) return null;
      // DEV447: replacement references are not cancellation evidence. Preserve source text.
      var xmlType=directChild(root,"Type").toUpperCase().replace(/^NOTAM/,"");
      var cancelRef = ["CancelledNotam", "CancelledNotamId", "CancelledNOTAMNumber", "Cancels"].map(function(k){return directChild(root,k);}).filter(Boolean)[0] || "";
      var embedded = directChild(root,"NotamText") || directChild(root,"Text") || "";
      var evidence=window.FFAPP_NOTAM_HISTORY;
      var checked=evidence.verifyCancellation({notamId:id,type:xmlType,cancelledNotamId:cancelRef,raw:embedded});
      rec.cancelledNotamId=cancelRef || checked.cancelledNotamId || "";
      rec.cancellationVerification=checked;
      rec.notamId=id; rec.id=id.replace("/","-"); rec.type=xmlType || (checked.verified?"C":"");
      rec.raw=embedded ? embedded+"\n"+classic : classic;
      rec.nof=directChild(root,"NOF").toUpperCase(); rec.pibSection=String(root.getAttribute("PIBSection")||"").toUpperCase();
      rec.marker=directChild(root,"Marker"); rec.notamStoreDate=directChild(root,"NotamStoreDate");
      return rec;
    }

    var all=doc.getElementsByTagName("*"), roots=[];
    for(var i=0;i<all.length;i++) if(lname(all[i])==="notam") roots.push(all[i]);
    if(!roots.length) throw new Error("NATS PIB XML contained no <Notam> elements.");
    var seen=Object.create(null), notams=[];
    roots.forEach(function(root,idx){ var rec=buildRecord(root,idx); if(rec&&rec.notamId&&!seen[rec.notamId]){seen[rec.notamId]=1;notams.push(rec);} });
    if(!notams.length) throw new Error("NATS PIB XML contained "+roots.length+" <Notam> elements but none could be converted.");
    notams.sort(function(x,y){return String(x.notamId).localeCompare(String(y.notamId));});
    var meta=extractMeta(clean(doc.documentElement.textContent||""),"NATS PIB.xml",null);
    meta.source="NATS live PIB XML"; meta.sourceUrl="https://pibs.nats.co.uk/operational/pibs/PIB.xml"; meta.notamCount=notams.length; meta.importedAt=new Date().toISOString();
    return {meta:meta,notams:notams};
  }

  return {
    version: ENGINE_VERSION,
    repairPreparedSchedule: repairPreparedSchedule,
    importPdf: importPdf,
    parsePibText: parsePibText,
    parsePibXml: parsePibXml,
    findByCode: findByCode,
    suggestions: suggestions,
    buildIndex: buildIndex,
    normaliseCode: normaliseCode,
  };
});
