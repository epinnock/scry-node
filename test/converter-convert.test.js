const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { convertFile, LIMITS } = require('../lib/converter');
const { measure } = require('../lib/importConvert.js');
const { tempDir, write, makePng, xmpPacket } = require('./helpers/importFixtures.js');
const fx = require('./helpers/syncFixtures.js');

// PDFium (WebAssembly) start-up and PNG encoding of full pages can take seconds on a busy CI runner.
jest.setTimeout(60_000);

let dir;
beforeAll(() => {
    dir = tempDir('sync-convert');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function expectScryPicture(p) {
    expect(['png', 'jpeg']).toContain(p.family);
    expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(LIMITS.MAX_RASTER_DIMENSION);
    expect(p.bytes.length).toBeLessThanOrEqual(LIMITS.MAX_RASTER_BYTES);
    expect(measure(p.bytes)).toMatchObject({ width: p.width, height: p.height });
}

async function convert(name, bytes, opts = {}) {
    return convertFile(write(dir, name, bytes), { tools: [], ...opts });
}

describe('PSD / PSB: the saved flattened picture only', () => {
    test('RGB PSD (raw) is faithful, colours exact', async () => {
        const r = await convert('rgb.psd', fx.makePsd({ width: 6, height: 4, planes: fx.solidPlanes(6, 4, [200, 100, 50]) }));
        expect(r).toMatchObject({ format: 'psd', verdict: 'faithful', codes: [], fix: null });
        expect(r.pictures).toHaveLength(1);
        expect(r.pictures[0].suffix).toBe('');
        expectScryPicture(r.pictures[0]);
        expect(await fx.pixel(r.pictures[0].bytes)).toEqual([200, 100, 50]);
    });

    test('PSB with RLE rows (u32 row counts, u64 layer length) is read', async () => {
        const planes = fx.solidPlanes(300, 2, [10, 20, 30]);
        const r = await convert('big.psb', fx.makePsd({ width: 300, height: 2, planes, psb: true, rle: true }));
        expect(r).toMatchObject({ format: 'psb', verdict: 'faithful' });
        expect(await fx.pixel(r.pictures[0].bytes, 299, 1)).toEqual([10, 20, 30]);
    });

    test('no Maximize Compatibility: approximate with the fix, never rebuilt from layers', async () => {
        const r = await convert('nomax.psd', fx.makePsd({ width: 4, height: 4, planes: fx.solidPlanes(4, 4, [255, 255, 255]), merged: false }));
        expect(r.verdict).toBe('approximate');
        expect(r.codes).toEqual(['psd_no_full_preview']);
        expect(r.reasons[0]).toMatch(/Maximize Compatibility/);
        expect(r.fix).toBe('In Photoshop, turn on Preferences > File Handling > "Maximize PSD and PSB File Compatibility", then save the file again.');
        expect(r.pictures).toHaveLength(1);
    });

    test('16-bit RGB and greyscale are faithful', async () => {
        const plane16 = Buffer.alloc(4 * 4 * 2);
        for (let i = 0; i < 16; i++) plane16.writeUInt16BE(0x8080, i * 2);
        const r16 = await convert('deep.psd', fx.makePsd({ width: 4, height: 4, depth: 16, planes: [plane16, plane16, plane16] }));
        expect(r16.verdict).toBe('faithful');
        expect(await fx.pixel(r16.pictures[0].bytes)).toEqual([128, 128, 128]);
        const grey = await convert('grey.psd', fx.makePsd({ width: 4, height: 4, mode: 1, planes: fx.solidPlanes(4, 4, [77]) }));
        expect(grey.verdict).toBe('faithful');
    });

    test('indexed colour is expanded through its palette', async () => {
        const palette = Buffer.alloc(768);
        palette[3] = 10; // index 3: r
        palette[256 + 3] = 200; // g
        palette[512 + 3] = 90; // b
        const r = await convert('indexed.psd', fx.makePsd({ width: 4, height: 4, mode: 2, planes: fx.solidPlanes(4, 4, [3]), palette }));
        expect(r.verdict).toBe('faithful');
        expect(await fx.pixel(r.pictures[0].bytes)).toEqual([10, 200, 90]);
    });

    test('32-bit is approximate (tone-mapped)', async () => {
        const plane = Buffer.alloc(16 * 4);
        for (let i = 0; i < 16; i++) plane.writeFloatBE(1, i * 4);
        const r = await convert('hdr.psd', fx.makePsd({ width: 4, height: 4, depth: 32, planes: [plane, plane, plane] }));
        expect(r.codes).toEqual(['hdr_32bit']);
        expect(await fx.pixel(r.pictures[0].bytes)).toEqual([255, 255, 255]);
    });

    test('CMYK: with its profile it is converted to sRGB faithfully; without one it is approximate', async () => {
        const cmykIcc = (await sharp(await fx.makeCmykJpeg()).metadata()).icc;
        // Photoshop stores CMYK inverted: 255 = no ink. No ink at all must come out white.
        const white = fx.solidPlanes(4, 4, [255, 255, 255, 255]);
        const withIcc = await convert('cmyk-icc.psd', fx.makePsd({ width: 4, height: 4, mode: 4, planes: white, icc: cmykIcc }));
        expect(withIcc.verdict).toBe('faithful');
        const [r, g, b] = await fx.pixel(withIcc.pictures[0].bytes);
        expect(Math.min(r, g, b)).toBeGreaterThan(240);
        const noIcc = await convert('cmyk.psd', fx.makePsd({ width: 4, height: 4, mode: 4, planes: white }));
        expect(noIcc.codes).toEqual(['cmyk_no_icc']);
    });

    test('a large composite is box-filtered to 2048 px', async () => {
        const r = await convert('wide.psd', fx.makePsd({ width: 4100, height: 10, mode: 1, planes: fx.solidPlanes(4100, 10, [40]), rle: true }));
        expect(r.verdict).toBe('faithful');
        expect(r.pictures[0].width).toBe(2048);
        expectScryPicture(r.pictures[0]);
    });

    test('Lab colour, ZIP compression, oversize and damaged files fail with a reason and fix', async () => {
        const lab = await convert('lab.psd', fx.makePsd({ width: 2, height: 2, mode: 9, planes: fx.solidPlanes(2, 2, [1, 2, 3]) }));
        expect(lab).toMatchObject({ verdict: 'failed', codes: ['unsupported_colour_mode'], pictures: [] });
        expect(lab.fix).toMatch(/RGB Color/);
        const zip = await convert('zip.psd', fx.makePsd({ width: 2, height: 2, planes: fx.solidPlanes(2, 2, [1, 2, 3]), compression: 2 }));
        expect(zip.codes).toEqual(['unsupported_compression']);
        const huge = await convert('huge.psb', fx.makePsd({ width: 20000, height: 1, psb: true, planes: [Buffer.alloc(0)], mode: 1, compression: 0 }));
        expect(huge.codes).toEqual(['too_large']);
        expect(huge.reasons[0]).toMatch(/16,384 px/);
        const broken = await convert('broken.psd', Buffer.from('8BPS garbage'));
        expect(broken.codes).toEqual(['unreadable']);
    });
});

describe('PDF / AI / INDD', () => {
    test('one picture per page, ids #p1..#pN, A4 at the 2048 px bound', async () => {
        const r = await convert('deck.pdf', fx.makePdf([{ w: 595, h: 842 }, { w: 300, h: 200 }, { w: 100, h: 100 }]));
        expect(r.verdict).toBe('faithful');
        expect(r.pictures.map((p) => p.suffix)).toEqual(['#p1', '#p2', '#p3']);
        r.pictures.forEach(expectScryPicture);
        expect(r.pictures[0].height).toBeGreaterThanOrEqual(2040);
        // 300 dpi cap: a 100 pt page is 417 px, not blown up to 2048.
        expect(r.pictures[2].width).toBeLessThanOrEqual(417);
        expect(await fx.pixel(r.pictures[1].bytes, 50, r.pictures[1].height - 50)).toEqual([255, 0, 0]);
    });

    test('a one-page PDF still gets #p1, so adding a page later keeps the id', async () => {
        const r = await convert('one.pdf', fx.makePdf([{ w: 200, h: 200 }]));
        expect(r.pictures.map((p) => p.suffix)).toEqual(['#p1']);
    });

    test('fonts not embedded: approximate with the fix', async () => {
        const r = await convert('text.pdf', fx.makePdf([{ w: 200, h: 200 }], { text: true }));
        expect(r.verdict).toBe('approximate');
        expect(r.codes).toEqual(['font_not_embedded']);
        expect(r.fix).toBe('Export the PDF again with fonts embedded.');
    });

    test('a page over 200 inches is drawn small and flagged', async () => {
        const r = await convert('banner.pdf', fx.makePdf([{ w: 14400, h: 720 }]));
        expect(r.codes).toEqual(['huge_page']);
        expect(r.pictures[0].width).toBe(2048);
    });

    test('AI with PDF compatibility is drawn; without it fails with the fix', async () => {
        const ok = await convert('logo.ai', fx.makeAiWithPdf());
        expect(ok).toMatchObject({ format: 'ai', verdict: 'faithful' });
        expect(ok.pictures[0].suffix).toBe('#p1');
        const no = await convert('old.ai', fx.makeAiWithoutPdf());
        expect(no).toMatchObject({ verdict: 'failed', codes: ['ai_no_pdf'] });
        expect(no.fix).toMatch(/Create PDF Compatible File/);
    });

    test('INDD: needs a PDF', async () => {
        const r = await convert('book.indd', fx.makeIndd());
        expect(r).toMatchObject({ verdict: 'failed', codes: ['indd_needs_pdf'], pictures: [] });
        expect(r.reasons[0]).toMatch(/needs a PDF/);
    });

    test('a damaged PDF fails as unreadable', async () => {
        const r = await convert('bad.pdf', Buffer.from('%PDF-1.4\nnot really\n'));
        expect(r).toMatchObject({ verdict: 'failed' });
    });
});

describe('PNG / JPEG / WebP / TIFF / HEIC', () => {
    test('an sRGB PNG within bounds passes through with metadata stripped', async () => {
        const r = await convert('plain.png', makePng(8, 8, { text: [['Comment', 'secret']] }));
        expect(r).toMatchObject({ format: 'png', verdict: 'faithful' });
        expect(r.pictures[0].bytes.includes(Buffer.from('secret'))).toBe(false);
    });

    test('a Display P3 PNG is converted to sRGB, not just stripped', async () => {
        // A mid-tone, non-primary colour: pure red clips to 255,0,0 in sRGB either way and would pass a stripped copy.
        const stored = [190, 120, 60];
        const p3 = await fx.makeP3Png(16, 16, stored);
        // Setup check: the file stores exactly these numbers (the profile was injected, pixels not transformed) and carries the P3 profile.
        expect([...(await sharp(p3, { ignoreIcc: true }).removeAlpha().raw().toBuffer()).subarray(0, 3)]).toEqual(stored);
        expect((await sharp(p3).metadata()).icc).toBeDefined();
        const expected = fx.p3ToSrgb(stored);
        // The conversion must move the numbers: a stripped copy (stored values read as sRGB) is clearly off.
        expect(Math.max(...expected.map((v, i) => Math.abs(v - stored[i])))).toBeGreaterThanOrEqual(8);
        const r = await convert('p3.png', p3);
        expect(r.verdict).toBe('faithful');
        const actual = await fx.pixel(r.pictures[0].bytes);
        for (let i = 0; i < 3; i += 1) expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(2);
        expect((await sharp(r.pictures[0].bytes).metadata()).icc).toBeUndefined();
    });

    test('a CMYK JPEG is converted to sRGB', async () => {
        const r = await convert('cmyk.jpg', await fx.makeCmykJpeg());
        expect(r.verdict).toBe('faithful');
        expect((await sharp(r.pictures[0].bytes).metadata()).space).toBe('srgb');
    });

    test('a big PNG is reduced to 2048 px; a TIFF is converted', async () => {
        const big = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#336699' } }).png().toBuffer();
        const r = await convert('big.png', big);
        expect(r.pictures[0].width).toBe(2048);
        expectScryPicture(r.pictures[0]);
        const tiff = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#00ff00' } }).tiff().toBuffer();
        const t = await convert('a.tif', tiff);
        expect(t).toMatchObject({ format: 'tiff', verdict: 'faithful' });
        const [red, green, blue] = await fx.pixel(t.pictures[0].bytes);
        expect(Math.max(red, 255 - green, blue)).toBeLessThanOrEqual(2);
    });

    test('sources over 16,384 px are refused', async () => {
        // A PNG header that claims 20000 x 1 px: refused from its header.
        const tall = await sharp({ create: { width: 16385, height: 1, channels: 3, background: '#000' } }).png().toBuffer();
        const r = await convert('tall.png', tall);
        expect(r).toMatchObject({ verdict: 'failed', codes: ['too_large'] });
    });

    test('HEIC: a plugged-in OS decoder is used; without any decoder it fails with the fix', async () => {
        const decoded = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff8800' } }).png().toBuffer();
        const seen = [];
        const r = await convert('photo.heic', Buffer.from('fake heic'), { decoders: { heic: async (file) => { seen.push(path.basename(file)); return decoded; } } });
        expect(seen).toEqual(['photo.heic']);
        expect(r).toMatchObject({ format: 'heic', verdict: 'faithful' });
        const none = await convert('photo2.heic', Buffer.from('fake heic'));
        expect(none).toMatchObject({ verdict: 'failed', codes: ['heic_no_decoder'] });
        expect(none.fix).toMatch(/HEIF Image Extensions/);
    });

    test('allow-listed XMP comes back with the result', async () => {
        const r = await convert('tagged.png', makePng(4, 4, { xmp: xmpPacket({ title: 'Home', keywords: ['nav'], rating: 4 }) }));
        expect(r.xmp).toMatchObject({ title: 'Home', keywords: ['nav'], rating: 4 });
    });
});
