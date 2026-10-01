/**
 * `scry import`: turn one source file into a PNG, JPEG or WebP that fits the SCF limits
 * (20 MB, 16384 px on the longest side) and carries no embedded metadata.
 *
 * Files that are already PNG/JPEG/WebP are used as they are (metadata stripped in-process,
 * see importStrip.js). PSD, TIFF, HEIC, PDF and AI are converted on this machine with a tool
 * that is already installed (ImageMagick, macOS sips, poppler's pdftoppm): the original never
 * leaves the machine, and no image library is added to the CLI. A missing tool is reported per
 * file as a skip reason, never a crash.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { stripMetadata } = require('./importStrip.js');

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 16384;
const TOOL_TIMEOUT_MS = 120_000;

const NATIVE_CODERS = Object.freeze({ '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' });
const CONVERT_CODERS = Object.freeze({
    '.psd': 'psd',
    '.tif': 'tiff',
    '.tiff': 'tiff',
    '.heic': 'heic',
    '.heif': 'heic',
    '.pdf': 'pdf',
    '.ai': 'pdf',
});
const NATIVE_EXTENSIONS = new Set(Object.keys(NATIVE_CODERS));
const CONVERTIBLE_EXTENSIONS = new Set(Object.keys(CONVERT_CODERS));

// Largest first: lossless PNG, then JPEG at shrinking sizes until the file is under the limit.
const ATTEMPTS = Object.freeze([
    { format: 'png', max: MAX_IMAGE_DIMENSION, quality: 0 },
    { format: 'jpeg', max: MAX_IMAGE_DIMENSION, quality: 90 },
    { format: 'jpeg', max: 8192, quality: 85 },
    { format: 'jpeg', max: 4096, quality: 80 },
]);

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const JPEG_STANDALONE = new Set([0x01, 0xd8, 0xd9, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);

function pngSize(buf) {
    if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf) {
    let offset = 2;
    while (offset + 4 <= buf.length) {
        if (buf[offset] !== 0xff) {
            offset++;
            continue;
        }
        const marker = buf[offset + 1];
        if (marker === 0xd9) return null;
        if (JPEG_STANDALONE.has(marker)) {
            offset += 2;
            continue;
        }
        if (JPEG_SOF.has(marker)) {
            return offset + 9 > buf.length ? null : { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        }
        offset += 2 + buf.readUInt16BE(offset + 2);
    }
    return null;
}

function webpSize(buf) {
    if (buf.length < 30) return null;
    const type = buf.toString('latin1', 12, 16);
    const d = buf.subarray(20);
    if (type === 'VP8X') return { width: d.readUIntLE(4, 3) + 1, height: d.readUIntLE(7, 3) + 1 };
    if (type === 'VP8L' && d[0] === 0x2f) {
        return { width: 1 + (((d[2] & 0x3f) << 8) | d[1]), height: 1 + (((d[4] & 0xf) << 10) | (d[3] << 2) | (d[2] >> 6)) };
    }
    if (type === 'VP8 ' && d[3] === 0x9d && d[4] === 0x01 && d[5] === 0x2a) {
        return { width: (d[6] | (d[7] << 8)) & 0x3fff, height: (d[8] | (d[9] << 8)) & 0x3fff };
    }
    return null;
}

/** PNG, JPEG or WebP by magic bytes, with the size from the header (same rules as the SCF validator). */
function measure(buf) {
    let family = null;
    if (buf.length >= 4 && buf.readUInt32BE(0) === 0x89504e47) family = 'png';
    else if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) family = 'jpeg';
    else if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') family = 'webp';
    if (!family) return null;
    const size = { png: pngSize, jpeg: jpegSize, webp: webpSize }[family](buf);
    return size ? { family, ...size } : null;
}

function toolPresent(name, args, run) {
    const result = run(name, args, { stdio: 'ignore', timeout: 10_000 });
    return !result.error && result.status === 0;
}

/** Names of the converters installed on this machine, in preference order. */
function detectTools(run = spawnSync) {
    const tools = [];
    if (toolPresent('magick', ['-version'], run)) tools.push('magick');
    else if (process.platform !== 'win32' && toolPresent('convert', ['-version'], run)) tools.push('convert');
    if (process.platform === 'darwin' && toolPresent('sips', ['--version'], run)) tools.push('sips');
    if (toolPresent('pdftoppm', ['-v'], run)) tools.push('pdftoppm');
    return tools;
}

const EXT_OF = { png: 'png', jpeg: 'jpg' };

/** argv for one tool. Explicit coder prefixes stop ImageMagick sniffing content and picking a delegate. */
function toolCommand(tool, { input, coder, output, attempt }) {
    const flatten = ['-background', 'white', '-alpha', 'remove', '-alpha', 'off'];
    const resize = `${attempt.max}x${attempt.max}>`;
    if (tool === 'magick' || tool === 'convert') {
        const quality = attempt.quality ? ['-quality', String(attempt.quality)] : [];
        const density = coder === 'pdf' ? ['-density', '150'] : [];
        const flat = attempt.format === 'jpeg' || coder === 'pdf' ? flatten : [];
        const args = [...density, `${coder}:${input}[0]`, ...flat, '-strip', '-resize', resize, ...quality, `${attempt.format}:${output}`];
        return { file: tool, args };
    }
    if (tool === 'sips') {
        const options = attempt.quality ? ['-s', 'formatOptions', String(attempt.quality)] : [];
        return { file: 'sips', args: ['-s', 'format', attempt.format, ...options, '-Z', String(attempt.max), input, '--out', output] };
    }
    // pdftoppm writes <prefix>.png or <prefix>.jpg itself.
    const flag = attempt.format === 'png' ? '-png' : '-jpeg';
    return { file: 'pdftoppm', args: [flag, '-singlefile', '-r', '150', '-scale-to', String(attempt.max), input, output.replace(/\.(png|jpg)$/, '')] };
}

function toolsFor(ext, tools) {
    const coder = CONVERT_CODERS[ext] || NATIVE_CODERS[ext];
    const isPdf = coder === 'pdf';
    return tools.filter((t) => (t === 'pdftoppm' ? isPdf : true));
}

function runAttempt(tool, request, run) {
    const { file, args } = toolCommand(tool, request);
    const result = run(file, args, { stdio: 'ignore', timeout: TOOL_TIMEOUT_MS });
    return !result.error && result.status === 0 && fs.existsSync(request.output);
}

/** Read, strip and size-check one converter output. Returns {bytes, family, width, height} or null. */
function acceptOutput(outputPath) {
    const raw = fs.readFileSync(outputPath);
    const family = measure(raw)?.family;
    const clean = family ? stripMetadata(raw, family) : null;
    const dims = clean ? measure(clean) : null;
    if (!clean || !dims) return null;
    const fits = clean.length <= MAX_IMAGE_BYTES && dims.width <= MAX_IMAGE_DIMENSION && dims.height <= MAX_IMAGE_DIMENSION;
    return fits ? { bytes: clean, ...dims } : null;
}

/**
 * Convert (or re-encode a too-large native image) with the first tool that works.
 *
 * @param {string} file absolute path of the source file
 * @param {string} ext lower-case extension with the dot
 * @param {{tools?:string[], run?:Function}} [opts]
 * @returns {Promise<{ok:true, bytes:Buffer, family:string, width:number, height:number} | {ok:false, reason:string, detail:string}>}
 */
async function convertFile(file, ext, opts = {}) {
    const run = opts.run || spawnSync;
    const tools = toolsFor(ext, opts.tools || detectTools(run));
    if (tools.length === 0) {
        const hint = CONVERT_CODERS[ext] ? 'install ImageMagick (magick) or, for PDF/AI, poppler (pdftoppm)' : 'install ImageMagick (magick)';
        return { ok: false, reason: 'unsupported', detail: `no converter for ${ext} on this machine; ${hint}` };
    }
    const coder = CONVERT_CODERS[ext] || NATIVE_CODERS[ext];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scry-import-conv-'));
    try {
        for (const attempt of ATTEMPTS) {
            const output = path.join(dir, `out-${attempt.format}-${attempt.max}.${EXT_OF[attempt.format]}`);
            for (const tool of tools) {
                if (!runAttempt(tool, { input: file, coder, output, attempt }, run)) continue;
                const accepted = acceptOutput(output);
                if (accepted) return { ok: true, ...accepted };
            }
        }
        return { ok: false, reason: 'error', detail: `${ext} could not be converted to a PNG or JPEG under 20 MB and 16384 px` };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

module.exports = {
    MAX_IMAGE_BYTES,
    MAX_IMAGE_DIMENSION,
    NATIVE_EXTENSIONS,
    CONVERTIBLE_EXTENSIONS,
    detectTools,
    measure,
    convertFile,
};
