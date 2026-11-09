'use strict';
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const createEngine = require('../../../notamengine.js');
const history = require('../../../notam-history.js');
const { createHash } = require('node:crypto');
// Adapter only: server and browser share the exact NOTAM engine rather than two field mappings.
class ServerDOMParser {
  parseFromString(xml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid or unsupported PIB XML');
    const tree = new XMLParser({ preserveOrder: true, ignoreAttributes: false, removeNSPrefix: true,
      parseTagValue: false, trimValues: false }).parse(xml);
    const all = [];
    function children(nodes) {
      const result = [];
      for (const node of nodes) {
        for (const name of Object.keys(node)) {
          if (name === ':@' || name.startsWith('?') || name.startsWith('#')) continue;
          const contents = Array.isArray(node[name]) ? node[name] : [];
          const attrs = node[':@'] || {};
          const el = { localName: name, nodeName: name, getAttribute: key => attrs['@_' + key] || '' };
          all.push(el);
          const list = children(contents);
          el.firstElementChild = list[0] || null;
          list.forEach((child, i) => { child.nextElementSibling = list[i + 1] || null; });
          // Preserve the XML document order, including text surrounding nested elements.
          let index = 0;
          el.textContent = contents.map(part => part['#text'] != null ? String(part['#text']) : Object.keys(part).filter(k => k !== ':@' && !k.startsWith('?') && !k.startsWith('#')).map(() => list[index++]?.textContent || '').join('')).join('');
          result.push(el);
        }
      }
      return result;
    }
    const roots = children(tree);
    return { documentElement: roots[0], getElementsByTagName: name => name === '*' ? all : all.filter(el => el.localName === name) };
  }
}
const engine = createEngine({ DOMParser: ServerDOMParser, FFAPP_NOTAM_HISTORY: history });
function buildSnapshot(xml, { checkedAt, lastModified = '' } = {}) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 25 * 1024 * 1024) throw new Error('PIB XML exceeds snapshot limit');
  if (!Number.isFinite(Date.parse(checkedAt))) throw new Error('Snapshot needs a valid server check time');
  const dataset = engine.parsePibXml(xml);
  // Keep source evidence/operational fields; omit a derivable per-record diagnostic object.
  dataset.notams.forEach(record => { delete record.cancellationVerification; });
  function time(tag) { const value = xml.match(new RegExp('<(?:[\\w.-]+:)?' + tag + '>\\s*([^<]+)\\s*</(?:[\\w.-]+:)?' + tag + '>', 'i')); return value ? value[1].trim() : ''; }
  const issued = time('Issued'), validTo = time('ValidTo');
  if (!Number.isFinite(Date.parse(issued)) || !Number.isFinite(Date.parse(validTo))) throw new Error('Snapshot requires PIB issue and validity timestamps');
  dataset.meta = { ...dataset.meta, liveFeed: true, prepared: true, feedCheckedAt: checkedAt, pibIssued: issued, pibValidTo: validTo, natsLastModified: lastModified };
  // ImportedAt is preparation time, not part of the stable source identity.
  const revision = createHash('sha256').update(xml).digest('hex');
  return { schema: 'fisofid-pib-snapshot-v1', revision, checkedAt, issued, validTo, dataset };
}
module.exports = { buildSnapshot, ServerDOMParser };
