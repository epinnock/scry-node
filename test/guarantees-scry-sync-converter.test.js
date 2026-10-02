/**
 * Scry Sync guarantees owned by the converter:
 *   G2 no originals, no paths: a built bundle holds only converted pictures and no full path or user name;
 *   G3 every file in the folder ends with a verdict (faithful / approximate / failed with a reason and fix).
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { scanFolder, convertFile, buildBundle, pictureId, BundleTooBigError, TOO_BIG_MESSAGE } = require('../lib/converter');
const { validateBundle } = require('../lib/scf.js');
const { tempDir, write, makePng, makeRealJpeg, xmpPacket, readTree } = require('./helpers/importFixtures.js');
const fx = require('./helpers/syncFixtures.js');

const FOLDER = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const APP = '0.1.0-beta.1';

let work;
beforeAll(() => {
    work = tempDir('sync-guarantees');
});
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

/** A folder with one file of every kind the app meets, good and bad. */
async function mixedFolder(root) {
    write(root, 'Screens/Home.png', makePng(8, 8));
    write(root, 'Screens/Photo.jpg', makeRealJpeg());
    write(root, 'Screens/P3.png', await fx.makeP3Png());
    write(root, 'Design/Card.psd', fx.makePsd({ width: 4, height: 4, planes: fx.solidPlanes(4, 4, [1, 2, 3]) }));
    write(root, 'Design/Old.psd', fx.makePsd({ width: 4, height: 4, planes: fx.solidPlanes(4, 4, [1, 2, 3]), merged: false }));
    write(root, 'Design/Poster.psb', fx.makePsd({ width: 4, height: 4, psb: true, rle: true, planes: fx.solidPlanes(4, 4, [9, 9, 9]) }));
    write(root, 'Design/Lab.psd', fx.makePsd({ width: 2, height: 2, mode: 9, planes: fx.solidPlanes(2, 2, [1, 2, 3]) }));
    write(root, 'Docs/Deck.pdf', fx.makePdf([{ w: 200, h: 100 }, { w: 100, h: 200 }]));
    write(root, 'Docs/Text.pdf', fx.makePdf([{ w: 200, h: 100 }], { text: true }));
    write(root, 'Docs/Logo.ai', fx.makeAiWithPdf());
    write(root, 'Docs/Legacy.ai', fx.makeAiWithoutPdf());
    write(root, 'Docs/Book.indd', fx.makeIndd());
    write(root, 'Phone/IMG_1.heic', Buffer.from('not decodable here'));
    write(root, 'Broken.png', Buffer.from('\x89PNG broken'));
    write(root, 'Empty.jpg', Buffer.alloc(0));
    write(root, 'Scan.tif', await sharp({ create: { width: 4, height: 4, channels: 3, background: '#123456' } }).tiff().toBuffer());
    write(root, 'notes.txt', 'not a picture');
    fs.symlinkSync(path.join(root, 'Screens', 'Home.png'), path.join(root, 'Link.png'));
}

describe('guarantee-3-every-file-has-a-verdict', () => {
    test('guarantee-3-every-file-has-a-verdict: every picture/design file ends faithful, approximate or failed with a reason and fix', async () => {
        const root = path.join(work, 'g3');
        await mixedFolder(root);
        const scan = scanFolder(root);
        const verdicts = new Map();
        for (const file of scan.files) verdicts.set(file.rel, await convertFile(file.abs, { root: scan.root, tools: [] }));
        for (const refused of scan.refused) verdicts.set(refused.rel, refused);

        // Every file of a known kind is accounted for; only notes.txt is ignored.
        expect(scan.ignored).toBe(1);
        expect([...verdicts.keys()].sort()).toEqual([
            'Broken.png', 'Design/Card.psd', 'Design/Lab.psd', 'Design/Old.psd', 'Design/Poster.psb',
            'Docs/Book.indd', 'Docs/Deck.pdf', 'Docs/Legacy.ai', 'Docs/Logo.ai', 'Docs/Text.pdf',
            'Empty.jpg', 'Link.png', 'Phone/IMG_1.heic', 'Scan.tif', 'Screens/Home.png', 'Screens/P3.png', 'Screens/Photo.jpg',
        ]);
        for (const [rel, v] of verdicts) {
            expect({ rel, verdict: v.verdict }).toEqual({ rel, verdict: expect.stringMatching(/^(faithful|approximate|failed)$/) });
            if (v.verdict === 'faithful') expect(v.reasons).toEqual([]);
            if (v.verdict === 'approximate') expect(v.reasons.length).toBeGreaterThan(0);
            if (v.verdict === 'failed') {
                expect(v.reasons.length).toBeGreaterThan(0);
                expect(typeof v.fix).toBe('string');
                expect(v.pictures || []).toEqual([]);
            } else {
                expect(v.pictures.length).toBeGreaterThan(0);
            }
        }
        const summary = Object.fromEntries([...verdicts].map(([rel, v]) => [rel, `${v.verdict}:${v.codes.join(',')}`]));
        expect(summary).toEqual({
            'Broken.png': 'failed:unreadable',
            'Design/Card.psd': 'faithful:',
            'Design/Lab.psd': 'failed:unsupported_colour_mode',
            'Design/Old.psd': 'approximate:psd_no_full_preview',
            'Design/Poster.psb': 'faithful:',
            'Docs/Book.indd': 'failed:indd_needs_pdf',
            'Docs/Deck.pdf': 'faithful:',
            'Docs/Legacy.ai': 'failed:ai_no_pdf',
            'Docs/Logo.ai': 'faithful:',
            'Docs/Text.pdf': 'approximate:font_not_embedded',
            'Empty.jpg': 'failed:empty',
            'Link.png': 'failed:not_followed',
            'Phone/IMG_1.heic': 'failed:heic_no_decoder',
            'Scan.tif': 'faithful:',
            'Screens/Home.png': 'faithful:',
            'Screens/P3.png': 'faithful:',
            'Screens/Photo.jpg': 'faithful:',
        });
    }, 60_000);

    test('guarantee-3-every-file-has-a-verdict: the bundle counts every failed file with its reason', async () => {
        const root = path.join(work, 'g3b');
        await mixedFolder(root);
        const scan = scanFolder(root);
        const out = path.join(work, 'g3b-out');
        const { manifest, results } = await buildBundle({ folderUuid: FOLDER, scan, outDir: out, appVersion: APP, convertOptions: { tools: [] } });
        expect(results).toHaveLength(17);
        const failedCount = results.filter((r) => r.verdict === 'failed').length;
        expect(manifest.counts.skipped).toHaveLength(failedCount);
        expect(manifest.counts.declared).toBe(17);
        expect(manifest.counts.captured).toBe(manifest.captures.length);
        // 10 files converted; the PDF/AI files give 2 + 1 + 1 pages.
        expect(manifest.captures).toHaveLength(11);
        expect(validateBundle(out).errors).toEqual([]);
    }, 60_000);
});

describe('guarantee-2-no-originals-no-paths', () => {
    const userName = 'annsmith';
    const winPath = `C:\\Users\\${userName}\\Projects\\Acme\\Design\\Card.psd`;
    const macPath = `/Users/${userName}/Projects/Acme/Design/Card.psd`;

    test('guarantee-2-no-originals-no-paths: no full path or user name anywhere in a built bundle (Windows and Mac inputs)', async () => {
        // The synced folder itself lives under a folder named after the user.
        const root = path.join(work, userName, 'Acme Designs');
        const xmp = xmpPacket({
            title: `Home from ${winPath}`,
            description: `Exported to ${macPath} by ${userName}`,
            keywords: ['nav', macPath, `\\\\server\\share\\${userName}\\x.png`],
            rating: 5,
            label: 'Green',
        });
        write(root, 'Screens/Home.png', makePng(8, 8, { xmp, text: [['Comment', winPath]] }));
        write(root, 'Screens/Photo.jpg', makeRealJpeg());
        write(root, 'Screens/Home.xmp', xmp);
        write(root, 'Design/Card.psd', fx.makePsd({ width: 4, height: 4, planes: fx.solidPlanes(4, 4, [1, 2, 3]) }));
        write(root, 'Docs/Deck.pdf', fx.makePdf([{ w: 200, h: 100 }, { w: 100, h: 200 }]));
        write(root, 'Docs/Legacy.ai', fx.makeAiWithoutPdf());
        const scan = scanFolder(root);
        const out = path.join(work, 'g2-out');
        const { manifest } = await buildBundle({
            folderUuid: FOLDER,
            scan,
            outDir: out,
            appVersion: APP,
            folderLabel: `Acme Designs (${macPath})`,
            convertOptions: { tools: [] },
        });

        expect(validateBundle(out).errors).toEqual([]);
        const tree = readTree(out);
        const everything = Object.values(tree).map((b) => b.toString('latin1')).join('\n');
        for (const needle of [userName, 'C:\\', 'C:/', '/Users/', '\\\\server', root, work, 'Projects/Acme', 'Projects\\Acme']) {
            expect({ needle, found: everything.includes(needle) }).toEqual({ needle, found: false });
        }
        // Only converted pictures: no original file's bytes are in the bundle.
        for (const original of ['Design/Card.psd', 'Docs/Deck.pdf']) {
            const bytes = fs.readFileSync(path.join(root, original));
            for (const file of Object.values(tree)) expect(file.equals(bytes)).toBe(false);
        }
        expect(Object.keys(tree).every((p) => p === 'scf.json' || /^images\/[0-9a-f]{64}\.(png|jpg)$/.test(p))).toBe(true);

        // Ids, titles, origin.
        const home = manifest.captures.find((c) => c.id === pictureId(FOLDER, 'Screens/Home.png'));
        expect(home.title).toEqual(['Acme Designs', 'Home']);
        expect(home['x-scry-sync'].origin).toEqual({ convertedFrom: 'png', verdict: 'faithful', appVersion: APP });
        expect(home['x-scry-sync'].keywords).toEqual(['nav']);
        expect(home['x-scry-sync'].rating).toBe(5);
        expect(home['x-scry-sync'].label).toBe('Green');
        expect(Object.keys(home['x-scry-sync'].origin)).toEqual(['convertedFrom', 'verdict', 'appVersion']);
        const pages = manifest.captures.filter((c) => c.id.startsWith(pictureId(FOLDER, 'Docs/Deck.pdf')));
        expect(pages.map((c) => [c.id.slice(64), c.name])).toEqual([['#p1', 'Page 1'], ['#p2', 'Page 2']]);
        expect(manifest.source).toEqual({ kind: 'x-scry-sync', platform: 'other', tool: { name: 'scry-sync', version: APP } });
    }, 60_000);

    test('a Windows-style and a Mac-style relative path of the same file give the same capture id', () => {
        expect(pictureId(FOLDER, 'Design\\Card.psd')).toBe(pictureId(FOLDER, 'Design/Card.psd'));
    });
});

describe('bundle size', () => {
    test(`a bundle over the limit is refused with "${TOO_BIG_MESSAGE}"`, async () => {
        const root = path.join(work, 'big');
        write(root, 'a.png', makePng(64, 64, { shade: 10 }));
        write(root, 'b.png', makePng(64, 64, { shade: 20 }));
        const scan = scanFolder(root);
        const out = path.join(work, 'big-out');
        const run = buildBundle({ folderUuid: FOLDER, scan, outDir: out, appVersion: APP, maxBundleBytes: 120 });
        await expect(run).rejects.toThrow(BundleTooBigError);
        await expect(buildBundle({ folderUuid: FOLDER, scan, outDir: out, appVersion: APP, maxBundleBytes: 120 })).rejects.toThrow('This folder is too big; link a smaller folder');
        expect(fs.existsSync(path.join(out, 'scf.json'))).toBe(false);
    });
});
