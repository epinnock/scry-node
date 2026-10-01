/**
 * `scry import`: remove embedded metadata from the image bytes that are uploaded (guarantee G5).
 *
 * A JPEG straight out of a camera or Bridge carries EXIF (GPS, camera serial, software paths),
 * XMP and IPTC inside the file. Reading the allow-listed XMP fields is not enough if the same
 * bytes then go to Scry whole, so each format is rewritten with an ALLOW-LIST of the segments or
 * chunks needed to display the picture (pixels, colour profile, transparency, animation). Anything
 * else is dropped. A file that does not parse returns null and is skipped by the caller.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set([
    'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'hIST',
    'cICP', 'mDCV', 'cLLI', 'acTL', 'fcTL', 'fdAT',
]);
// ALLOW-LIST: picture data, alpha, animation, colour profile. EXIF, XMP and any unknown chunk are dropped.
const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
const WEBP_FRAME_KEEP = new Set(['VP8 ', 'VP8L', 'ALPH']);
const WEBP_VP8X_EXIF_FLAG = 0x08;
const WEBP_VP8X_XMP_FLAG = 0x04;

// JPEG markers without a length field.
const JPEG_STANDALONE = new Set([0x01, 0xd8, 0xd9, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);
const JPEG_APP0 = 0xe0;
const JPEG_APP2 = 0xe2;
const JPEG_APP14 = 0xee;
const ICC_TAG = Buffer.from('ICC_PROFILE\0');

function keepJpegSegment(marker, buf, payloadStart) {
    if (marker === JPEG_APP0 || marker === JPEG_APP14) return true;
    if (marker === JPEG_APP2) return buf.subarray(payloadStart, payloadStart + ICC_TAG.length).equals(ICC_TAG);
    // APP1 (EXIF, XMP), APP3-APP13 (IPTC, Photoshop, maker notes), APP15 and COM comments are dropped;
    // every other marker (tables, frame header) is needed to decode the picture.
    return !(marker >= 0xe1 && marker <= 0xef) && marker !== 0xfe;
}

/** Marker at `offset` as {end, keep, scan, eoi}, or null when the file is malformed. Fill bytes and standalone markers are copied. */
function readJpegMarker(buf, offset) {
    const marker = buf[offset + 1];
    if (marker === 0xff) return { end: offset + 1, keep: false }; // fill byte
    if (marker === 0xd9) return { end: offset + 2, keep: true, eoi: true };
    if (JPEG_STANDALONE.has(marker)) return { end: offset + 2, keep: true };
    if (offset + 4 > buf.length) return null;
    const length = buf.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > buf.length) return null;
    return { end, keep: keepJpegSegment(marker, buf, offset + 4), scan: marker === 0xda };
}

/**
 * Offset of the next real marker after entropy-coded scan data starting at `from`: an FF that is not
 * followed by 00 (byte stuffing), D0-D7 (restart markers, part of the scan) or FF (fill). -1 when none.
 */
function endOfScanData(buf, from) {
    for (let i = from; i + 1 < buf.length; i++) {
        if (buf[i] !== 0xff) continue;
        const next = buf[i + 1];
        if (next === 0xff) continue; // fill: the second FF may start the marker
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            i++;
            continue;
        }
        return i;
    }
    return -1;
}

/**
 * Rewrites the JPEG as SOI, kept segments, every scan (progressive files have several), and EOI.
 * Output ends at the FIRST EOI: trailers after it (MPF gain maps, Samsung / motion-photo data,
 * appended EXIF) never survive, and APPn / COM segments between scans are dropped like the rest.
 */
function stripJpeg(buf) {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    const parts = [buf.subarray(0, 2)];
    let offset = 2;
    while (offset + 2 <= buf.length) {
        if (buf[offset] !== 0xff) return null;
        const seg = readJpegMarker(buf, offset);
        if (!seg) return null;
        if (seg.keep) parts.push(buf.subarray(offset, seg.end));
        if (seg.eoi) return Buffer.concat(parts);
        offset = seg.end;
        if (seg.scan) {
            const next = endOfScanData(buf, offset);
            if (next < 0) return null; // scan data runs to the end of the file: truncated, no EOI
            parts.push(buf.subarray(offset, next));
            offset = next;
        }
    }
    return null;
}

function stripPng(buf) {
    if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    const parts = [PNG_SIGNATURE];
    let offset = 8;
    let sawEnd = false;
    while (offset + 12 <= buf.length && !sawEnd) {
        const length = buf.readUInt32BE(offset);
        const end = offset + 12 + length;
        if (end > buf.length) return null;
        const type = buf.toString('latin1', offset + 4, offset + 8);
        if (PNG_KEEP.has(type)) parts.push(buf.subarray(offset, end));
        sawEnd = type === 'IEND';
        offset = end;
    }
    return sawEnd ? Buffer.concat(parts) : null;
}

function riffChunk(fourcc, payload) {
    const head = Buffer.alloc(8);
    head.write(fourcc, 0, 'latin1');
    head.writeUInt32LE(payload.length, 4);
    return Buffer.concat([head, payload, Buffer.alloc(payload.length % 2)]); // odd sizes are padded with a zero byte
}

/** An animation frame is a 16-byte header plus sub-chunks; only the picture sub-chunks stay. */
function stripAnimationFrame(payload) {
    if (payload.length < 16) return null;
    const parts = [Buffer.from(payload.subarray(0, 16))];
    let offset = 16;
    while (offset + 8 <= payload.length) {
        const fourcc = payload.toString('latin1', offset, offset + 4);
        const size = payload.readUInt32LE(offset + 4);
        const dataEnd = offset + 8 + size;
        if (dataEnd > payload.length) return null;
        if (WEBP_FRAME_KEEP.has(fourcc)) parts.push(riffChunk(fourcc, payload.subarray(offset + 8, dataEnd)));
        offset = dataEnd + (size % 2);
    }
    return Buffer.concat(parts);
}

/** One allow-listed chunk, rebuilt: frames lose unknown sub-chunks, VP8X loses its EXIF and XMP flags. */
function keepWebpChunk(fourcc, data) {
    const payload = fourcc === 'ANMF' ? stripAnimationFrame(data) : Buffer.from(data);
    if (!payload) return null;
    if (fourcc === 'VP8X' && payload.length > 0) payload[0] &= ~(WEBP_VP8X_EXIF_FLAG | WEBP_VP8X_XMP_FLAG);
    return riffChunk(fourcc, payload);
}

function stripWebp(buf) {
    if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
    const chunks = [];
    let offset = 12;
    // The RIFF size field bounds the file; bytes after it are not part of the picture.
    const riffEnd = Math.min(buf.length, 8 + buf.readUInt32LE(4));
    while (offset + 8 <= riffEnd) {
        const fourcc = buf.toString('latin1', offset, offset + 4);
        const size = buf.readUInt32LE(offset + 4);
        const dataEnd = offset + 8 + size;
        if (dataEnd > buf.length) return null;
        if (WEBP_KEEP.has(fourcc)) {
            const chunk = keepWebpChunk(fourcc, buf.subarray(offset + 8, dataEnd));
            if (!chunk) return null;
            chunks.push(chunk);
        }
        offset = dataEnd + (size % 2);
    }
    if (chunks.length === 0) return null;
    const body = Buffer.concat(chunks);
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'latin1');
    header.writeUInt32LE(4 + body.length, 4);
    header.write('WEBP', 8, 'latin1');
    return Buffer.concat([header, body]);
}

/**
 * @param {Buffer} buf
 * @param {'png'|'jpeg'|'webp'} family
 * @returns {Buffer|null} the same picture without embedded metadata, or null when it does not parse
 */
function stripMetadata(buf, family) {
    if (family === 'jpeg') return stripJpeg(buf);
    if (family === 'png') return stripPng(buf);
    if (family === 'webp') return stripWebp(buf);
    return null;
}

module.exports = { stripMetadata };
