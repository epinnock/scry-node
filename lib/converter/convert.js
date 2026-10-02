/**
 * convertFile(path, opts): one file in the synced folder -> its pictures and an honest verdict (guarantee G3).
 *
 *   { format, pictures: [{ suffix, bytes, family, width, height }], verdict, codes, reasons, fix }
 *
 * `suffix` is '' for a single picture and `#p<N>` for each PDF/AI page (always, even a one-page PDF, so adding a
 * page later never changes the first page's id). Pictures are sRGB PNG/JPEG, <= 2048 px, <= 4 MB, no metadata.
 * The verdict is `faithful`, `approximate` (with reasons) or `failed` (no pictures, a reason and the fix).
 * convertFile never throws for a bad file: whatever happens, the file gets a verdict.
 */
const fs = require('fs');
const path = require('path');
const { measure } = require('../importConvert.js');
const legacy = require('../importConvert.js');
const { stripMetadata } = require('../importStrip.js');
const { readEmbeddedPacket, parseAllowListed, mergeXmp } = require('../importXmp.js');
const { readSidecarPacket } = require('../importScan.js');
const { sharp, tooLarge, isSrgbProfile, encodeForScry, readOptions, MAX_RASTER_BYTES, MAX_RASTER_DIMENSION } = require('./raster.js');
const { readPsdComposite } = require('./psd.js');
const { renderPdfPages, hasPdfHeader } = require('./pdf.js');
const { failed, finish } = require('./verdicts.js');

/** Extension -> format (the `convertedFrom` value in the origin block). */
const FORMATS = Object.freeze({
    '.png': 'png',
    '.jpg': 'jpeg',
    '.jpeg': 'jpeg',
    '.webp': 'webp',
    '.tif': 'tiff',
    '.tiff': 'tiff',
    '.psd': 'psd',
    '.psb': 'psb',
    '.pdf': 'pdf',
    '.ai': 'ai',
    '.heic': 'heic',
    '.heif': 'heif',
    '.indd': 'indd',
});
const PASS_THROUGH = new Set(['png', 'jpeg', 'webp']);
/** Bigger source files are refused before reading (a 200 MP picture is far below this). */
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;

function formatOf(file) {
    return FORMATS[path.extname(file).toLowerCase()] || null;
}

async function encodeOne(open) {
    const out = await encodeForScry(open);
    return out ? { suffix: '', ...out } : null;
}

/** PNG/JPEG/WebP/TIFF through sharp; an untouched copy (metadata stripped) when it is already sRGB and in bounds. */
async function convertRaster(file, format) {
    const meta = await sharp(file, readOptions()).metadata();
    if (tooLarge(meta.width, meta.height)) return failed(format, 'too_large', `${meta.width}x${meta.height}`);
    const codes = [];
    if ((meta.pages || 1) > 1) codes.push('extra_frames');
    if (meta.space === 'cmyk' && !meta.icc) codes.push('cmyk_no_icc');
    if (PASS_THROUGH.has(format) && meta.space !== 'cmyk' && isSrgbProfile(meta.icc) && (meta.orientation || 1) === 1) {
        const raw = fs.readFileSync(file);
        const found = measure(raw);
        const clean = found ? stripMetadata(raw, found.family) : null;
        const dims = clean ? measure(clean) : null;
        const fits = dims && clean.length <= MAX_RASTER_BYTES && dims.width <= MAX_RASTER_DIMENSION && dims.height <= MAX_RASTER_DIMENSION;
        if (fits && !legacy.outputProblem(clean, dims)) return finish(format, [{ suffix: '', bytes: clean, ...dims }], codes);
    }
    const picture = await encodeOne(() => sharp(file, readOptions()).rotate());
    return picture ? finish(format, [picture], codes) : failed(format, 'output_too_big');
}

async function convertPsd(file, format) {
    const composite = readPsdComposite(file);
    if (composite.failure) return failed(format, composite.failure, composite.failure === 'too_large' ? `${composite.width}x${composite.height}` : undefined);
    const picture = await encodeOne(() => sharp(composite.tiff));
    return picture ? finish(format, [picture], composite.codes) : failed(format, 'output_too_big');
}

async function convertPdf(file, format) {
    const bytes = fs.readFileSync(file);
    if (format === 'ai' && !hasPdfHeader(bytes)) return failed(format, 'ai_no_pdf');
    const rendered = await renderPdfPages(bytes);
    if (rendered.failure) return failed(format, rendered.failure);
    const pictures = [];
    for (const page of rendered.pages) {
        const raw = { raw: { width: page.width, height: page.height, channels: 3 } };
        const picture = await encodeForScry(() => sharp(page.rgb, raw));
        if (!picture) return failed(format, 'output_too_big', `page ${page.page}`);
        pictures.push({ suffix: `#p${page.page}`, ...picture });
    }
    return finish(format, pictures, rendered.codes);
}

/**
 * HEIC/HEIF. The decoder is the OS's, plugged in by the app (`opts.decoders.heic(path) -> Promise<Buffer>` of a
 * PNG/JPEG/TIFF sharp can read: Windows WIC, macOS ImageIO). Without one, the command-line tools `scry import`
 * uses (sips, ImageMagick) are tried, whose colours are not converted to sRGB (approximate).
 */
async function convertHeic(file, format, opts) {
    const decode = opts.decoders && opts.decoders.heic;
    if (decode) {
        let decoded;
        try {
            decoded = await decode(file);
        } catch {
            return failed(format, 'unreadable', 'the HEIC decoder could not read it');
        }
        const meta = await sharp(decoded, readOptions()).metadata();
        if (tooLarge(meta.width, meta.height)) return failed(format, 'too_large', `${meta.width}x${meta.height}`);
        const picture = await encodeOne(() => sharp(decoded, readOptions()).rotate());
        return picture ? finish(format, [picture], []) : failed(format, 'output_too_big');
    }
    const tools = opts.tools || legacy.detectTools();
    if (tools.filter((t) => t !== 'pdftoppm').length === 0) return failed(format, 'heic_no_decoder');
    const result = await legacy.convertFile(file, '.heic', { tools, run: opts.run });
    if (!result.ok) return failed(format, 'unreadable', result.detail);
    const { bytes, family, width, height } = result;
    return finish(format, [{ suffix: '', bytes, family, width, height }], ['colour_unmanaged']);
}

/** Allow-listed XMP (title, description, keywords, rating, label, creator) from the file and its .xmp sidecar. */
function readXmp(file, root) {
    let embedded = {};
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    try {
        const packet = readEmbeddedPacket(fd, size);
        if (packet) embedded = parseAllowListed(packet);
    } finally {
        fs.closeSync(fd);
    }
    const sidecar = root ? readSidecarPacket(file, root) : {};
    return mergeXmp(embedded, sidecar.packet ? parseAllowListed(sidecar.packet) : {});
}

async function dispatch(file, format, opts) {
    if (format === 'indd') return failed(format, 'indd_needs_pdf');
    if (format === 'psd' || format === 'psb') return convertPsd(file, format);
    if (format === 'pdf' || format === 'ai') return convertPdf(file, format);
    if (format === 'heic' || format === 'heif') return convertHeic(file, format, opts);
    return convertRaster(file, format);
}

/**
 * @param {string} file absolute path
 * @param {{root?:string, decoders?:{heic?:(file:string)=>Promise<Buffer>}, tools?:string[], run?:Function, metadata?:boolean}} [opts]
 *   `root`: the synced folder (for the .xmp sidecar); `metadata: false` skips XMP.
 * @returns {Promise<{format:string|null, pictures:Array, verdict:'faithful'|'approximate'|'failed', codes:string[], reasons:string[], fix:string|null, xmp?:object}>}
 */
async function convertFile(file, opts = {}) {
    const format = formatOf(file);
    if (!format) return failed(null, 'unsupported_type');
    let result;
    try {
        const stat = fs.statSync(file);
        if (!stat.isFile()) return failed(format, 'unreadable');
        if (stat.size === 0) return failed(format, 'empty');
        if (stat.size > MAX_SOURCE_BYTES) return failed(format, 'too_large', 'file over 2 GB');
        result = await dispatch(file, format, opts);
    } catch (error) {
        const tooBig = /pixel limit|exceeds|too large/i.test(String(error && error.message));
        result = failed(format, tooBig ? 'too_large' : 'unreadable');
    }
    if (result.verdict !== 'failed' && opts.metadata !== false) {
        try {
            const xmp = readXmp(file, opts.root);
            if (Object.keys(xmp).length > 0) result.xmp = xmp;
        } catch {
            // metadata is optional; the picture stands without it
        }
    }
    return result;
}

module.exports = { FORMATS, formatOf, convertFile };
