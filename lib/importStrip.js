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
const WEBP_DROP = new Set(['EXIF', 'XMP ']);
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

/** Marker at `offset` as {end, keep, scan}, or null when the file is malformed. Fill bytes and standalone markers are copied. */
function readJpegMarker(buf, offset) {
    const marker = buf[offset + 1];
    if (marker === 0xff) return { end: offset + 1, keep: false }; // fill byte
    if (JPEG_STANDALONE.has(marker)) return { end: offset + 2, keep: true };
    if (offset + 4 > buf.length) return null;
    const length = buf.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > buf.length) return null;
    if (marker === 0xda) return { end: buf.length, keep: true, scan: true }; // entropy-coded data to the end
    return { end, keep: keepJpegSegment(marker, buf, offset + 4) };
}

function stripJpeg(buf) {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    const parts = [buf.subarray(0, 2)];
    let offset = 2;
    while (offset + 2 <= buf.length) {
        if (buf[offset] !== 0xff) return null;
        const seg = readJpegMarker(buf, offset);
        if (!seg) return null;
        if (seg.keep) parts.push(buf.subarray(offset, seg.end));
        if (seg.scan) return Buffer.concat(parts);
        offset = seg.end;
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

function stripWebp(buf) {
    if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
    const chunks = [];
    let offset = 12;
    while (offset + 8 <= buf.length) {
        const fourcc = buf.toString('latin1', offset, offset + 4);
        const size = buf.readUInt32LE(offset + 4);
        const end = offset + 8 + size + (size % 2);
        if (end > buf.length + 1) return null;
        if (!WEBP_DROP.has(fourcc)) {
            const chunk = Buffer.from(buf.subarray(offset, Math.min(end, buf.length)));
            if (fourcc === 'VP8X' && chunk.length > 8) chunk[8] &= ~(WEBP_VP8X_EXIF_FLAG | WEBP_VP8X_XMP_FLAG);
            chunks.push(chunk);
        }
        offset = end;
    }
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
