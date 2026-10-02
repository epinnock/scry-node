/**
 * Generated fixtures for the Scry Sync converter tests: PSD/PSB, PDF, AI and InDesign files built byte by byte.
 * No real customer file is used anywhere.
 */
const zlib = require('zlib');
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

function crc32(buf) {
    let c;
    let crc = 0xffffffff;
    for (let n = 0; n < buf.length; n += 1) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** A PNG with an `iCCP` chunk holding `icc` inserted before the first IDAT; the pixel values are NOT touched. */
function injectIccProfile(png, icc, name = 'profile') {
    const data = Buffer.concat([Buffer.from(`${name}\0\0`, 'latin1'), zlib.deflateSync(icc)]);
    const type = Buffer.from('iCCP', 'latin1');
    const chunk = Buffer.concat([u32(data.length), type, data, u32(crc32(Buffer.concat([type, data])))]);
    let at = 8;
    while (png.toString('latin1', at + 4, at + 8) !== 'IDAT') at += 12 + png.readUInt32BE(at);
    return Buffer.concat([png.subarray(0, at), chunk, png.subarray(at)]);
}

/**
 * A PNG whose stored numbers are `rgb` as DISPLAY P3 values: the pixels are written as given (no colour transform)
 * and sharp's Display P3 profile is injected as a chunk, as a camera or Photoshop would tag it.
 */
async function makeP3Png(width = 16, height = 16, rgb = [200, 130, 70]) {
    const icc = (await sharp({ create: { width: 1, height: 1, channels: 3, background: '#808080' } }).withIccProfile('p3', { attach: true }).png().toBuffer().then((b) => sharp(b).metadata())).icc;
    const plain = await sharp({ create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer();
    return injectIccProfile(plain, icc, 'Display P3');
}

/**
 * Independent expected sRGB value of a Display P3 colour (8-bit in, 8-bit out): the textbook path (CSS Color 4),
 * P3 transfer curve -> linear P3 -> XYZ (D65) -> linear sRGB -> sRGB curve, written out here with no library.
 */
function p3ToSrgb(rgb) {
    const decode = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const encode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
    const [r, g, b] = rgb.map((v) => decode(v / 255));
    const x = 0.4865709486482162 * r + 0.26566769316909306 * g + 0.1982172852343625 * b;
    const y = 0.2289745640697488 * r + 0.6917385218365064 * g + 0.079286914093745 * b;
    const z = 0.04511338185890264 * g + 1.043944368900976 * b;
    const lin = [
        3.2409699419045226 * x - 1.537383177570094 * y - 0.4986107602930034 * z,
        -0.9692436362808796 * x + 1.8759675015077202 * y + 0.04155505740717559 * z,
        0.05563007969699366 * x - 0.20397695888897652 * y + 1.0569715142428786 * z,
    ];
    return lin.map((v) => Math.round(Math.min(1, Math.max(0, encode(Math.min(1, Math.max(0, v))))) * 255));
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

module.exports = { makePsd, solidPlanes, makePdf, makeAiWithPdf, makeAiWithoutPdf, makeIndd, makeP3Png, injectIccProfile, p3ToSrgb, makeCmykJpeg, pixel, packBits };
