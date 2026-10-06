/**
 * buildBundle(...): converted files -> one SCF 1.0 bundle (`scf.json` + `images/`) for Scry Sync.
 *
 * What goes in (guarantee G2: no originals, no paths):
 *   - only the converted pictures (sRGB PNG/JPEG, <= 2048 px, <= 4 MB), never an original file;
 *   - ids from pictureId(folderUuid, relativePath[, page]) (a hash: no path or name can be read back);
 *   - image files named by the hash of the id, so no file name reaches the bundle as a path;
 *   - title = [folder label, file name without extension] (founder decision D2), `name` "Page N" for pages;
 *   - the `x-scry-sync` block: the allow-listed XMP fields (title, description, keywords, rating, label), each one
 *     kept UNCHANGED or DROPPED ENTIRELY by the structural rule in privacy.js (anything that carries a path
 *     separator, a drive, `file:`, the folder's location or the user's name is dropped, never edited), plus `origin`
 *     ({convertedFrom, verdict, appVersion} and nothing else) and, when a value was dropped, `notes`
 *     ([{code: 'metadata_dropped', fields: [field names]}], never the value; also on the file's result row), and
 *     when a kept field was cut to its XMP cap, {code: 'metadata_truncated', fields: [field names]}.
 *     `creator` is not read from XMP today; if a source ever supplies one it goes through the same rule.
 *   - the title's file part is the file name without its extension, as the user named it, when it passes the same
 *     rule as the XMP values (F157); a name that carries a location (a Mac colon path, a slash lookalike, the user's
 *     name) loses the offending words, or becomes `Untitled <6 hex>`, and `fileName` joins the `metadata_dropped`
 *     note; a file whose name holds a backslash or a control character is not captured (failed verdict `odd_name`).
 * Every file that is not captured is counted in `counts.skipped` with its plain-language reason (G3).
 * A bundle over 1 GiB (the server's limit) or over 10,000 captures (the SCF limit) is refused before upload.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SCF_SCHEMA_URL } = require('../scf.js');
const { pictureId } = require('./ids.js');
const { convertFile } = require('./convert.js');
const { SKIP_REASON, FAILED, failed } = require('./verdicts.js');
const { makeLeakCheck, keepIfClean } = require('./privacy.js');
const { CC_SOURCE_KIND, ccOriginFields } = require('./cc-origin.js');

const SOURCE_KIND = 'x-scry-sync';
const VENDOR_KEY = 'x-scry-sync';
/** The source kinds a bundle can be built for: the synced folder (default) and Creative Cloud Libraries. Closed set. */
const SOURCE_KINDS = Object.freeze([SOURCE_KIND, CC_SOURCE_KIND]);
const MAX_BUNDLE_BYTES = 1024 * 1024 * 1024;
/** The SCF validator's per-bundle capture cap (BUNDLE_TOO_MANY_CAPTURES). */
const MAX_BUNDLE_CAPTURES = 10_000;
const TOO_MANY_MESSAGE = 'This folder would make more than 10,000 pictures, which is over the limit; link a smaller folder';
const TOO_BIG_MESSAGE = 'This folder is too big; link a smaller folder';
const CONVERTED_FROM = new Set(['png', 'jpeg', 'webp', 'heic', 'heif', 'tiff', 'psd', 'psb', 'pdf', 'ai']);
const APP_VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.]{1,32})?$/;
const EXT_OF_FAMILY = { png: 'png', jpeg: 'jpg', webp: 'webp' };

class BundleTooBigError extends Error {
    constructor() {
        super(TOO_BIG_MESSAGE);
        this.name = 'BundleTooBigError';
        this.code = 'bundle_too_big';
    }
}

class TooManyCapturesError extends Error {
    constructor() {
        super(TOO_MANY_MESSAGE);
        this.name = 'TooManyCapturesError';
        this.code = 'too_many_captures';
    }
}

/** The `origin` block: which format a picture came from, its verdict and the app version. Nothing else. */
function originBlock({ format, verdict, appVersion }) {
    const origin = {};
    if (CONVERTED_FROM.has(format)) origin.convertedFrom = format;
    if (verdict === 'faithful' || verdict === 'approximate') origin.verdict = verdict;
    if (typeof appVersion === 'string' && APP_VERSION_RE.test(appVersion)) origin.appVersion = appVersion;
    return origin;
}

/** A name that cannot be a file name on every OS, or that would read as a path: it is refused, not rewritten. */
function oddFileName(rel) {
    if (typeof rel !== 'string' || rel.length === 0 || rel.includes('\\')) return true;
    for (let i = 0; i < rel.length; i += 1) {
        const code = rel.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) return true;
    }
    return false;
}

/**
 * The allow-listed XMP text fields, each unchanged or dropped by the structural rule (privacy.js); a keyword list
 * keeps the keywords that pass and drops the others one by one. Returns the kept fields and the NAMES of the fields
 * that lost a value (never the values), for the `metadata_dropped` note.
 */
function cleanMeta(xmp, leaks) {
    const meta = {};
    const dropped = [];
    for (const key of ['title', 'description', 'label', 'creator']) {
        if (typeof xmp[key] !== 'string' || xmp[key].length === 0) continue;
        const value = keepIfClean(xmp[key], leaks);
        if (value) meta[key] = value;
        else dropped.push(key);
    }
    if (Array.isArray(xmp.keywords)) {
        const keywords = xmp.keywords.map((k) => keepIfClean(k, leaks)).filter(Boolean);
        if (keywords.length) meta.keywords = keywords;
        if (keywords.length < xmp.keywords.filter((k) => typeof k === 'string' && k.length > 0).length) dropped.push('keywords');
    }
    if (Number.isInteger(xmp.rating)) meta.rating = xmp.rating;
    return { meta, dropped };
}

/**
 * The note that tells the person why a title, keyword or label vanished (F76): the code and the field names only.
 * `folderLabel` is listed when the folder's label was dropped (the title is then the file name alone).
 */
function metadataNotes(dropped, truncated = []) {
    const notes = [];
    if (dropped.length) notes.push({ code: 'metadata_dropped', fields: dropped });
    if (truncated.length) notes.push({ code: 'metadata_truncated', fields: truncated });
    return notes.length ? notes : null;
}

const MAX_LABEL_LENGTH = 200;

/**
 * A folder label is a display name: cut to its shown length FIRST (so a long label is never scanned whole, F109), then
 * unchanged when it carries no location, otherwise dropped (the title is then the file name alone).
 */
function cleanLabel(label, leaks) {
    if (typeof label !== 'string') return '';
    return keepIfClean(Array.from(label).slice(0, MAX_LABEL_LENGTH).join(''), leaks) || '';
}

function stemOf(rel) {
    const base = rel.split('/').pop();
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
}

function sha256Hex(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * The title's file part, run through the same rule as every other free-text value (F157: a file named
 * `Users:<user>:Desktop` (macOS shows `/` as `:`) or `\u2215home\u2215<user>\u2215x` is a path in disguise).
 *   - clean: the stem, exactly as the user named it;
 *   - otherwise the stem without its offending words (split on spaces; every word that carries a location is left
 *     out and the rest is checked again as a whole, so a location spread over several words cannot survive);
 *   - otherwise `Untitled <6 hex of the picture id>` (a hash: the same file keeps the same title, two files differ).
 * The file is captured either way. Returns the title part and whether the name was changed (noted as `fileName`).
 */
function safeStem(rel, leaks, id, isName = false) {
    const stem = (isName ? rel : stemOf(rel)) || 'Untitled';
    if (!leaks(stem)) return { stem, changed: false };
    const rest = stem.split(/\s+/).filter((word) => word && !leaks(word)).join(' ');
    if (rest && !leaks(rest)) return { stem: rest, changed: true };
    return { stem: `Untitled ${String(id).slice(0, 6)}`, changed: true };
}

/**
 * @param {object} args
 * @param {string} [args.folderUuid] the synced folder's UUID (ids; not needed when `idFor` is given)
 * @param {'x-scry-sync'|'x-scry-cc'} [args.sourceKind] the bundle's `source.kind` and vendor block name; default `x-scry-sync`
 * @param {(file:{abs:string, rel:string, origin?:object}, page?:number) => string} [args.idFor] the picture id of a file (and page);
 *   default `pictureId(folderUuid, file.rel, page)`, so a synced folder keeps exactly the ids it always had
 * (for `x-scry-cc` each file may carry `origin: {library, item, link, stock}`; see cc-origin.js; ignored for `x-scry-sync`)
 * @param {{root:string, files:Array<{abs:string, rel:string}>, refused?:Array}} args.scan scanFolder() result
 * @param {string} args.outDir an empty directory to write the bundle into
 * @param {string} args.appVersion the app version, for `origin` and `source.tool`
 * @param {string} [args.folderLabel] display name of the folder (first title segment)
 * @param {object} [args.convertOptions] passed to convertFile (decoders, tools)
 * @param {Function} [args.convert] convertFile replacement (tests)
 * @param {number} [args.maxBundleBytes] defaults to 1 GiB
 * @param {Date} [args.now]
 * @returns {Promise<{manifest:object, results:Array<{rel:string, verdict:string, codes:string[], reasons:string[], fix:string|null, ids:string[], notes?:Array<{code:'metadata_dropped'|'metadata_truncated', fields:string[]}>}>, bytes:number}>}
 * @throws {BundleTooBigError} "This folder is too big; link a smaller folder"
 */
async function buildBundle(args) {
    const { scan, outDir, appVersion } = args;
    const leaks = makeLeakCheck({ root: scan.root });
    const label = cleanLabel(args.folderLabel, leaks);
    const sourceKind = args.sourceKind === undefined ? SOURCE_KIND : args.sourceKind;
    if (!SOURCE_KINDS.includes(sourceKind)) throw new TypeError(`sourceKind must be one of ${SOURCE_KINDS.join(', ')}`);
    if (args.idFor !== undefined && typeof args.idFor !== 'function') throw new TypeError('idFor must be a function');
    const state = {
        args,
        sourceKind,
        leaks,
        label,
        labelDropped: typeof args.folderLabel === 'string' && args.folderLabel.length > 0 && label === '',
        maxBytes: args.maxBundleBytes || MAX_BUNDLE_BYTES,
        captures: [],
        skipped: [],
        results: [],
        bytes: 0,
    };
    fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
    for (const refused of scan.refused || []) {
        skipFile(state, refused);
        state.results.push({ rel: refused.rel, verdict: 'failed', codes: refused.codes, reasons: refused.reasons, fix: refused.fix, ids: [] });
    }
    try {
        for (const file of scan.files) await addFile(state, file);
        const manifest = {
            $schema: SCF_SCHEMA_URL,
            scf: '1.0',
            source: { kind: state.sourceKind, platform: 'other', tool: { name: 'scry-sync', version: APP_VERSION_RE.test(String(appVersion)) ? appVersion : 'unknown' } },
            createdAt: (args.now || new Date()).toISOString(),
            counts: { declared: scan.files.length + (scan.refused || []).length, captured: state.captures.length, skipped: state.skipped },
            captures: state.captures,
        };
        const json = JSON.stringify(manifest, null, 2) + '\n';
        countBytes(state, Buffer.byteLength(json));
        fs.writeFileSync(path.join(outDir, 'scf.json'), json);
        return { manifest, results: state.results, bytes: state.bytes };
    } catch (error) {
        if (error instanceof BundleTooBigError || error instanceof TooManyCapturesError) fs.rmSync(path.join(outDir, 'images'), { recursive: true, force: true });
        throw error;
    }
}

function countBytes(state, n) {
    state.bytes += n;
    if (state.bytes > state.maxBytes) throw new BundleTooBigError();
}

/**
 * A failed file goes into counts.skipped with its plain reason. The reasons are our own sentences; if one ever
 * carried a location (a tool's message, say) it is replaced by the code's standard sentence, never edited.
 */
function skipFile(state, result) {
    const code = result.codes[0];
    const text = result.reasons.join(' ');
    const standard = FAILED[code] ? FAILED[code][0] : 'The file could not be converted.';
    const detail = state.leaks(text) ? standard : text;
    state.skipped.push({ id: `file-${state.skipped.length + 1}`, reason: SKIP_REASON[code] || 'error', detail });
}

/** The id of every picture of a converted file, or null when the file's name cannot be an id (checked before anything is written). */
function idsFor(state, file, pictures) {
    const idFor = state.args.idFor || ((f, page) => pictureId(state.args.folderUuid, f.rel, page));
    try {
        const ids = pictures.map((picture) => idFor(file, picture.suffix ? Number(picture.suffix.slice(2)) : undefined));
        return ids.every((id) => typeof id === 'string' && id.length > 0) ? ids : null;
    } catch {
        return null;
    }
}

/** The `x-scry-sync` block of a converted file; a `metadata_dropped` note also goes on the file's result row. */
function vendorBlock(state, result, entry, fileNameChanged, ccOrigin) {
    const { meta, dropped: droppedMeta } = cleanMeta(result.xmp || {}, state.leaks);
    const dropped = [...droppedMeta, ...(fileNameChanged ? ['fileName'] : []), ...(ccOrigin ? ccOrigin.dropped : [])];
    // F122: a kept field that importXmp cut to its cap (title 200, description 2000, ...) is named, never its value.
    const truncated = (result.xmpTruncated || []).filter((field) => field in meta);
    const notes = metadataNotes(state.labelDropped ? [...dropped, 'folderLabel'] : dropped, truncated);
    const origin = { ...originBlock({ format: result.format, verdict: result.verdict, appVersion: state.args.appVersion }), ...(ccOrigin ? ccOrigin.fields : {}) };
    const block = { ...meta, origin };
    if (notes) {
        block.notes = notes;
        entry.notes = notes;
    }
    return { meta, block };
}

/**
 * The title of a file's pictures, whether its name had to be changed, and (for Creative Cloud) its allow-listed origin
 * fields. A Creative Cloud title is [library, item] when the app named them (and they passed the rule), else [folder
 * label, file stem] like a folder's.
 */
function titleOf(state, file, firstId) {
    const ccOrigin = state.sourceKind === CC_SOURCE_KIND ? ccOriginFields(file.origin, state.leaks) : null;
    const item = ccOrigin ? ccOrigin.fields.item : undefined;
    const { stem, changed } = safeStem(item || file.rel, state.leaks, firstId, Boolean(item));
    const first = (ccOrigin && ccOrigin.fields.library) || state.label;
    return { title: first ? [first, stem] : [stem], changed, ccOrigin };
}

/** Convert one file and add a capture per picture (or a skip). */
async function addFile(state, file) {
    const { args } = state;
    let result;
    try {
        result = oddFileName(file.rel) ? failed(null, 'odd_name') : await (args.convert || convertFile)(file.abs, { ...(args.convertOptions || {}), root: args.scan.root });
    } catch {
        result = failed(null, 'unreadable');
    }
    const ids = result.verdict === 'failed' ? [] : idsFor(state, file, result.pictures);
    if (!ids) result = failed(null, 'odd_name');
    const entry = { rel: file.rel, verdict: result.verdict, codes: result.codes, reasons: result.reasons, fix: result.fix, ids: [] };
    state.results.push(entry);
    if (result.verdict === 'failed') {
        skipFile(state, result);
        return;
    }
    const { title, changed, ccOrigin } = titleOf(state, file, ids[0]);
    const { meta, block } = vendorBlock(state, result, entry, changed, ccOrigin);
    for (const [index, picture] of result.pictures.entries()) {
        if (state.captures.length >= MAX_BUNDLE_CAPTURES) throw new TooManyCapturesError();
        const page = picture.suffix ? Number(picture.suffix.slice(2)) : undefined;
        const id = ids[index];
        const name = `${sha256Hex(id)}.${EXT_OF_FAMILY[picture.family]}`;
        countBytes(state, picture.bytes.length);
        fs.writeFileSync(path.join(args.outDir, 'images', name), picture.bytes);
        const capture = {
            id,
            image: `images/${name}`,
            kind: 'doc-image',
            title,
            capture: { method: 'design-export', size: { width: picture.width, height: picture.height } },
            [state.sourceKind]: block,
        };
        if (page) capture.name = `Page ${page}`;
        if (meta.keywords) capture.tags = meta.keywords;
        state.captures.push(capture);
        entry.ids.push(id);
    }
}

module.exports = {
    SOURCE_KIND,
    SOURCE_KINDS,
    VENDOR_KEY,
    MAX_BUNDLE_BYTES,
    MAX_BUNDLE_CAPTURES,
    TOO_BIG_MESSAGE,
    TOO_MANY_MESSAGE,
    BundleTooBigError,
    TooManyCapturesError,
    originBlock,
    buildBundle,
};
