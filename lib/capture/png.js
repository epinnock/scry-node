/**
 * Minimal PNG decode / encode / crop for device screenshots (no native deps).
 *
 * Decodes 8-bit, non-interlaced greyscale, grey+alpha, RGB, RGBA and palette images — what
 * `adb exec-out screencap -p` and `xcrun simctl io booted screenshot` write — into RGBA.
 * Anything else throws PngUnsupportedError; callers then keep the uncropped image.
 */
const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class PngUnsupportedError extends Error {}

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** Width and height from the IHDR chunk, without decoding. */
function pngSize(buf) {
    if (buf.length < 24 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new PngUnsupportedError('not a PNG');
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Walk PNG chunks up to IEND, collecting the parts decodePng() needs. */
function parseChunks(buf) {
    let off = 8;
    let ihdr = null;
    let palette = null;
    let trns = null;
    const idat = [];
    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('latin1', off + 4, off + 8);
        const body = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            ihdr = {
                width: body.readUInt32BE(0),
                height: body.readUInt32BE(4),
                depth: body[8],
                colorType: body[9],
                interlace: body[12],
            };
        } else if (type === 'PLTE') palette = body;
        else if (type === 'tRNS') trns = body;
        else if (type === 'IDAT') idat.push(body);
        else if (type === 'IEND') break;
        off += 12 + len;
    }
    return { ihdr, palette, trns, idat };
}

/** Reverse one scanline's PNG filter (None/Sub/Up/Average/Paeth) in place into `out`. */
function unfilterScanline(line, prev, out, stride, channels, filter) {
    for (let i = 0; i < stride; i++) {
        const a = i >= channels ? out[i - channels] : 0;
        const b = prev[i];
        const c = i >= channels ? prev[i - channels] : 0;
        let v = line[i];
        switch (filter) {
            case 0: break;
            case 1: v += a; break;
            case 2: v += b; break;
            case 3: v += (a + b) >> 1; break;
            case 4: {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                let predicted;
                if (pa <= pb && pa <= pc) predicted = a;
                else if (pb <= pc) predicted = b;
                else predicted = c;
                v += predicted;
                break;
            }
            default: throw new PngUnsupportedError(`bad filter ${filter}`);
        }
        out[i] = v & 0xff;
    }
}

/** Reverse PNG's per-scanline filtering across the whole image into raw channel-interleaved pixels. */
function unfilterScanlines(raw, width, height, channels) {
    const stride = width * channels;
    const pixels = Buffer.alloc(stride * height);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const out = pixels.subarray(y * stride, (y + 1) * stride);
        unfilterScanline(line, prev, out, stride, channels, filter);
        prev = out;
    }
    return pixels;
}

/** Expand decoded, channel-interleaved pixels to RGBA per PNG colour type (0/2/3/4/6). */
function expandToRGBA(pixels, width, height, channels, colorType, palette, trns) {
    const data = Buffer.alloc(width * height * 4);
    for (let p = 0, q = 0; p < width * height; p++, q += 4) {
        const s = p * channels;
        if (colorType === 6) pixels.copy(data, q, s, s + 4);
        else if (colorType === 2) { data[q] = pixels[s]; data[q + 1] = pixels[s + 1]; data[q + 2] = pixels[s + 2]; data[q + 3] = 255; }
        else if (colorType === 0) { data[q] = data[q + 1] = data[q + 2] = pixels[s]; data[q + 3] = 255; }
        else if (colorType === 4) { data[q] = data[q + 1] = data[q + 2] = pixels[s]; data[q + 3] = pixels[s + 1]; }
        else {
            const idx = pixels[s];
            data[q] = palette[idx * 3]; data[q + 1] = palette[idx * 3 + 1]; data[q + 2] = palette[idx * 3 + 2];
            data[q + 3] = trns && idx < trns.length ? trns[idx] : 255;
        }
    }
    return data;
}

/** @returns {{width:number, height:number, data:Buffer}} RGBA, 4 bytes per pixel */
function decodePng(buf) {
    if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new PngUnsupportedError('not a PNG');
    const { ihdr, palette, trns, idat } = parseChunks(buf);
    if (!ihdr) throw new PngUnsupportedError('no IHDR');
    const { width, height, depth, colorType, interlace } = ihdr;
    if (depth !== 8 || interlace !== 0) throw new PngUnsupportedError(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    if (!channels) throw new PngUnsupportedError(`unsupported colour type ${colorType}`);
    if (colorType === 3 && !palette) throw new PngUnsupportedError('palette image without PLTE');

    const raw = zlib.inflateSync(Buffer.concat(idat));
    const pixels = unfilterScanlines(raw, width, height, channels);
    const data = expandToRGBA(pixels, width, height, channels, colorType, palette, trns);
    return { width, height, data };
}

function chunk(type, body) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
}

/** Encode RGBA pixels as an 8-bit RGBA PNG (filter 0 per row). */
function encodePng({ width, height, data }) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0;
        data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    return Buffer.concat([
        SIGNATURE,
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/**
 * Crop to a pixel rectangle, clamped to the image. Returns null when nothing is left.
 * @param {{width:number,height:number,data:Buffer}} img
 * @param {{x:number,y:number,width:number,height:number}} rect pixels (rounded here)
 */
function cropImage(img, rect) {
    const x0 = Math.max(0, Math.round(rect.x));
    const y0 = Math.max(0, Math.round(rect.y));
    const x1 = Math.min(img.width, Math.round(rect.x + rect.width));
    const y1 = Math.min(img.height, Math.round(rect.y + rect.height));
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    const w = x1 - x0;
    const h = y1 - y0;
    const data = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        img.data.copy(data, y * w * 4, ((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x1) * 4);
    }
    return { width: w, height: h, data, offset: { x: x0, y: y0 } };
}

/** Same pixels (decoded), regardless of how either file was compressed. */
function samePixels(a, b) {
    if (!a || !b) return false;
    if (a.equals && a.equals(b)) return true;
    try {
        const da = decodePng(a);
        const db = decodePng(b);
        return da.width === db.width && da.height === db.height && da.data.equals(db.data);
    } catch {
        return false;
    }
}

module.exports = { decodePng, encodePng, cropImage, samePixels, pngSize, PngUnsupportedError };
