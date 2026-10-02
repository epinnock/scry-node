/**
 * PSD / PSB: read the flattened picture Photoshop saved in the file (the "Image Data" section), never the layers.
 *
 * Why only that picture: Photoshop has already applied every blend mode, smart object, adjustment and text layer
 * to it. Rebuilding a picture from layers is not faithful (the lab measured 36% of pixels off on one sample), so it
 * is never done here. A file saved without "Maximize Compatibility" has no real flattened picture: Photoshop
 * records that in image resource 1057 (VersionInfo, `hasRealMergedData = 0`). Such a file still gets its saved
 * picture converted, but the verdict is `approximate` with the fix, never `faithful`.
 *
 * Memory stays bounded whatever the file size: rows are read one at a time (raw or PackBits/RLE) and averaged
 * straight into a picture of at most 2048 px (a box filter), one colour channel after another. A file over
 * 16,384 px on a side or 200 megapixels is refused from its header, before any pixel is read.
 *
 * Format reference: Adobe Photoshop File Formats Specification (PSD version 1, PSB version 2). The lab's results
 * (research/conversion-lab, psd-tools as the oracle) are the expected outputs.
 */
const fs = require('fs');
const { encodeTiff } = require('./tiff.js');
const { tooLarge, MAX_RASTER_DIMENSION } = require('./raster.js');

const MODE = Object.freeze({ bitmap: 0, grey: 1, indexed: 2, rgb: 3, cmyk: 4, multichannel: 7, duotone: 8, lab: 9 });
const BASE_CHANNELS = Object.freeze({ 0: 1, 1: 1, 2: 1, 3: 3, 4: 4, 8: 1 });
const SPACE_OF_MODE = Object.freeze({ 0: 'grey', 1: 'grey', 2: 'rgb', 3: 'rgb', 4: 'cmyk', 8: 'grey' });
const RESOURCE_VERSION_INFO = 1057;
const RESOURCE_ICC_PROFILE = 1039;
const READ_CHUNK = 1024 * 1024;

class PsdFormatError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'PsdFormatError';
        this.code = code; // a FAILED code from verdicts.js
    }
}

/** Sequential reads from a file descriptor through a 1 MB buffer. Returned buffers are valid until the next read. */
class Reader {
    constructor(fd, size) {
        this.fd = fd;
        this.size = size;
        this.pos = 0;
        this.buf = Buffer.alloc(READ_CHUNK);
        this.bufStart = 0;
        this.bufLen = 0;
    }

    read(n) {
        if (n < 0 || this.pos + n > this.size) throw new PsdFormatError('unreadable', 'file ends early');
        const offset = this.pos - this.bufStart;
        if (offset < 0 || offset + n > this.bufLen) {
            if (n > this.buf.length) this.buf = Buffer.alloc(n);
            this.bufStart = this.pos;
            this.bufLen = fs.readSync(this.fd, this.buf, 0, Math.min(this.buf.length, this.size - this.pos), this.pos);
            if (this.bufLen < n) throw new PsdFormatError('unreadable', 'file ends early');
        }
        const start = this.pos - this.bufStart;
        this.pos += n;
        return this.buf.subarray(start, start + n);
    }

    skip(n) {
        if (n < 0 || this.pos + n > this.size) throw new PsdFormatError('unreadable', 'file ends early');
        this.pos += n;
    }

    u16() {
        return this.read(2).readUInt16BE(0);
    }

    u32() {
        return this.read(4).readUInt32BE(0);
    }

    /** PSB lengths are 8 bytes. */
    length(isPsb) {
        if (!isPsb) return this.u32();
        const b = this.read(8);
        return b.readUInt32BE(0) * 2 ** 32 + b.readUInt32BE(4);
    }
}

function readHeader(r) {
    const head = r.read(26);
    if (head.toString('latin1', 0, 4) !== '8BPS') throw new PsdFormatError('unreadable', 'not a Photoshop file');
    const version = head.readUInt16BE(4);
    const header = {
        version,
        isPsb: version === 2,
        channels: head.readUInt16BE(12),
        height: head.readUInt32BE(14),
        width: head.readUInt32BE(18),
        depth: head.readUInt16BE(22),
        mode: head.readUInt16BE(24),
    };
    const ok = (version === 1 || version === 2) && header.channels >= 1 && header.channels <= 56
        && header.width >= 1 && header.height >= 1 && [1, 8, 16, 32].includes(header.depth);
    if (!ok) throw new PsdFormatError('unreadable', 'damaged Photoshop header');
    return header;
}

/** Image resources: the VersionInfo flag and the ICC profile, everything else skipped. */
function readResources(r) {
    const length = r.u32();
    const end = r.pos + length;
    const found = { hasRealMergedData: true, icc: null };
    while (r.pos + 12 <= end) {
        if (r.read(4).toString('latin1') !== '8BIM') break;
        const id = r.u16();
        const nameLength = r.read(1)[0];
        r.skip(nameLength + ((nameLength + 1) % 2)); // Pascal string, padded to an even total
        const size = r.u32();
        const padded = size + (size % 2);
        if (r.pos + padded > end) throw new PsdFormatError('unreadable', 'damaged image resources');
        if (id === RESOURCE_VERSION_INFO && size >= 5) {
            found.hasRealMergedData = r.read(5)[4] !== 0;
            r.skip(padded - 5);
        } else if (id === RESOURCE_ICC_PROFILE && size > 0) {
            found.icc = Buffer.from(r.read(size));
            r.skip(padded - size);
        } else {
            r.skip(padded);
        }
    }
    r.pos = end;
    return found;
}

/** PackBits (Photoshop RLE) into `out`; throws when the row does not fill exactly. */
function unpackBits(src, out) {
    let i = 0;
    let o = 0;
    while (i < src.length && o < out.length) {
        const n = src[i++];
        if (n < 128) {
            const len = n + 1;
            if (i + len > src.length || o + len > out.length) break;
            src.copy(out, o, i, i + len);
            i += len;
            o += len;
        } else if (n > 128) {
            const len = 257 - n;
            if (i >= src.length || o + len > out.length) break;
            out.fill(src[i++], o, o + len);
            o += len;
        }
    }
    if (o !== out.length) throw new PsdFormatError('unreadable', 'damaged compressed row');
}

function srgbEncode(linear) {
    const v = Number.isFinite(linear) ? Math.min(1, Math.max(0, linear)) : 0;
    return v <= 0.0031308 ? v * 12.92 * 255 : (1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;
}

/** One row of samples as 0..255 values (32-bit is tone-mapped from linear light). */
function rowSampler(depth) {
    if (depth === 8) return (row, x) => row[x];
    if (depth === 16) return (row, x) => row.readUInt16BE(x * 2) / 257;
    if (depth === 32) return (row, x) => srgbEncode(row.readFloatBE(x * 4));
    return (row, x) => ((row[x >> 3] >> (7 - (x & 7))) & 1 ? 0 : 255); // bitmap mode: 1 is black
}

/** Which target column/row each source column/row averages into, and how many sources land in each target. */
function boxMap(source, target) {
    const map = new Uint32Array(source);
    const counts = new Uint32Array(target);
    for (let i = 0; i < source; i++) {
        map[i] = Math.min(target - 1, Math.floor((i * target) / source));
        counts[map[i]] += 1;
    }
    return { map, counts };
}

function targetSize(width, height) {
    const scale = Math.min(1, MAX_RASTER_DIMENSION / Math.max(width, height));
    return { tw: Math.max(1, Math.round(width * scale)), th: Math.max(1, Math.round(height * scale)) };
}

/** RLE: the byte length of every row of every channel (u16 in a PSD, u32 in a PSB); only the base channels are kept. */
function readRowLengths(r, header, base) {
    const unit = header.isPsb ? 4 : 2;
    const table = r.read(header.channels * header.height * unit);
    const rowLengths = new Uint32Array(base * header.height);
    for (let i = 0; i < rowLengths.length; i++) rowLengths[i] = header.isPsb ? table.readUInt32BE(i * 4) : table.readUInt16BE(i * 2);
    return rowLengths;
}

/** Add one indexed row, expanded through the palette, into the RGB planes. */
function addIndexedRow(planes, row, width, at, colMap, palette) {
    for (let x = 0; x < width; x++) {
        const index = row[x];
        const t = at + colMap[x];
        planes[0][t] += palette[index];
        planes[1][t] += palette[256 + index];
        planes[2][t] += palette[512 + index];
    }
}

/** Add one row of one channel into its plane. */
function addSampledRow(plane, row, width, at, colMap, sample) {
    for (let x = 0; x < width; x++) plane[at + colMap[x]] += sample(row, x);
}

/** Read the base colour channels row by row into averaged planes (indexed: expanded to RGB through the palette). */
function readPlanes(r, header, palette) {
    const { width, height, depth, mode } = header;
    const base = BASE_CHANNELS[mode];
    const compression = r.u16();
    if (compression !== 0 && compression !== 1) throw new PsdFormatError('unsupported_compression', `compression ${compression}`);
    const rowBytes = Math.ceil((width * depth) / 8);
    const rowLengths = compression === 1 ? readRowLengths(r, header, base) : null;
    const { tw, th } = targetSize(width, height);
    const cols = boxMap(width, tw);
    const rows = boxMap(height, th);
    const sample = rowSampler(depth);
    const outPlanes = mode === MODE.indexed ? 3 : base;
    const planes = Array.from({ length: outPlanes }, () => new Float32Array(tw * th));
    const row = Buffer.alloc(rowBytes);
    const readRow = (i) => (rowLengths ? unpackBits(r.read(rowLengths[i]), row) : r.read(rowBytes).copy(row));
    const addRow = palette
        ? (c, at) => addIndexedRow(planes, row, width, at, cols.map, palette)
        : (c, at) => addSampledRow(planes[c], row, width, at, cols.map, sample);
    for (let c = 0; c < base; c++) {
        for (let y = 0; y < height; y++) {
            readRow(c * height + y);
            addRow(c, rows.map[y] * tw);
        }
    }
    return { tw, th, planes, cols, rows };
}

/** Interleave the averaged planes into 8-bit pixels (CMYK inverted: Photoshop stores 0 as full ink, TIFF as none). */
function interleave({ tw, th, planes, cols, rows }, invert) {
    const n = planes.length;
    const pixels = Buffer.alloc(tw * th * n);
    for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
            const t = ty * tw + tx;
            const count = cols.counts[tx] * rows.counts[ty];
            for (let c = 0; c < n; c++) {
                const v = Math.round(planes[c][t] / count);
                pixels[t * n + c] = invert ? 255 - v : v;
            }
        }
    }
    return pixels;
}

/** The averaged planes as a TIFF (with the file's ICC profile where it applies) and the approximate codes. */
function toTiff(header, resources, planes) {
    const space = SPACE_OF_MODE[header.mode];
    const codes = [];
    if (!resources.hasRealMergedData) codes.push('psd_no_full_preview');
    if (header.depth === 32) codes.push('hdr_32bit');
    if (header.mode === MODE.duotone) codes.push('duotone_as_grey');
    // A 32-bit document's profile is a linear one; the tone-mapped pixels are already sRGB.
    const keepsProfile = header.depth !== 32 && header.mode !== MODE.bitmap && header.mode !== MODE.duotone;
    const icc = keepsProfile ? resources.icc : null;
    if (space === 'cmyk' && !icc) codes.push('cmyk_no_icc');
    const tiff = encodeTiff({ width: planes.tw, height: planes.th, space, pixels: interleave(planes, space === 'cmyk'), icc });
    return { tiff, codes };
}

/**
 * Read a PSD/PSB's saved flattened picture, scaled to at most 2048 px.
 *
 * @param {string} file
 * @returns {{width:number, height:number, isPsb:boolean, tiff:Buffer|null, codes:string[], failure?:string}}
 *   `tiff` is the picture with the file's ICC profile, ready for sharp; `failure` is a FAILED code.
 */
function readPsdComposite(file) {
    const fd = fs.openSync(file, 'r');
    try {
        const r = new Reader(fd, fs.fstatSync(fd).size);
        const header = readHeader(r);
        const result = { width: header.width, height: header.height, isPsb: header.isPsb, tiff: null, codes: [] };
        if (tooLarge(header.width, header.height)) return { ...result, failure: 'too_large' };
        if (BASE_CHANNELS[header.mode] === undefined) return { ...result, failure: 'unsupported_colour_mode' };
        if (header.channels < BASE_CHANNELS[header.mode]) throw new PsdFormatError('unreadable', 'missing colour channels');

        const colourData = r.u32();
        const palette = header.mode === MODE.indexed && colourData >= 768 ? Buffer.from(r.read(768)) : null;
        r.skip(colourData - (palette ? 768 : 0));
        if (header.mode === MODE.indexed && !palette) throw new PsdFormatError('unreadable', 'indexed colour without a palette');
        const resources = readResources(r);
        r.skip(r.length(header.isPsb)); // layers and masks: never read

        return { ...result, ...toTiff(header, resources, readPlanes(r, header, palette)) };
    } catch (error) {
        if (error instanceof PsdFormatError) return { width: 0, height: 0, tiff: null, codes: [], failure: error.code };
        throw error;
    } finally {
        fs.closeSync(fd);
    }
}

module.exports = { MODE, PsdFormatError, readPsdComposite, unpackBits };
