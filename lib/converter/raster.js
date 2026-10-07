/**
 * Raster output for Scry Sync, on `sharp` (libvips; colour management through Little CMS 2).
 *
 * Every picture leaves here as an 8-bit sRGB PNG or JPEG, at most 2048 px on its longest side and 4 MB, with no
 * metadata, and checked to decode (the same bounds and checks as `scry import`, importConvert.js). An embedded
 * ICC profile (Display P3, Adobe RGB, a CMYK press profile) is converted to sRGB, never stripped as is.
 */
const { measure, outputProblem, MAX_RASTER_BYTES, MAX_RASTER_DIMENSION } = require('../importConvert.js');

/** Over this many pixels, or this many px on a side, a file is refused (plan: "failed" verdicts). */
const MAX_SOURCE_PIXELS = 200_000_000;
const MAX_SOURCE_EDGE = 16384;

// Largest first: lossless PNG, then JPEG at shrinking sizes until the file is under the byte cap (as the CLI).
const ATTEMPTS = Object.freeze([
    { format: 'png', max: MAX_RASTER_DIMENSION },
    { format: 'jpeg', max: MAX_RASTER_DIMENSION, quality: 90 },
    { format: 'jpeg', max: Math.round(MAX_RASTER_DIMENSION * 0.75), quality: 85 },
    { format: 'jpeg', max: Math.round(MAX_RASTER_DIMENSION * 0.5), quality: 80 },
]);

let sharpModule = null;
/** sharp is loaded on first use, so `scry` commands that never convert do not pay for it. */
function sharp(...args) {
    if (!sharpModule) {
        sharpModule = require('sharp');
        sharpModule.cache(false);
    }
    return sharpModule(...args);
}

function tooLarge(width, height) {
    return width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE || width * height > MAX_SOURCE_PIXELS;
}

/** The first string of an ICC v4 `mluc` (UTF-16 BE) tag. */
function mlucText(icc, offset) {
    if (offset + 28 > icc.length) return '';
    const length = icc.readUInt32BE(offset + 20);
    const start = offset + icc.readUInt32BE(offset + 24);
    const bytes = Buffer.from(icc.subarray(start, Math.min(icc.length, start + length)));
    return bytes.length % 2 === 0 ? bytes.swap16().toString('utf16le') : '';
}

/** The text of an ICC profile's description tag (v2 `desc` or v4 `mluc`), or '' when there is none. */
function iccDescription(icc) {
    if (!Buffer.isBuffer(icc) || icc.length < 132) return '';
    const count = icc.readUInt32BE(128);
    for (let i = 0; i < count && 132 + i * 12 + 12 <= icc.length; i++) {
        const at = 132 + i * 12;
        if (icc.toString('latin1', at, at + 4) !== 'desc') continue;
        const offset = icc.readUInt32BE(at + 4);
        if (offset + 12 > icc.length) return '';
        const type = icc.toString('latin1', offset, offset + 4);
        if (type === 'desc') {
            const length = icc.readUInt32BE(offset + 8);
            return icc.toString('latin1', offset + 12, Math.min(icc.length, offset + 12 + length)).split('\0')[0];
        }
        return type === 'mluc' ? mlucText(icc, offset) : '';
    }
    return '';
}

/** True when the picture needs no colour conversion: no profile, or an sRGB one. */
function isSrgbProfile(icc) {
    return !icc || /srgb/i.test(iccDescription(icc));
}

/**
 * Encode a picture for Scry: sRGB, <= 2048 px, <= 4 MB, decodable. `open()` returns a fresh sharp pipeline
 * on the source each time (a pipeline is single use).
 *
 * @returns {Promise<{bytes:Buffer, family:'png'|'jpeg', width:number, height:number} | null>} null when no attempt fits
 */
async function encodeForScry(open) {
    for (const attempt of ATTEMPTS) {
        let pipeline = open()
            .resize({ width: attempt.max, height: attempt.max, fit: 'inside', withoutEnlargement: true })
            .toColourspace('srgb');
        pipeline = attempt.format === 'png'
            ? pipeline.png({ compressionLevel: 9 })
            : pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: attempt.quality });
        const bytes = await pipeline.toBuffer();
        const dims = measure(bytes);
        if (dims && !outputProblem(bytes, dims)) return { bytes, family: dims.family, width: dims.width, height: dims.height };
    }
    return null;
}

/** sharp's options for reading a source file: never more than the refusal limit, first page/frame only. */
function readOptions(extra = {}) {
    return { limitInputPixels: MAX_SOURCE_PIXELS, sequentialRead: true, failOn: 'error', ...extra };
}

module.exports = {
    ATTEMPTS,
    MAX_SOURCE_EDGE,
    MAX_SOURCE_PIXELS,
    MAX_RASTER_BYTES,
    MAX_RASTER_DIMENSION,
    sharp,
    tooLarge,
    iccDescription,
    isSrgbProfile,
    encodeForScry,
    readOptions,
};
