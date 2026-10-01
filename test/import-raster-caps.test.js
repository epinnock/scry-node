/**
 * `scry import` raster caps (UAT row 3 fix): every converted picture is held to MAX_RASTER_DIMENSION px and
 * MAX_RASTER_BYTES, rendered at that bound directly, and checked to decode before it can be uploaded.
 *
 * Stage showed why: PDF and AI pages became 16384 x 16384 PNGs (pdftoppm -scale-to enlarges a small page to the
 * bound it is given), the SCF validator accepted them, and the image reader behind captioning refused them with
 * `image_parse_error`, which failed the whole chunk. The tests with real ImageMagick / pdftoppm skip with a
 * visible message when the tool is not installed; they never pass silently.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { convertFile, detectTools, measure, MAX_NATIVE_DIMENSION, MAX_RASTER_BYTES, MAX_RASTER_DIMENSION } = require('../lib/importConvert.js');
const { scanFolder } = require('../lib/importScan.js');
const { buildBundle } = require('../lib/importBundle.js');
const { makePng, makeJpeg, tempDir, write } = require('./helpers/importFixtures.js');

const writeOut = (args, bytes) => fs.writeFileSync(args.find((a) => /^(png|jpeg):/.test(a)).replace(/^(png|jpeg):/, ''), bytes);
const pdftoppmOut = (args, bytes) => fs.writeFileSync(`${args[args.length - 1]}.${args.includes('-png') ? 'png' : 'jpg'}`, bytes);

/** A one-page PDF whose page is `points` x `points` (blank white): enough for a real rasteriser. */
function minimalPdf(points) {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${points} ${points}] >>`,
    ];
    let body = '%PDF-1.4\n';
    const offsets = objects.map((o, i) => {
        const at = body.length;
        body += `${i + 1} 0 obj\n${o}\nendobj\n`;
        return at;
    });
    const xref = body.length;
    const entries = offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(body, 'latin1');
}

const tools = detectTools();
const realTest = (tool, name, fn) => {
    if (tools.includes(tool)) return test(name, fn, 60_000);
    console.warn(`SKIPPED (visible): ${tool} is not installed on this machine, so "${name}" did not run`);
    // eslint-disable-next-line sonarjs/assertions-in-tests -- deliberate visible skip when the real tool is absent
    return test.skip(`SKIPPED: ${tool} not installed: ${name}`, () => {});
};

describe('caps are explicit and below the SCF limits', () => {
    test('bound is the largest edge stage always indexed, and never above the SCF 16384 px / 20 MB', () => {
        expect(MAX_RASTER_DIMENSION).toBeLessThanOrEqual(2048);
        expect(MAX_RASTER_DIMENSION).toBeLessThan(16384);
        expect(MAX_RASTER_BYTES).toBeLessThan(20 * 1024 * 1024);
    });
});

describe('every attempt is asked for no more than the bound (fake tools)', () => {
    test('ImageMagick resize target is at most the bound on every attempt, for every converted format', async () => {
        for (const ext of ['.psd', '.tif', '.heic', '.pdf', '.ai']) {
            const resizes = [];
            const run = (file, args) => {
                resizes.push(args[args.indexOf('-resize') + 1]);
                return { status: 1 }; // fail every attempt so the whole ladder is exercised
            };
            await convertFile('/work/a' + ext, ext, { tools: ['magick'], run });
            expect(resizes.length).toBeGreaterThan(1);
            for (const r of resizes) {
                const edge = Number(r.split('x')[0]);
                expect(edge).toBeGreaterThan(0);
                expect(edge).toBeLessThanOrEqual(MAX_RASTER_DIMENSION);
                expect(r.endsWith('>')).toBe(true); // shrink only
            }
        }
    });
    test('pdftoppm is asked for -scale-to at most the bound on every attempt', async () => {
        const scales = [];
        const run = (file, args) => {
            scales.push(Number(args[args.indexOf('-scale-to') + 1]));
            return { status: 1 };
        };
        await convertFile('/work/a.pdf', '.pdf', { tools: ['pdftoppm'], run });
        expect(scales.length).toBeGreaterThan(1);
        expect(scales[0]).toBe(MAX_RASTER_DIMENSION);
        for (const s of scales) expect(s).toBeLessThanOrEqual(MAX_RASTER_DIMENSION);
    });
    test('PDF and AI try pdftoppm before ImageMagick, so the page is rendered at the bound and not rendered large then shrunk', async () => {
        const order = [];
        const run = (file) => { order.push(file); return { status: 1 }; };
        await convertFile('/work/a.ai', '.ai', { tools: ['magick', 'pdftoppm'], run });
        expect(order[0]).toBe('pdftoppm');
        expect(order).toContain('magick');
    });
});

describe('an output that breaks the bound or does not decode is never returned (fake tools)', () => {
    test('a tool that ignores the bound (16384 x 16384) is rejected; a valid smaller attempt wins', async () => {
        let n = 0;
        const run = (file, args) => {
            n += 1;
            writeOut(args, n === 1 ? makePng(MAX_RASTER_DIMENSION + 1, 4) : makeJpeg(10, 8, { exif: false }));
            return { status: 0 };
        };
        const res = await convertFile('/work/a.tif', '.tif', { tools: ['magick'], run });
        expect(res).toMatchObject({ ok: true, family: 'jpeg', width: 10, height: 8 });
        expect(n).toBe(2);
    });
    test('over the byte cap is rejected and the skip reason names the cap', async () => {
        const fat = Buffer.concat([makeJpeg(10, 8, { exif: false }).subarray(0, -2), Buffer.alloc(MAX_RASTER_BYTES + 1024, 7), Buffer.from([0xff, 0xd9])]);
        const run = (file, args) => { writeOut(args, fat); return { status: 0 }; };
        const res = await convertFile('/work/a.tif', '.tif', { tools: ['magick'], run });
        expect(res).toMatchObject({ ok: false, reason: 'error' });
        expect(res.detail).toMatch(new RegExp(`${MAX_RASTER_DIMENSION} px and ${MAX_RASTER_BYTES / 1048576} MB`));
        expect(res.detail).toMatch(/over \d+ MB/);
    });
    test('a truncated PNG (no IEND) is rejected with a named reason', async () => {
        const png = makePng(10, 8);
        const run = (file, args) => { writeOut(args, png.subarray(0, png.length - 12)); return { status: 0 }; };
        const res = await convertFile('/work/a.tif', '.tif', { tools: ['magick'], run });
        expect(res).toMatchObject({ ok: false, reason: 'error' });
        expect(res.detail).toMatch(/PNG is truncated|not a readable PNG or JPEG/);
    });
    test('a PNG whose pixel data is corrupt or short is rejected', async () => {
        const good = makePng(10, 8);
        const idat = good.indexOf(Buffer.from('IDAT'));
        const corrupt = Buffer.from(good);
        corrupt.fill(0xff, idat + 6, idat + 12); // damage the deflate stream
        const run = (file, args) => { writeOut(args, corrupt); return { status: 0 }; };
        const res = await convertFile('/work/a.tif', '.tif', { tools: ['magick'], run });
        expect(res.ok).toBe(false);
        expect(res.detail).toMatch(/PNG pixel data is (corrupt|incomplete)/);
    });
    test('a truncated JPEG (no EOI) is rejected', async () => {
        const jpg = makeJpeg(10, 8, { exif: false });
        const run = (file, args) => { writeOut(args, jpg.subarray(0, jpg.length - 2)); return { status: 0 }; };
        const res = await convertFile('/work/a.tif', '.tif', { tools: ['magick'], run });
        expect(res.ok).toBe(false);
        expect(res.detail).toMatch(/JPEG is truncated|not a readable/);
    });
    test('pdftoppm output over the bound (the stage failure: a 624 pt page enlarged to 16384 px) is never returned', async () => {
        const run = (file, args) => { pdftoppmOut(args, makePng(16384, 4)); return { status: 0 }; };
        const res = await convertFile('/work/a.pdf', '.pdf', { tools: ['pdftoppm'], run });
        expect(res).toMatchObject({ ok: false, reason: 'error' });
        expect(res.detail).toMatch(/16384x4, over \d+ px/);
    });
});

describe('real converters hold the bound', () => {
    realTest('pdftoppm', 'a 624 pt PDF page and an .ai copy come out at exactly the bound, valid, metadata-free', async () => {
        const dir = tempDir('caps');
        for (const name of ['page.pdf', 'logo.ai']) {
            const res = await convertFile(write(dir, name, minimalPdf(624)), path.extname(name), { tools: ['pdftoppm'] });
            expect(res.ok).toBe(true);
            expect(Math.max(res.width, res.height)).toBe(MAX_RASTER_DIMENSION);
            expect(res.bytes.length).toBeLessThanOrEqual(MAX_RASTER_BYTES);
            expect(measure(res.bytes)).toMatchObject({ width: res.width, height: res.height });
        }
    });
    realTest('pdftoppm', 'a very large page (200 in) is still rendered at the bound, not at 150 dpi', async () => {
        const res = await convertFile(write(tempDir('caps'), 'poster.pdf', minimalPdf(14400)), '.pdf', { tools: ['pdftoppm'] });
        expect(res.ok).toBe(true);
        expect(Math.max(res.width, res.height)).toBeLessThanOrEqual(MAX_RASTER_DIMENSION);
    });
    realTest('magick', 'a large TIFF and a large PSD are shrunk to the bound and still decode', async () => {
        const magick = tools.includes('magick') ? 'magick' : 'convert';
        const dir = tempDir('caps');
        for (const [name, coder] of [['big.tif', 'tiff'], ['big.psd', 'psd']]) {
            const file = path.join(dir, name);
            const made = spawnSync(magick, ['-size', '5000x3000', 'gradient:red-blue', `${coder}:${file}`], { stdio: 'ignore' });
            expect(made.status).toBe(0);
            const res = await convertFile(file, path.extname(name), { tools: [magick] });
            expect(res.ok).toBe(true);
            expect(Math.max(res.width, res.height)).toBeLessThanOrEqual(MAX_RASTER_DIMENSION);
            expect(res.width / res.height).toBeCloseTo(5000 / 3000, 1);
            const out = path.join(dir, `out-${name}.${res.family === 'png' ? 'png' : 'jpg'}`);
            fs.writeFileSync(out, res.bytes);
            const check = spawnSync(magick, ['identify', out], { stdio: 'ignore' });
            expect(check.status).toBe(0); // an independent decoder reads it
        }
    });
    realTest('magick', 'an oversize native-format raster (6000 px PNG) is re-encoded within the bound', async () => {
        const magick = tools.includes('magick') ? 'magick' : 'convert';
        const file = path.join(tempDir('caps'), 'wide.png');
        expect(spawnSync(magick, ['-size', '6000x100', 'gradient:white-black', `png:${file}`], { stdio: 'ignore' }).status).toBe(0);
        const res = await convertFile(file, '.png', { tools: [magick] });
        expect(res.ok).toBe(true);
        expect(res.width).toBeLessThanOrEqual(MAX_RASTER_DIMENSION);
    });
});

describe('a picture that is already PNG/JPEG is not sent when it is over the bound (bundle level)', () => {
    const fat = () => Buffer.concat([makeJpeg(10, 8, { exif: false }).subarray(0, -2), Buffer.alloc(MAX_RASTER_BYTES + 1024, 7), Buffer.from([0xff, 0xd9])]);
    const build = async (name, bytes, convert) => {
        const root = tempDir('bundle');
        write(root, name, bytes);
        const scan = await scanFolder(root);
        const out = tempDir('out');
        const result = await buildBundle(scan, out, { convert, tools: ['magick'] });
        return { ...result, out };
    };
    test('over the byte cap goes through the converter and the reduced picture is what is written', async () => {
        const convert = jest.fn(async () => ({ ok: true, bytes: makeJpeg(10, 8, { exif: false }), family: 'jpeg', width: 10, height: 8 }));
        const { manifest } = await build('big.jpg', fat(), convert);
        expect(convert).toHaveBeenCalledTimes(1);
        expect(manifest.captures).toHaveLength(1);
    });
    test('over the native edge (a 16384 px PNG) goes through the converter too', async () => {
        const convert = jest.fn(async () => ({ ok: true, bytes: makePng(10, 8), family: 'png', width: 10, height: 8 }));
        await build('wide.png', makePng(MAX_NATIVE_DIMENSION + 1, 4), convert);
        expect(convert).toHaveBeenCalledTimes(1);
    });
    test('a normal picture within both bounds is used as it is (converter not called)', async () => {
        const convert = jest.fn();
        const { manifest } = await build('ok.jpg', makeJpeg(100, 80, { exif: false }), convert);
        expect(convert).not.toHaveBeenCalled();
        expect(manifest.captures).toHaveLength(1);
    });
    test('over the bound and not reducible: skipped with a named reason, nothing uploaded, counts honest', async () => {
        const convert = jest.fn(async () => ({ ok: false, reason: 'unsupported', detail: 'no converter for .jpg on this machine' }));
        const { manifest, stats } = await build('big.jpg', fat(), convert);
        expect(manifest.captures).toHaveLength(0);
        expect(JSON.stringify(stats)).toMatch(/AI services accept/);
    });
});
