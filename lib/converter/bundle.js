/**
 * buildBundle(...): converted files -> one SCF 1.0 bundle (`scf.json` + `images/`) for Scry Sync.
 *
 * What goes in (guarantee G2: no originals, no paths):
 *   - only the converted pictures (sRGB PNG/JPEG, <= 2048 px, <= 4 MB), never an original file;
 *   - ids from pictureId(folderUuid, relativePath[, page]) (a hash: no path or name can be read back);
 *   - image files named by the hash of the id, so no file name reaches the bundle as a path;
 *   - title = [folder label, file name without extension] (founder decision D2), `name` "Page N" for pages;
 *   - the `x-scry-sync` block: the allow-listed XMP fields (title, description, keywords, rating, label, creator),
 *     with any absolute path, the folder's location and the user's name taken out of their text, plus `origin`
 *     ({convertedFrom, verdict, appVersion} and nothing else).
 * Every file that is not captured is counted in `counts.skipped` with its plain-language reason (G3).
 * A bundle over 1 GiB (the server's limit) is refused before upload.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SCF_SCHEMA_URL } = require('../scf.js');
const { pictureId } = require('./ids.js');
const { convertFile } = require('./convert.js');
const { SKIP_REASON, failed } = require('./verdicts.js');

const SOURCE_KIND = 'x-scry-sync';
const VENDOR_KEY = 'x-scry-sync';
const MAX_BUNDLE_BYTES = 1024 * 1024 * 1024;
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

/** The `origin` block: which format a picture came from, its verdict and the app version. Nothing else. */
function originBlock({ format, verdict, appVersion }) {
    const origin = {};
    if (CONVERTED_FROM.has(format)) origin.convertedFrom = format;
    if (verdict === 'faithful' || verdict === 'approximate') origin.verdict = verdict;
    if (typeof appVersion === 'string' && APP_VERSION_RE.test(appVersion)) origin.appVersion = appVersion;
    return origin;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove absolute paths and the user's name from free text. Paths: `C:\...`, `\\server\...`, `/Users/...`,
 * `/home/...`, `~/...`, and the synced folder's own location.
 */
function makeScrubber({ root, extraSecrets = [] }) {
    const secrets = [root, os.homedir(), safeUserName(), ...extraSecrets]
        .filter((s) => typeof s === 'string' && s.length >= 3)
        .sort((a, b) => b.length - a.length);
    const pathRe = /(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|\/(?:Users|home|Volumes|mnt|private|var|tmp|media|root)\/)[^\s"'<>|]*/g;
    return (text) => {
        const input = String(text);
        // A user name seen in any path of this text is taken out of the rest of it too ("by annsmith").
        const named = [...input.matchAll(/[\\/](?:Users|home|Documents and Settings)[\\/]([^\\/\s"'<>|]{2,64})/gi)].map((m) => m[1]);
        const words = [...secrets, ...named].sort((a, b) => b.length - a.length);
        let out = input.replace(pathRe, '');
        if (words.length) out = out.replace(new RegExp(words.map(escapeRegExp).join('|'), 'gi'), '');
        return out.replace(/\(\s*\)|\[\s*\]/g, '').replace(/\s{2,}/g, ' ').trim();
    };
}

function safeUserName() {
    try {
        return os.userInfo().username;
    } catch {
        return null;
    }
}

function cleanMeta(xmp, scrub) {
    const meta = {};
    for (const key of ['title', 'description', 'label', 'creator']) {
        if (typeof xmp[key] === 'string') {
            const value = scrub(xmp[key]);
            if (value) meta[key] = value;
        }
    }
    if (Array.isArray(xmp.keywords)) {
        const keywords = xmp.keywords.map(scrub).filter(Boolean);
        if (keywords.length) meta.keywords = keywords;
    }
    if (Number.isInteger(xmp.rating)) meta.rating = xmp.rating;
    return meta;
}

/** A folder label is a display name, never a path. */
function cleanLabel(label, scrub) {
    if (typeof label !== 'string') return '';
    return scrub(label).replace(/[\\/:]/g, ' ').replace(/[([{]\s*$/, '').replace(/\s{2,}/g, ' ').trim().slice(0, 200);
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
 * @param {object} args
 * @param {string} args.folderUuid the synced folder's UUID (ids)
 * @param {{root:string, files:Array<{abs:string, rel:string}>, refused?:Array}} args.scan scanFolder() result
 * @param {string} args.outDir an empty directory to write the bundle into
 * @param {string} args.appVersion the app version, for `origin` and `source.tool`
 * @param {string} [args.folderLabel] display name of the folder (first title segment)
 * @param {object} [args.convertOptions] passed to convertFile (decoders, tools)
 * @param {Function} [args.convert] convertFile replacement (tests)
 * @param {number} [args.maxBundleBytes] defaults to 1 GiB
 * @param {Date} [args.now]
 * @returns {Promise<{manifest:object, results:Array<{rel:string, verdict:string, codes:string[], reasons:string[], fix:string|null, ids:string[]}>, bytes:number}>}
 * @throws {BundleTooBigError} "This folder is too big; link a smaller folder"
 */
async function buildBundle(args) {
    const { scan, outDir, appVersion } = args;
    const scrub = makeScrubber({ root: scan.root });
    const state = {
        args,
        scrub,
        label: cleanLabel(args.folderLabel, scrub),
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
            source: { kind: SOURCE_KIND, platform: 'other', tool: { name: 'scry-sync', version: appVersion } },
            createdAt: (args.now || new Date()).toISOString(),
            counts: { declared: scan.files.length + (scan.refused || []).length, captured: state.captures.length, skipped: state.skipped },
            captures: state.captures,
        };
        const json = JSON.stringify(manifest, null, 2) + '\n';
        countBytes(state, Buffer.byteLength(json));
        fs.writeFileSync(path.join(outDir, 'scf.json'), json);
        return { manifest, results: state.results, bytes: state.bytes };
    } catch (error) {
        if (error instanceof BundleTooBigError) fs.rmSync(path.join(outDir, 'images'), { recursive: true, force: true });
        throw error;
    }
}

function countBytes(state, n) {
    state.bytes += n;
    if (state.bytes > state.maxBytes) throw new BundleTooBigError();
}

/** A failed file goes into counts.skipped with its plain reason (no path: the reasons never carry one, and are scrubbed). */
function skipFile(state, result) {
    const reason = SKIP_REASON[result.codes[0]] || 'error';
    state.skipped.push({ id: `file-${state.skipped.length + 1}`, reason, detail: state.scrub(result.reasons.join(' ')) });
}

/** Convert one file and add a capture per picture (or a skip). */
async function addFile(state, file) {
    const { args, scrub } = state;
    let result;
    try {
        result = await (args.convert || convertFile)(file.abs, { ...(args.convertOptions || {}), root: args.scan.root });
    } catch {
        result = failed(null, 'unreadable');
    }
    const entry = { rel: file.rel, verdict: result.verdict, codes: result.codes, reasons: result.reasons, fix: result.fix, ids: [] };
    state.results.push(entry);
    if (result.verdict === 'failed') {
        skipFile(state, result);
        return;
    }
    const meta = cleanMeta(result.xmp || {}, scrub);
    const block = { ...meta, origin: originBlock({ format: result.format, verdict: result.verdict, appVersion: args.appVersion }) };
    const stem = scrub(stemOf(file.rel)) || 'Untitled';
    const title = state.label ? [state.label, stem] : [stem];
    for (const picture of result.pictures) {
        const page = picture.suffix ? Number(picture.suffix.slice(2)) : undefined;
        const id = pictureId(args.folderUuid, file.rel, page);
        const name = `${sha256Hex(id)}.${EXT_OF_FAMILY[picture.family]}`;
        countBytes(state, picture.bytes.length);
        fs.writeFileSync(path.join(args.outDir, 'images', name), picture.bytes);
        const capture = {
            id,
            image: `images/${name}`,
            kind: 'doc-image',
            title,
            capture: { method: 'design-export', size: { width: picture.width, height: picture.height } },
            [VENDOR_KEY]: block,
        };
        if (page) capture.name = `Page ${page}`;
        if (meta.keywords) capture.tags = meta.keywords;
        state.captures.push(capture);
        entry.ids.push(id);
    }
}

module.exports = { SOURCE_KIND, VENDOR_KEY, MAX_BUNDLE_BYTES, TOO_BIG_MESSAGE, BundleTooBigError, originBlock, makeScrubber, buildBundle };
