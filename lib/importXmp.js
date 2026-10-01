/**
 * `scry import`: read Adobe Bridge's XMP metadata through an ALLOW-LIST (guarantees G4 and G5).
 *
 * XMP is where Bridge keeps keywords, ratings and labels, inside the file or in a sidecar `.xmp`.
 * The same packet also carries GPS, camera serial numbers, software paths and more. Only five
 * fields are ever copied out: title, description, keywords, rating, label. Everything else in the
 * packet is dropped on the floor, never parsed into anything that is later serialised.
 *
 * Text in a packet is untrusted data: it is stripped of markup and control characters, capped, and
 * never logged by this module (callers print counts, never values).
 */
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

const XMP_START = Buffer.from('<x:xmpmeta');
const XMP_END = Buffer.from('</x:xmpmeta>');
const MAX_PACKET_BYTES = 1024 * 1024;
const SCAN_WINDOW_BYTES = 4 * 1024 * 1024;

const LIMITS = Object.freeze({ title: 200, description: 2000, keyword: 64, keywords: 50, label: 32 });

// Entities are decoded by hand after parsing, so the parser never expands attacker-defined ones.
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
});

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,4});/gi, (whole, body) => {
        if (body[0] === '#') {
            const code = body[1].toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    });
}

/** Plain text only: no markup, no control or format characters (bidi overrides), one line, capped. */
function sanitizeText(value, max) {
    if (typeof value !== 'string') return '';
    const decoded = decodeEntities(value.slice(0, max * 8));
    const plain = decoded
        .replace(/<[^>]{0,2000}>/g, ' ')
        .replace(/[<>]/g, ' ')
        .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return Array.from(plain).slice(0, max).join('');
}

/** The first `<x:xmpmeta>...</x:xmpmeta>` packet in a byte buffer, or null. */
function extractXmpPacket(buf) {
    const start = buf.indexOf(XMP_START);
    if (start < 0) return null;
    const end = buf.indexOf(XMP_END, start);
    if (end < 0) return null;
    const stop = end + XMP_END.length;
    if (stop - start > MAX_PACKET_BYTES) return null;
    return buf.toString('utf8', start, stop);
}

/** Embedded XMP of any container (JPEG, PNG, WebP, TIFF, PSD, PDF/AI): scan the head and tail of the file. */
function readEmbeddedPacket(fd, size) {
    const windowSize = Math.min(size, SCAN_WINDOW_BYTES);
    const head = Buffer.alloc(windowSize);
    fs.readSync(fd, head, 0, windowSize, 0);
    const fromHead = extractXmpPacket(head);
    if (fromHead || size <= windowSize) return fromHead;
    const tail = Buffer.alloc(windowSize);
    fs.readSync(fd, tail, 0, windowSize, size - windowSize);
    return extractXmpPacket(tail);
}

/** Text of an element that may be a string, an object with #text, or an rdf:Alt / rdf:Bag of rdf:li. */
function listItems(node) {
    if (node === undefined || node === null) return [];
    if (typeof node === 'string') return [node];
    if (Array.isArray(node)) return node.flatMap(listItems);
    if (typeof node !== 'object') return [];
    if (node['rdf:li'] !== undefined) return listItems(node['rdf:li']);
    for (const container of ['rdf:Alt', 'rdf:Bag', 'rdf:Seq']) {
        if (node[container] !== undefined) return listItems(node[container]);
    }
    return typeof node['#text'] === 'string' ? [node['#text']] : [];
}

/** The x-default language alternative if there is one, else the first. */
function langAltText(node) {
    const alt = node && node['rdf:Alt'];
    const items = alt ? [].concat(alt['rdf:li'] ?? []) : [];
    const preferred = items.find((li) => li && typeof li === 'object' && li['@_xml:lang'] === 'x-default');
    const pick = preferred ?? items[0];
    if (pick !== undefined) return listItems(pick)[0];
    return listItems(node)[0];
}

function descriptions(parsed) {
    const root = parsed['x:xmpmeta'];
    const rdf = root && root['rdf:RDF'];
    return [].concat((rdf && rdf['rdf:Description']) ?? []).filter((d) => d && typeof d === 'object');
}

function pick(descs, name, read) {
    for (const d of descs) {
        const raw = d[`@_${name}`] ?? d[name];
        const value = raw === undefined ? undefined : read(raw);
        if (value !== undefined && value !== '') return value;
    }
    return undefined;
}

function toRating(value) {
    const n = Number.parseInt(String(value), 10);
    return n >= 1 && n <= 5 ? n : undefined;
}

/**
 * Parse an XMP packet and return ONLY the allow-listed fields (absent ones are left out).
 * @param {string} packet
 * @returns {{title?:string, description?:string, keywords?:string[], rating?:number, label?:string}}
 */
function parseAllowListed(packet) {
    let parsed;
    try {
        parsed = parser.parse(packet);
    } catch {
        return {};
    }
    const descs = descriptions(parsed);
    const out = {};
    const title = sanitizeText(pick(descs, 'dc:title', langAltText) ?? '', LIMITS.title);
    if (title) out.title = title;
    const description = sanitizeText(pick(descs, 'dc:description', langAltText) ?? '', LIMITS.description);
    if (description) out.description = description;
    const keywords = [];
    for (const d of descs) {
        for (const item of listItems(d['dc:subject'])) {
            const clean = sanitizeText(item, LIMITS.keyword);
            if (clean && !keywords.includes(clean)) keywords.push(clean);
        }
    }
    if (keywords.length > 0) out.keywords = keywords.slice(0, LIMITS.keywords);
    const rating = pick(descs, 'xmp:Rating', (v) => toRating(typeof v === 'object' ? v['#text'] : v));
    if (rating !== undefined) out.rating = rating;
    const label = sanitizeText(pick(descs, 'xmp:Label', (v) => (typeof v === 'object' ? v['#text'] : v)) ?? '', LIMITS.label);
    if (label) out.label = label;
    return out;
}

/** Sidecar values win over embedded ones, field by field. */
function mergeXmp(embedded, sidecar) {
    return { ...embedded, ...sidecar };
}

module.exports = {
    LIMITS,
    sanitizeText,
    extractXmpPacket,
    readEmbeddedPacket,
    parseAllowListed,
    mergeXmp,
};
