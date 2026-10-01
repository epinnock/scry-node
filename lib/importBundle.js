/**
 * `scry import`: turn a scanned folder into an SCF bundle (source.kind `x-adobe-bridge`).
 *
 * One capture per distinct picture. The id is a content hash, so renaming or moving a file never
 * creates a "new" picture. The bundle contains no file names or paths (images are stored under
 * their hash), and Bridge's metadata goes under `x-adobe-bridge`, allow-listed fields only
 * (see importXmp.js). Every file that is not captured is counted with a reason (SCF `counts`).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { version: PACKAGE_VERSION } = require('../package.json');
const { SCF_SCHEMA_URL } = require('./scf.js');
const { convertFile, measure, MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION } = require('./importConvert.js');
const { stripMetadata } = require('./importStrip.js');
const { readEmbeddedPacket, parseAllowListed, mergeXmp } = require('./importXmp.js');
const { readSidecarPacket } = require('./importScan.js');

const SOURCE_KIND = 'x-adobe-bridge';
const VENDOR_KEY = 'x-adobe-bridge';
const MAX_READ_BYTES = 256 * 1024 * 1024;
const EXT_OF_FAMILY = { png: 'png', jpeg: 'jpg', webp: 'webp' };

function sha256Hex(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function hashFile(abs) {
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(abs, 'r');
    try {
        const chunk = Buffer.alloc(1024 * 1024);
        for (let n = fs.readSync(fd, chunk, 0, chunk.length, null); n > 0; n = fs.readSync(fd, chunk, 0, chunk.length, null)) {
            hash.update(chunk.subarray(0, n));
        }
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest('hex');
}

/** Allow-listed metadata for a file: embedded packet, then sidecar on top. Returns {meta, sidecarRefused}. */
function readMetadata(file, root, size) {
    let embedded = {};
    const fd = fs.openSync(file.abs, 'r');
    try {
        const packet = readEmbeddedPacket(fd, size);
        if (packet) embedded = parseAllowListed(packet);
    } finally {
        fs.closeSync(fd);
    }
    const sidecar = readSidecarPacket(file.abs, root);
    const fromSidecar = sidecar.packet ? parseAllowListed(sidecar.packet) : {};
    return { meta: mergeXmp(embedded, fromSidecar), sidecarRefused: sidecar.refused };
}

/** The picture for a native PNG/JPEG/WebP: stripped bytes if they fit, else re-encoded. */
async function prepareNative(file, size, deps) {
    if (size > MAX_READ_BYTES) return { skip: { reason: 'error', detail: 'file is larger than 256 MB' } };
    const raw = fs.readFileSync(file.abs);
    const found = measure(raw);
    const clean = found ? stripMetadata(raw, found.family) : null;
    const dims = clean ? measure(clean) : null;
    if (!clean || !dims) return { skip: { reason: 'error', detail: `not a readable ${file.ext} image` } };
    const idHex = sha256Hex(clean);
    const fits = clean.length <= MAX_IMAGE_BYTES && dims.width <= MAX_IMAGE_DIMENSION && dims.height <= MAX_IMAGE_DIMENSION;
    if (fits) return { idHex, picture: { bytes: clean, ...dims }, converted: false };
    const result = await deps.convert(file.abs, file.ext, { tools: deps.tools });
    if (!result.ok) return { idHex, skip: { reason: result.reason, detail: result.detail } };
    return { idHex, picture: result, converted: true };
}

async function prepareConverted(file, deps) {
    const idHex = hashFile(file.abs);
    const result = await deps.convert(file.abs, file.ext, { tools: deps.tools });
    if (!result.ok) return { idHex, skip: { reason: result.reason, detail: result.detail } };
    return { idHex, picture: result, converted: true };
}

function captureFor(id, imagePath, picture, meta) {
    const capture = {
        id,
        image: imagePath,
        kind: 'doc-image',
        capture: { method: 'design-export', size: { width: picture.width, height: picture.height } },
    };
    if (meta.keywords) capture.tags = meta.keywords;
    if (Object.keys(meta).length > 0) capture[VENDOR_KEY] = meta;
    return capture;
}

/** Prepare, de-duplicate and write one file. Returns {skip} or {capture, converted, sidecarRefused, hasMeta}. */
async function processFile(file, scan, outDir, ctx, seen) {
    const size = fs.statSync(file.abs).size;
    if (size === 0) return { skip: { reason: 'empty', detail: 'file is empty' } };
    const prepared = file.kind === 'native' ? await prepareNative(file, size, ctx) : await prepareConverted(file, ctx);
    const id = prepared.idHex ? `sha256-${prepared.idHex}` : undefined;
    if (prepared.skip) return { id, skip: prepared.skip };
    if (seen.has(id)) return { id, skip: { reason: 'filtered', detail: 'same picture as an earlier file' } };
    seen.add(id);
    const { meta, sidecarRefused } = readMetadata(file, scan.root, size);
    const imagePath = `images/${prepared.idHex}.${EXT_OF_FAMILY[prepared.picture.family]}`;
    fs.writeFileSync(path.join(outDir, ...imagePath.split('/')), prepared.picture.bytes);
    return {
        capture: captureFor(id, imagePath, prepared.picture, meta),
        converted: prepared.converted,
        hasMeta: Object.keys(meta).length > 0,
        sidecarRefused,
    };
}

/**
 * Convert and write every scanned file into `outDir` (`scf.json` + `images/`).
 *
 * @param {{root:string, files:Array, skipped:Array}} scan result of scanFolder()
 * @param {string} outDir empty directory to write the bundle into
 * @param {{convert?:Function, tools?:string[], now?:Date}} [deps]
 * @returns {Promise<{manifest:object, stats:object}>}
 */
async function buildBundle(scan, outDir, deps = {}) {
    const ctx = { convert: deps.convert || convertFile, tools: deps.tools };
    fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
    const captures = [];
    const seen = new Set();
    const skipped = scan.skipped.map((s, i) => ({ ...s, id: `file-${i + 1}` }));
    const stats = { converted: 0, asIs: 0, withMetadata: 0, sidecarsRefused: 0 };

    for (const file of scan.files) {
        const done = await processFile(file, scan, outDir, ctx, seen);
        if (done.skip) {
            skipped.push({ rel: file.rel, id: done.id || `file-${skipped.length + 1}`, ...done.skip });
            continue;
        }
        captures.push(done.capture);
        stats[done.converted ? 'converted' : 'asIs'] += 1;
        stats.withMetadata += done.hasMeta ? 1 : 0;
        stats.sidecarsRefused += done.sidecarRefused ? 1 : 0;
    }

    const manifest = {
        $schema: SCF_SCHEMA_URL,
        scf: '1.0',
        source: { kind: SOURCE_KIND, platform: 'other', tool: { name: '@scrymore/scry-deployer import', version: PACKAGE_VERSION } },
        createdAt: (deps.now || new Date()).toISOString(),
        counts: {
            declared: scan.files.length + scan.skipped.length,
            captured: captures.length,
            skipped: skipped.map(({ id, reason, detail }) => ({ id, reason, detail })),
        },
        captures,
    };
    fs.writeFileSync(path.join(outDir, 'scf.json'), JSON.stringify(manifest, null, 2) + '\n');
    return { manifest, stats: { ...stats, captured: captures.length, skipped } };
}

module.exports = { SOURCE_KIND, VENDOR_KEY, buildBundle };
