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
const zlib = require('zlib');
const { stripMetadata } = require('./importStrip.js');

// SCF limits (what the validator accepts) ...
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 16384;
// ... and the smaller bounds every picture is held to. Stage proved the SCF limits are not what the models behind
// captioning and embeddings accept: a 16384 x 16384 PNG passes the validator and is then refused by OpenAI with
// `image_parse_error`, and an image over 5 MB is refused by Jina (422); either fails the whole chunk it is in.
// Anything we convert is rendered at or below these.
const MAX_RASTER_DIMENSION = 2048;
const MAX_RASTER_BYTES = 4 * 1024 * 1024; // Jina refuses an image over 5,242,880 bytes (422), so keep clear of it
// A picture that is already PNG/JPEG/WebP is used as it is only when it is within the bytes above and this edge
// (stage indexed 4096 px; 16384 px was refused). Larger ones are re-encoded down to MAX_RASTER_DIMENSION.
const MAX_NATIVE_DIMENSION = 4096;
const TOOL_TIMEOUT_MS = 120_000;

// ImageMagick resource limits on every call: a hostile or corrupt PSD/TIFF/HEIC/PDF must not exhaust
// memory, disk or time on the customer's machine (time is in seconds, under TOOL_TIMEOUT_MS).
const MAGICK_LIMITS = Object.freeze([
    ['memory', '512MiB'],
    ['map', '1GiB'],
    ['disk', '2GiB'],
    ['area', '256MP'],
    ['time', '100'],
]);
const MAGICK_LIMIT_ARGS = Object.freeze(MAGICK_LIMITS.flatMap(([name, value]) => ['-limit', name, value]));

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

// Largest first: lossless PNG, then JPEG at shrinking sizes until the file is under the byte cap.
// No attempt is ever larger than MAX_RASTER_DIMENSION.
const ATTEMPTS = Object.freeze([
    { format: 'png', max: MAX_RASTER_DIMENSION, quality: 0 },
    { format: 'jpeg', max: MAX_RASTER_DIMENSION, quality: 90 },
    { format: 'jpeg', max: Math.round(MAX_RASTER_DIMENSION * 0.75), quality: 85 },
    { format: 'jpeg', max: Math.round(MAX_RASTER_DIMENSION * 0.5), quality: 80 },
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
        const args = [...MAGICK_LIMIT_ARGS, ...density, `${coder}:${input}[0]`, ...flat, '-strip', '-resize', resize, ...quality, `${attempt.format}:${output}`];
        return { file: tool, args };
    }
    if (tool === 'sips') {
        const options = attempt.quality ? ['-s', 'formatOptions', String(attempt.quality)] : [];
        return { file: 'sips', args: ['-s', 'format', attempt.format, ...options, '-Z', String(attempt.max), input, '--out', output] };
    }
    // pdftoppm writes <prefix>.png or <prefix>.jpg itself. -scale-to N makes the LONGEST edge exactly N (it
    // also enlarges a small page, which is how a 624 pt page became 16384 px), so N is always the bound.
    const flag = attempt.format === 'png' ? '-png' : '-jpeg';
    return { file: 'pdftoppm', args: [flag, '-singlefile', '-scale-to', String(attempt.max), input, output.replace(/\.(png|jpg)$/, '')] };
}

/** Converters for one file type, in the order they are tried. PDF/AI: pdftoppm first, it renders straight at the bound. */
function toolsFor(ext, tools) {
    const isPdf = (CONVERT_CODERS[ext] || NATIVE_CODERS[ext]) === 'pdf';
    const usable = tools.filter((t) => (t === 'pdftoppm' ? isPdf : true));
    return isPdf ? [...usable.filter((t) => t === 'pdftoppm'), ...usable.filter((t) => t !== 'pdftoppm')] : usable;
}

function runAttempt(tool, request, run) {
    const { file, args } = toolCommand(tool, request);
    const result = run(file, args, { stdio: 'ignore', timeout: TOOL_TIMEOUT_MS });
    return !result.error && result.status === 0 && fs.existsSync(request.output);
}

const PNG_CHANNELS = Object.freeze({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 });

/** Why the PNG pixel data cannot be read (truncated, corrupt or short), or null when it inflates to the full size. */
function pngDecodeProblem(buf) {
    const idat = [];
    let header = null;
    let ended = false;
    for (let offset = 8; offset + 12 <= buf.length && !ended; ) {
        const length = buf.readUInt32BE(offset);
        const type = buf.toString('latin1', offset + 4, offset + 8);
        if (offset + 12 + length > buf.length) return 'PNG is truncated';
        const data = buf.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colour: data[9], interlace: data[12] };
        if (type === 'IDAT') idat.push(data);
        ended = type === 'IEND';
        offset += 12 + length;
    }
    if (!header || !ended || idat.length === 0) return 'PNG is truncated';
    let pixels;
    try {
        pixels = zlib.inflateSync(Buffer.concat(idat));
    } catch {
        return 'PNG pixel data is corrupt';
    }
    const channels = PNG_CHANNELS[header.colour];
    if (header.interlace !== 0 || !channels) return null;
    const expected = header.height * (Math.ceil((header.width * channels * header.depth) / 8) + 1);
    return pixels.length === expected ? null : 'PNG pixel data is incomplete';
}

/** Why the converted picture must not be uploaded (does not decode, too big in pixels or bytes), or null when it is fine. */
function outputProblem(buf, dims) {
    if (dims.width > MAX_RASTER_DIMENSION || dims.height > MAX_RASTER_DIMENSION) {
        return `output was ${dims.width}x${dims.height}, over ${MAX_RASTER_DIMENSION} px`;
    }
    if (buf.length > MAX_RASTER_BYTES) return `output was ${(buf.length / 1048576).toFixed(1)} MB, over ${MAX_RASTER_BYTES / 1048576} MB`;
    if (dims.family === 'png') return pngDecodeProblem(buf);
    if (dims.family === 'jpeg' && !(buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9)) return 'JPEG is truncated';
    return null;
}

/** Read, strip and check one converter output. Returns {bytes, family, width, height} or {problem}. */
function acceptOutput(outputPath) {
    const raw = fs.readFileSync(outputPath);
    const family = measure(raw)?.family;
    const clean = family ? stripMetadata(raw, family) : null;
    const dims = clean ? measure(clean) : null;
    if (!clean || !dims) return { problem: 'output is not a readable PNG or JPEG' };
    const problem = outputProblem(clean, dims);
    return problem ? { problem } : { bytes: clean, ...dims };
}

/**
 * Convert (or re-encode a native image that is over the bound) with the first tool that works.
 * Every output is held to MAX_RASTER_DIMENSION and MAX_RASTER_BYTES and checked to decode; a file that
 * cannot be made valid comes back as a named skip, never as an image that is known to be unreadable.
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
    let lastProblem = 'the converter failed';
    try {
        for (const attempt of ATTEMPTS) {
            const output = path.join(dir, `out-${attempt.format}-${attempt.max}.${EXT_OF[attempt.format]}`);
            for (const tool of tools) {
                if (!runAttempt(tool, { input: file, coder, output, attempt }, run)) continue;
                const accepted = acceptOutput(output);
                if (!accepted.problem) return { ok: true, ...accepted };
                lastProblem = accepted.problem;
            }
        }
        const limits = `${MAX_RASTER_DIMENSION} px and ${MAX_RASTER_BYTES / 1048576} MB`;
        return { ok: false, reason: 'error', detail: `${ext} could not be converted to a valid PNG or JPEG within ${limits} (${lastProblem})` };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

module.exports = {
    MAGICK_LIMITS,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_DIMENSION,
    MAX_NATIVE_DIMENSION,
    MAX_RASTER_BYTES,
    MAX_RASTER_DIMENSION,
    NATIVE_EXTENSIONS,
    CONVERTIBLE_EXTENSIONS,
    detectTools,
    measure,
    outputProblem,
    convertFile,
};
