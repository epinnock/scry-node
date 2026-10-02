/**
 * Hardening of the Scry Sync converter after the independent review of PR 87 (ledger F56-F64):
 * unreadable folders, hidden entries, odd file names, read-time confinement, broad folders, the capture cap,
 * page-by-page PDF memory.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { scanFolder, convertFile, buildBundle, pictureId, isTooBroad, ScanError, TooManyCapturesError, TOO_MANY_MESSAGE, LIMITS } = require('../lib/converter');
const { tempDir, write, makePng } = require('./helpers/importFixtures.js');
const fx = require('./helpers/syncFixtures.js');

const FOLDER = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const APP = '0.1.0-beta.1';

let work;
beforeAll(() => {
    work = tempDir('sync-hardening');
});
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));
afterEach(() => jest.restoreAllMocks());

describe('an unreadable folder is a failed verdict, never a raw system error (F57)', () => {
    test('a subfolder that cannot be opened becomes a refused row in plain words, with no absolute path', () => {
        const root = path.join(work, 'eacces');
        write(root, 'ok/Home.png', makePng(8, 8));
        write(root, 'Locked/Secret.png', makePng(8, 8, { shade: 9 }));
        const locked = path.join(fs.realpathSync(root), 'Locked');
        const real = fs.readdirSync;
        jest.spyOn(fs, 'readdirSync').mockImplementation((dir, ...rest) => {
            if (dir === locked) throw Object.assign(new Error(`EACCES: permission denied, scandir '${locked}'`), { code: 'EACCES' });
            return real(dir, ...rest);
        });
        const scan = scanFolder(root);
        expect(scan.files.map((f) => f.rel)).toEqual(['ok/Home.png']);
        expect(scan.refused).toHaveLength(1);
        expect(scan.refused[0]).toMatchObject({ rel: 'Locked', verdict: 'failed', codes: ['folder_unreadable'] });
        expect(typeof scan.refused[0].fix).toBe('string');
        expect(JSON.stringify(scan)).not.toMatch(/EACCES|scandir/);
        expect(JSON.stringify(scan.refused)).not.toContain(root);
    });

    test('the top folder itself unreadable is a plain ScanError without the path', () => {
        const root = path.join(work, 'eacces-top');
        write(root, 'a.png', makePng(8, 8));
        const real = fs.readdirSync;
        const top = fs.realpathSync(root);
        jest.spyOn(fs, 'readdirSync').mockImplementation((dir, ...rest) => {
            if (dir === top) throw Object.assign(new Error(`EACCES: permission denied, scandir '${top}'`), { code: 'EACCES' });
            return real(dir, ...rest);
        });
        let error;
        try {
            scanFolder(root);
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(ScanError);
        expect(error.message).not.toContain(top);
        expect(error.message).not.toMatch(/EACCES/);
    });
});

describe('hidden entries and __MACOSX are counted and listed, never skipped silently (F58)', () => {
    test('ignored counts hidden + __MACOSX + other; hiddenDesigns lists hidden design files', () => {
        const root = path.join(work, 'hidden');
        write(root, 'Home.png', makePng(8, 8));
        write(root, '.x.psd', fx.makePsd({ width: 2, height: 2, planes: fx.solidPlanes(2, 2, [1, 2, 3]) }));
        write(root, '._Home.png', Buffer.from('apple double'));
        write(root, '.DS_Store', Buffer.from('x'));
        write(root, '.git/config', 'x');
        write(root, '__MACOSX/Home.png', makePng(8, 8));
        write(root, 'notes.txt', 'text');
        write(root, 'Sub/.hidden/inner.png', makePng(8, 8));
        const scan = scanFolder(root);
        expect(scan.files.map((f) => f.rel)).toEqual(['Home.png']);
        // hidden: .x.psd, ._Home.png, .DS_Store, .git (once), Sub/.hidden (once) = 5; macosx: 1; other: notes.txt
        expect(scan.ignoredBy).toEqual({ hidden: 5, macosx: 1, other: 1 });
        expect(scan.ignored).toBe(7);
        expect(scan.hiddenDesigns).toEqual(['.x.psd']);
    });
});

describe('a file name with a backslash or another odd character never aborts the bundle (F59)', () => {
    test('buildBundle gives a failed verdict for the odd name and keeps going; a\\b.png and a/b.png do not collide', async () => {
        const root = path.join(work, 'odd');
        write(root, 'a/b.png', makePng(8, 8, { shade: 20 }));
        write(root, 'a\\b.png', makePng(8, 8, { shade: 30 }));
        write(root, 'C:\\Users\\Ann Smith\\logo.png', makePng(8, 8, { shade: 40 }));
        write(root, 'tab\tname.png', makePng(8, 8, { shade: 50 }));
        write(root, 'Fine.png', makePng(8, 8, { shade: 60 }));
        const scan = scanFolder(root);
        expect(scan.files.map((f) => f.rel).sort()).toEqual(['Fine.png', 'a/b.png', 'tab\tname.png']);
        expect(scan.refused.map((r) => [r.rel, r.codes[0]]).sort()).toEqual([['C:\\Users\\Ann Smith\\logo.png', 'odd_name'], ['a\\b.png', 'odd_name']]);
        const out = path.join(work, 'odd-out');
        const { manifest, results } = await buildBundle({ folderUuid: FOLDER, scan, outDir: out, appVersion: APP, convertOptions: { tools: [] } });
        expect(manifest.captures.map((c) => c.title.at(-1)).sort()).toEqual(['Fine', 'b']);
        expect(results.find((r) => r.rel === 'tab\tname.png')).toMatchObject({ verdict: 'failed', codes: ['odd_name'] });
        expect(JSON.stringify(manifest)).not.toContain('Ann Smith');
        expect(manifest.counts.skipped).toHaveLength(3);
    });

    test('a hand-made scan with names that cannot be ids (drive segment, backslash) still gives verdicts, not a throw', async () => {
        const root = path.join(work, 'odd2');
        const abs = write(root, 'x.png', makePng(8, 8));
        const scan = { root, refused: [], files: [{ abs, rel: 'C:/x.png' }, { abs, rel: 'a\\b.png' }, { abs, rel: '' }, { abs, rel: 'x.png' }] };
        const { results } = await buildBundle({ folderUuid: FOLDER, scan, outDir: path.join(work, 'odd2-out'), appVersion: APP, convertOptions: { tools: [] } });
        expect(results.map((r) => [r.verdict, r.codes[0] || null])).toEqual([['failed', 'odd_name'], ['failed', 'odd_name'], ['failed', 'odd_name'], ['faithful', null]]);
    });
});

describe('convertFile re-checks the file at read time (F60)', () => {
    test('a scanned file swapped for a link to a file outside the folder is refused', async () => {
        const root = path.join(work, 'toctou');
        write(root, 'ok.png', makePng(8, 8));
        const outside = write(path.join(work, 'toctou-outside'), 'secret.png', makePng(9, 9, { shade: 7 }));
        const scan = scanFolder(root);
        const file = scan.files[0];
        expect((await convertFile(file.abs, { root: scan.root, tools: [] })).verdict).toBe('faithful');
        fs.rmSync(file.abs);
        fs.symlinkSync(outside, file.abs);
        const swapped = await convertFile(file.abs, { root: scan.root, tools: [] });
        expect(swapped).toMatchObject({ verdict: 'failed', codes: ['not_followed'], pictures: [] });
    });

    test('convertFile needs the folder root: without it there is no read-time confinement, so it refuses to run (F77)', async () => {
        const root = path.join(work, 'toctou-noroot');
        write(root, 'Swap/ok.png', makePng(8, 8));
        write(path.join(work, 'toctou-noroot-out'), 'ok.png', makePng(9, 9, { shade: 7 }));
        const scan = scanFolder(root);
        fs.rmSync(path.join(root, 'Swap'), { recursive: true });
        fs.symlinkSync(path.join(work, 'toctou-noroot-out'), path.join(root, 'Swap'));
        // The review's probe: the swapped subfolder now points outside, and no root is passed.
        await expect(convertFile(scan.files[0].abs, {})).rejects.toThrow(/root/);
        await expect(convertFile(scan.files[0].abs)).rejects.toThrow(/root/);
        await expect(convertFile(scan.files[0].abs, { root: '' })).rejects.toThrow(/root/);
        // The message names the option, never the file.
        await expect(convertFile(scan.files[0].abs, {})).rejects.toThrow(expect.objectContaining({ message: expect.not.stringContaining(work) }));
        // With the root it is refused as outside the folder.
        expect(await convertFile(scan.files[0].abs, { root: scan.root, tools: [] })).toMatchObject({ verdict: 'failed', codes: ['outside_folder'], pictures: [] });
    });

    test('a scanned subfolder swapped for a link to a folder outside the root is refused', async () => {
        const root = path.join(work, 'toctou-dir');
        write(root, 'Sub/ok.png', makePng(8, 8));
        write(path.join(work, 'toctou-dir-out'), 'ok.png', makePng(9, 9, { shade: 7 }));
        const scan = scanFolder(root);
        fs.rmSync(path.join(root, 'Sub'), { recursive: true });
        fs.symlinkSync(path.join(work, 'toctou-dir-out'), path.join(root, 'Sub'));
        const result = await convertFile(scan.files[0].abs, { root: scan.root, tools: [] });
        expect(result).toMatchObject({ verdict: 'failed', codes: ['outside_folder'], pictures: [] });
    });

    test('a file edited while it is being read is not trusted', async () => {
        const root = path.join(work, 'toctou-edit');
        const abs = write(root, 'Phone.heic', Buffer.from('heic bytes'));
        const png = makePng(8, 8);
        const decoders = {
            heic: async () => {
                fs.appendFileSync(abs, 'edited meanwhile');
                return png;
            },
        };
        const result = await convertFile(abs, { root: fs.realpathSync(root), decoders });
        expect(result).toMatchObject({ verdict: 'failed', codes: ['changed_while_reading'], pictures: [] });
    });
});

describe('broad folders are refused as the folder to scan (F61)', () => {
    test.each([
        ['/', null], ['/home', null], ['/Users', null], ['/usr', null], ['/etc', null], ['/Volumes', null],
        ['C:\\', null], ['C:\\Users', null], ['c:\\users\\', null], ['C:\\Windows', null], ['C:\\Program Files', null], ['C:\\ProgramData', null],
        ['/home/ann', null], ['/Users/Ann Smith', null], ['C:\\Users\\Ann Smith', null],
        ['/home', '/home/ann'], ['/', '/home/ann'], ['/home/ann', '/home/ann'],
    ])('%s is too broad (home %s)', (folder, home) => {
        expect(isTooBroad(folder, home)).toBe(true);
    });

    test.each(['/home/ann/Designs', '/Users/ann/Documents/Brand Kit', 'C:\\Users\\Ann Smith\\Brand Kit', '/srv/designs/acme', '/data/scry/designs', 'D:\\Design Files'])('%s is fine', (folder) => {
        expect(isTooBroad(folder, '/home/ann')).toBe(false);
    });

    test('scanFolder refuses /home and /usr with the plain message', () => {
        for (const folder of ['/home', '/usr']) {
            if (!fs.existsSync(folder)) continue;
            expect(() => scanFolder(folder)).toThrow(/too broad/);
        }
    });
});

describe('the capture count is capped at the SCF limit (F63)', () => {
    const png = makePng(2, 2);
    const fakeConvert = async () => ({ format: 'png', pictures: [{ suffix: '', bytes: png, family: 'png', width: 2, height: 2 }], verdict: 'faithful', codes: [], reasons: [], fix: null });
    const scanOf = (n) => ({ root: work, refused: [], files: Array.from({ length: n }, (_, i) => ({ abs: path.join(work, `f${i}.png`), rel: `d${i % 50}/f${i}.png` })) });

    test(`${LIMITS.MAX_BUNDLE_CAPTURES} captures are accepted and one more is refused with a clear message`, async () => {
        expect(LIMITS.MAX_BUNDLE_CAPTURES).toBe(10_000);
        const ok = path.join(work, 'cap-ok');
        const built = await buildBundle({ folderUuid: FOLDER, scan: scanOf(10_000), outDir: ok, appVersion: APP, convert: fakeConvert });
        expect(built.manifest.captures).toHaveLength(10_000);

        const over = path.join(work, 'cap-over');
        const run = buildBundle({ folderUuid: FOLDER, scan: scanOf(10_001), outDir: over, appVersion: APP, convert: fakeConvert });
        await expect(run).rejects.toThrow(TooManyCapturesError);
        await expect(run).rejects.toThrow(TOO_MANY_MESSAGE);
        expect(TOO_MANY_MESSAGE).toMatch(/more than 10,000 pictures/);
        expect(fs.existsSync(path.join(over, 'scf.json'))).toBe(false);
        expect(fs.existsSync(path.join(over, 'images'))).toBe(false);
    }, 120_000);

    test('PDF pages count: 100-page files add up to the cap, not past it', async () => {
        const pages = async () => ({ format: 'pdf', pictures: Array.from({ length: 100 }, (_, i) => ({ suffix: `#p${i + 1}`, bytes: png, family: 'png', width: 2, height: 2 })), verdict: 'faithful', codes: [], reasons: [], fix: null });
        const out = path.join(work, 'cap-pdf');
        await expect(buildBundle({ folderUuid: FOLDER, scan: scanOf(101), outDir: out, appVersion: APP, convert: pages })).rejects.toThrow(TooManyCapturesError);
        expect(pictureId(FOLDER, 'a.pdf', 100)).toMatch(/#p100$/);
    }, 120_000);
});

describe('a PDF is converted page by page (F62)', () => {
    test('a 100-page PDF converts with a peak RSS far under 400 MB (the old code peaked near 1.2 GB)', () => {
        const dir = path.join(work, 'pdfmem');
        fs.mkdirSync(dir, { recursive: true });
        const run = spawnSync(process.execPath, [path.join(__dirname, 'helpers', 'pdfPeakRss.js'), '100', dir], { encoding: 'utf8', timeout: 110_000 });
        expect(run.status).toBe(0);
        const out = JSON.parse(run.stdout);
        console.log(`100-page PDF peak RSS: ${out.peakRssMb} MB`);
        expect(out).toMatchObject({ verdict: 'faithful', pictures: 100 });
        expect(out.peakRssMb).toBeLessThan(400);
    }, 120_000);
});
