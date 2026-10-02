/**
 * Generated fixtures for the Scry Sync converter tests: PSD/PSB, PDF, AI and InDesign files built byte by byte.
 * No real customer file is used anywhere.
 */
const sharp = require('sharp');

function u16(n) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    return b;
}
function u32(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
}
function u64(n) {
    const b = Buffer.alloc(8);
    b.writeUInt32BE(Math.floor(n / 2 ** 32), 0);
    b.writeUInt32BE(n % 2 ** 32, 4);
    return b;
}

function resource(id, data) {
    const padded = data.length % 2 ? Buffer.concat([data, Buffer.alloc(1)]) : data;
    return Buffer.concat([Buffer.from('8BIM', 'latin1'), u16(id), Buffer.from([0, 0]), u32(data.length), padded]);
}

/** PackBits: literal runs of up to 128 bytes (valid, not optimal). */
function packBits(row) {
    const parts = [];
    for (let i = 0; i < row.length; i += 128) {
        const chunk = row.subarray(i, Math.min(row.length, i + 128));
        parts.push(Buffer.from([chunk.length - 1]), chunk);
    }
    return Buffer.concat(parts);
}

/**
 * A PSD (or PSB) whose saved composite is `planes` (one Buffer per channel, rows top to bottom, big-endian samples).
 * @param {object} o
 * @param {number} o.width
 * @param {number} o.height
 * @param {number} [o.mode] 1 grey, 2 indexed, 3 RGB, 4 CMYK, 9 Lab
 * @param {number} [o.depth] 8, 16 or 32
 * @param {Buffer[]} o.planes
 * @param {boolean} [o.psb]
 * @param {boolean} [o.rle]
 * @param {boolean|null} [o.merged] VersionInfo hasRealMergedData; null leaves the resource out
 * @param {Buffer} [o.icc]
 * @param {Buffer} [o.palette] 768 bytes for indexed
 * @param {number} [o.compression] write this compression code instead (e.g. 2 = ZIP)
 */
function makePsd({ width, height, mode = 3, depth = 8, planes, psb = false, rle = false, merged = true, icc, palette, compression }) {
    const header = Buffer.concat([Buffer.from('8BPS', 'latin1'), u16(psb ? 2 : 1), Buffer.alloc(6), u16(planes.length), u32(height), u32(width), u16(depth), u16(mode)]);
    const colourData = palette ? Buffer.concat([u32(palette.length), palette]) : u32(0);
    const resources = [];
    if (merged !== null) resources.push(resource(1057, Buffer.concat([u32(1), Buffer.from([merged ? 1 : 0])])));
    if (icc) resources.push(resource(1039, icc));
    const resourceBlock = Buffer.concat(resources);
    const layers = psb ? u64(0) : u32(0);
    const rowBytes = Math.ceil((width * depth) / 8);
    let image;
    if (compression !== undefined) {
        image = Buffer.concat([u16(compression), Buffer.alloc(16)]);
    } else if (rle) {
        const rows = [];
        for (const plane of planes) for (let y = 0; y < height; y++) rows.push(packBits(plane.subarray(y * rowBytes, (y + 1) * rowBytes)));
        const counts = rows.map((r) => (psb ? u32(r.length) : u16(r.length)));
        image = Buffer.concat([u16(1), ...counts, ...rows]);
    } else {
        image = Buffer.concat([u16(0), ...planes]);
    }
    return Buffer.concat([header, colourData, u32(resourceBlock.length), resourceBlock, layers, image]);
}

/** Channel planes of a solid 8-bit colour. */
function solidPlanes(width, height, values) {
    return values.map((v) => Buffer.alloc(width * height, v));
}

/**
 * A PDF with one page per entry of `pages` ({w, h} in points); `text: true` draws Helvetica (not embedded).
 */
function makePdf(pages, { text = false, header = '%PDF-1.4\n' } = {}) {
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null];
    const kids = [];
    const font = text ? objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>') : 0;
    for (const p of pages) {
        const stream = text ? 'BT /F1 24 Tf 20 20 Td (Scry) Tj ET\n0 0 1 rg 10 60 50 50 re f\n' : '1 0 0 rg 10 10 50 50 re f\n';
        const content = objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
        const resources = text ? `/Resources << /Font << /F1 ${font} 0 R >> >>` : '';
        kids.push(objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}] /Contents ${content} 0 R ${resources} >>`));
    }
    const refs = kids.map((k) => k + ' 0 R').join(' ');
    objects[1] = `<< /Type /Pages /Kids [${refs}] /Count ${kids.length} >>`;
    let body = header;
    const offsets = objects.map((o, i) => {
        const at = Buffer.byteLength(body, 'latin1');
        body += `${i + 1} 0 obj\n${o}\nendobj\n`;
        return at;
    });
    const xref = Buffer.byteLength(body, 'latin1');
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(body, 'latin1');
}

/** An Illustrator file saved with PDF compatibility (a PDF with Illustrator's header comment). */
function makeAiWithPdf() {
    return makePdf([{ w: 200, h: 100 }], { header: '%PDF-1.5\n%\xe2\xe3\xcf\xd3\n%AI12_FileFormatLevel: 3\n' });
}

/** An Illustrator file saved WITHOUT PDF compatibility: PostScript only. */
function makeAiWithoutPdf() {
    return Buffer.from('%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator(R) 24.0\n%AI5_FileFormat 14.0\n%%EOF\n', 'latin1');
}

/** The start of an InDesign document (its GUID header). */
function makeIndd() {
    return Buffer.concat([Buffer.from([0x06, 0x06, 0xed, 0xf5, 0xd8, 0x1d, 0x46, 0xe5, 0xbd, 0x31, 0xef, 0xe7, 0xfe, 0x74, 0xb7, 0x1d]), Buffer.alloc(4080)]);
}

/** A PNG of one colour tagged with sharp's built-in Display P3 profile. */
function makeP3Png(width = 16, height = 16, rgb = [255, 0, 0]) {
    return sharp({ create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
        .withIccProfile('p3', { attach: true })
        .png()
        .toBuffer();
}

/** A CMYK JPEG (with the profile libvips uses, so it carries an ICC profile). */
function makeCmykJpeg(width = 16, height = 16) {
    return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 128, b: 255 } } })
        .withIccProfile('cmyk')
        .jpeg()
        .toBuffer();
}

async function pixel(bytes, x = 0, y = 0) {
    const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (y * info.width + x) * info.channels;
    return [...data.subarray(at, at + 3)];
}

module.exports = { makePsd, solidPlanes, makePdf, makeAiWithPdf, makeAiWithoutPdf, makeIndd, makeP3Png, makeCmykJpeg, pixel, packBits };
