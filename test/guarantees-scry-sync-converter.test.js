/**
 * Scry Sync guarantees owned by the converter:
 *   G2 no originals, no paths: a built bundle holds only converted pictures and no full path or user name;
 *   G3 every file in the folder ends with a verdict (faithful / approximate / failed with a reason and fix).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { scanFolder, convertFile, buildBundle, pictureId, BundleTooBigError, TOO_BIG_MESSAGE } = require('../lib/converter');
const { validateBundle, zipBundleDir } = require('../lib/scf.js');
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
    /** The place a user's name and a path can hide: every XMP field, as Windows, Mac and UNC paths. */
    function leakyXmp(user) {
        const win = `C:\\Users\\${user}\\Documents\\Work\\logo.psd`;
        const mac = `/Users/${user}/Desktop/Brand Kit/x.psd`;
        const unc = `\\\\fileserver\\Design Share\\${user}\\a.psd`;
        return xmpPacket({
            title: `Home from ${win}`,
            description: `Exported to ${mac} by ${user} (see ${unc})`,
            keywords: ['nav', mac, unc, '~/Desktop/key.psd', `file:///Users/${user}/k.psd`, `by ${user}`, win.toLowerCase(), 'dark mode'],
            rating: 4,
            label: `/Users/${user}`,
        });
    }

    /** Every byte of the built bundle, plus its zip: manifest, images, entry names. */
    async function everyByte(out) {
        const zipPath = `${out}.zip`;
        const { members } = await zipBundleDir(out, zipPath);
        const tree = readTree(out);
        const files = { ...tree, '<zip>': fs.readFileSync(zipPath) };
        return { files, members, manifestText: tree['scf.json'].toString('utf8'), manifest: JSON.parse(tree['scf.json'].toString('utf8')) };
    }

    function stringValues(node, out = []) {
        if (typeof node === 'string') out.push(node);
        else if (Array.isArray(node)) node.forEach((n) => stringValues(n, out));
        else if (node && typeof node === 'object') Object.entries(node).forEach(([k, v]) => (k === '$schema' || k === 'image' ? null : stringValues(v, out)));
        return out;
    }

    const wholeWord = (name) => new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');

    function expectNothingLeaks({ built, user, root, ignoreTitles = false }) {
        const { files, members, manifestText, manifest } = built;
        const needles = [root, root.replace(/\//g, '\\'), work, work.replace(/\//g, '\\'), 'C:\\', 'C:/', '/Users/', '/home/', '\\\\fileserver', 'Design Share', 'fileserver', 'Documents\\Work', 'Desktop/Brand Kit', 'file:'];
        const names = [...new Set([user, user.normalize('NFC'), user.normalize('NFD')])];
        // 1. EVERY byte of every file and of the zip: the root, drives, shares and the user's name.
        for (const [file, bytes] of Object.entries(files)) {
            for (const needle of [...needles, ...names]) {
                for (const variant of new Set([needle, needle.normalize('NFC'), needle.normalize('NFD')])) {
                    expect({ file, needle, found: bytes.includes(Buffer.from(variant, 'utf8')) }).toEqual({ file, needle, found: false });
                }
            }
        }
        // 2. The user's name as a whole word, in any case, anywhere in the manifest text.
        for (const name of names) expect({ name, found: wholeWord(name).test(ignoreTitles ? JSON.stringify(manifest.captures.map((c) => c['x-scry-sync'])) : manifestText) }).toEqual({ name, found: false });
        // 3. Values that should have no separator have none: every string in the manifest except `$schema` and `image`.
        for (const value of stringValues(manifest)) {
            expect({ value, separator: /[\\/]/.test(value), drive: /(^|[^\p{L}\p{N}])[A-Za-z]:(?=\S)/u.test(value) }).toEqual({ value, separator: false, drive: false });
        }
        // 4. Entry names are the images' hashes and scf.json, nothing else.
        for (const name of members) expect(name).toMatch(/^(scf\.json|images\/[0-9a-f]{64}\.(png|jpg))$/);
        for (const capture of manifest.captures) expect(capture.image).toMatch(/^images\/[0-9a-f]{64}\.(png|jpg)$/);
    }

    const users = ['Ann Smith', 'Zoë Müller', 'annsmith'];
    let counter = 0;

    test.each(users)('guarantee-2-no-originals-no-paths: nothing of a path or of the user name "%s" is in any byte of a built bundle', async (user) => {
        counter += 1;
        const osUser = jest.spyOn(os, 'userInfo').mockReturnValue({ username: user });
        const osHome = jest.spyOn(os, 'homedir').mockReturnValue(`/home/${user}`);
        try {
            // The synced folder lives under a folder named after the user (spaces, accents), and is itself named with a space.
            const root = path.join(work, `g2-${counter}`, user, 'Acme Designs');
            const xmp = leakyXmp(user);
            write(root, 'Screens/Home.png', makePng(8, 8, { xmp, text: [['Comment', `C:\\Users\\${user}\\x.png`]] }));
            write(root, 'Screens/Home.xmp', xmp);
            write(root, 'Screens/Attr.png', makePng(8, 8, { xmp: xmpPacket({ title: `/Users/${user}/Desktop/a.psd`, label: `D:\\${user}`, form: 'attribute' }) }));
            write(root, 'Screens/Photo.jpg', makeRealJpeg());
            write(root, 'Design/Card.psd', fx.makePsd({ width: 4, height: 4, planes: fx.solidPlanes(4, 4, [1, 2, 3]) }));
            write(root, 'Docs/Deck.pdf', fx.makePdf([{ w: 200, h: 100 }, { w: 100, h: 200 }]));
            write(root, 'Docs/Legacy.ai', fx.makeAiWithoutPdf());
            write(root, `C:\\Users\\${user}\\Documents\\logo.png`, makePng(8, 8)); // a file NAMED like a Windows path
            write(root, `Screens/${user.replace(' ', '_')}-note.txt`, 'text');
            const scan = scanFolder(root);

            for (const folderLabel of [`Acme Designs (/Users/${user}/Projects)`, `C:\\Users\\${user}\\Brand Kit`, `\\\\fileserver\\Design Share\\${user}`, root]) {
                const out = path.join(work, `g2-out-${counter}-${Buffer.from(folderLabel).toString('hex').slice(0, 12)}`);
                const { manifest } = await buildBundle({ folderUuid: FOLDER, scan, outDir: out, appVersion: APP, folderLabel, convertOptions: { tools: [] } });
                expect(validateBundle(out).errors).toEqual([]);
                expectNothingLeaks({ built: await everyByte(out), user, root });
                // The label held a location (or the user's name): it is dropped whole, the title is the file name alone.
                const home = manifest.captures.find((c) => c.id === pictureId(FOLDER, 'Screens/Home.png'));
                expect(home.title).toEqual(['Home']);
                // Whole values only: the clean keywords stay as they were, the leaky ones are gone.
                expect(home['x-scry-sync'].keywords).toEqual(['nav', 'dark mode']);
                expect(home['x-scry-sync'].rating).toBe(4);
                expect(home['x-scry-sync']).not.toHaveProperty('title');
                expect(home['x-scry-sync']).not.toHaveProperty('description');
                expect(home['x-scry-sync']).not.toHaveProperty('label');
                const attr = manifest.captures.find((c) => c.id === pictureId(FOLDER, 'Screens/Attr.png'));
                expect(attr['x-scry-sync']).not.toHaveProperty('title');
                expect(attr['x-scry-sync']).not.toHaveProperty('label');
                // The file named like a path is refused with a verdict, never captured.
                expect(manifest.captures.some((c) => c.title.some((t) => /logo/.test(t)))).toBe(false);
                expect(manifest.counts.skipped.map((x) => x.reason)).toContain('filtered');
            }
            // Only converted pictures: no original file's bytes are in the bundle.
            const out = path.join(work, `g2-out-${counter}-orig`);
            await buildBundle({ folderUuid: FOLDER, scan, outDir: out, appVersion: APP, convertOptions: { tools: [] } });
            const tree = readTree(out);
            for (const original of ['Design/Card.psd', 'Docs/Deck.pdf']) {
                const bytes = fs.readFileSync(path.join(root, original));
                for (const file of Object.values(tree)) expect(file.equals(bytes)).toBe(false);
            }
        } finally {
            osUser.mockRestore();
            osHome.mockRestore();
        }
    }, 120_000);

    test('guarantee-2-no-originals-no-paths: clean metadata and a clean folder label pass through unchanged', async () => {
        const osUser = jest.spyOn(os, 'userInfo').mockReturnValue({ username: 'Ann Smith' });
        try {
            const root = path.join(work, 'g2-clean', 'Ann Smith', 'Acme Designs');
            write(root, 'Screens/Home.png', makePng(8, 8, { xmp: xmpPacket({ title: 'Home screen: v2 (final)', description: 'The "Ann" button, dark mode', keywords: ['nav', 'dark mode', 'Zoë'], rating: 5, label: 'Green' }) }));
            write(root, 'Screens/boxuser-brand.png', makePng(8, 8, { shade: 40 }));
            write(root, 'Screens/Zoë Müller.png', makePng(8, 8, { shade: 50 }));
            write(root, 'Screens/Plan A.png', makePng(8, 8, { shade: 60 }));
            const out = path.join(work, 'g2-clean-out');
            const { manifest } = await buildBundle({ folderUuid: FOLDER, scan: scanFolder(root), outDir: out, appVersion: APP, folderLabel: 'Acme Designs', convertOptions: { tools: [] } });
            const byId = (rel) => manifest.captures.find((c) => c.id === pictureId(FOLDER, rel));
            expect(byId('Screens/Home.png').title).toEqual(['Acme Designs', 'Home']);
            expect(byId('Screens/Home.png')['x-scry-sync']).toMatchObject({ title: 'Home screen: v2 (final)', description: 'The "Ann" button, dark mode', keywords: ['nav', 'dark mode', 'Zoë'], rating: 5, label: 'Green' });
            expect(byId('Screens/Home.png').tags).toEqual(['nav', 'dark mode', 'Zoë']);
            // File names are titles as they are: a name that merely contains "boxuser" or a user's name keeps its title.
            expect(byId('Screens/boxuser-brand.png').title).toEqual(['Acme Designs', 'boxuser-brand']);
            expect(byId('Screens/Zoë Müller.png').title).toEqual(['Acme Designs', 'Zoë Müller']);
            expect(byId('Screens/Plan A.png').title).toEqual(['Acme Designs', 'Plan A']);
        } finally {
            osUser.mockRestore();
        }
    }, 60_000);

    test('guarantee-2-no-originals-no-paths: a user named like a word in a title does not mangle other words (whole-word match, not substring)', () => {
        const { makeLeakCheck } = require('../lib/converter/privacy.js');
        const osUser = jest.spyOn(os, 'userInfo').mockReturnValue({ username: 'Ann Smith' });
        const osHome = jest.spyOn(os, 'homedir').mockReturnValue('/home/ann');
        const leaks = makeLeakCheck({ root: '/work/Acme', names: ['art'] });
        osUser.mockRestore();
        osHome.mockRestore();
        expect(leaks('Ann Smith')).toBe(true);
        expect(leaks('made by ann smith, final')).toBe(true);
        expect(leaks('Annette Smithson')).toBe(false);
        expect(leaks('Smart cart')).toBe(false); // "art" inside words
        expect(leaks('boxuser-brand')).toBe(false);
        expect(leaks('the art of it')).toBe(true); // the name as a whole word
        expect(leaks('Art-director')).toBe(false); // a name joined into a hyphenated phrase that is not a path is kept (F76)
        expect(leaks('art - director')).toBe(true);
        expect(leaks('Work in /WORK/acme folder')).toBe(true);
        expect(leaks('c:\\work\\acme')).toBe(true);
        expect(leaks('Home screen')).toBe(false);
    });

    /**
     * Review round 2 (F74, F75, F78): a path hidden by URL encoding (single or double), an old Mac colon path, or a
     * fullwidth / lookalike slash is still a path and is dropped whole; ordinary colons stay.
     */
    test('guarantee-2-no-originals-no-paths: encoded, colon-style and lookalike-slash paths are dropped whole and noted by field name', async () => {
        const osUser = jest.spyOn(os, 'userInfo').mockReturnValue({ username: 'boxuser' });
        const osHome = jest.spyOn(os, 'homedir').mockReturnValue('/home/boxuser');
        try {
            const root = path.join(work, 'g2-encoded', 'Acme');
            const hidden = [
                '%2FUsers%2Fboxuser%2FDesktop%2Fsecret.psd',
                '%252FUsers%252Fboxuser%252FDesktop%252Fsecret.psd',
                'C%3A%5CProjects%5CClient%5Ca.psd',
                'Macintosh HD:Projects:Secret Client:a.psd',
                '／Volumes／Client Secret／a.psd',
                '＼＼server＼Share＼a.psd',
                'Projects∕Client∕a.psd',
            ];
            write(root, 'Home.png', makePng(8, 8, { xmp: xmpPacket({ title: 'Version A:B', description: 'file%3A%2F%2F%2Fhome%2Fboxuser%2Fa.psd', keywords: ['nav', ...hidden, 'Note: final'], label: 'Macintosh HD:Projects:a.psd' }) }));
            write(root, 'Clean.png', makePng(8, 8, { shade: 30, xmp: xmpPacket({ title: 'Clean', keywords: ['nav'] }) }));
            const out = path.join(work, 'g2-encoded-out');
            const { manifest, results } = await buildBundle({ folderUuid: FOLDER, scan: scanFolder(root), outDir: out, appVersion: APP, folderLabel: 'Acme', convertOptions: { tools: [] } });
            const home = manifest.captures.find((c) => c.id === pictureId(FOLDER, 'Home.png'));
            expect(home['x-scry-sync']).toMatchObject({ title: 'Version A:B', keywords: ['nav', 'Note: final'] });
            expect(home['x-scry-sync']).not.toHaveProperty('description');
            expect(home['x-scry-sync']).not.toHaveProperty('label');
            expect(home.tags).toEqual(['nav', 'Note: final']);
            // F76: the person can see that something was dropped and which field, never the value.
            expect(home['x-scry-sync'].notes).toEqual([{ code: 'metadata_dropped', fields: ['description', 'label', 'keywords'] }]);
            expect(results.find((r) => r.rel === 'Home.png').notes).toEqual([{ code: 'metadata_dropped', fields: ['description', 'label', 'keywords'] }]);
            const clean = manifest.captures.find((c) => c.id === pictureId(FOLDER, 'Clean.png'));
            expect(clean['x-scry-sync']).not.toHaveProperty('notes');
            expect(results.find((r) => r.rel === 'Clean.png')).not.toHaveProperty('notes');
            const text = fs.readFileSync(path.join(out, 'scf.json'), 'utf8');
            for (const needle of ['boxuser', '%2F', '%5C', '%3A', 'Macintosh', 'Secret', 'Volumes', 'server', '／', '＼', '∕']) expect({ needle, found: text.includes(needle) }).toEqual({ needle, found: false });
        } finally {
            osUser.mockRestore();
            osHome.mockRestore();
        }
    }, 60_000);

    test('guarantee-2-no-originals-no-paths: the leak check decodes before it looks, and keeps ordinary colons and joined names', () => {
        const { makeLeakCheck } = require('../lib/converter/privacy.js');
        const osUser = jest.spyOn(os, 'userInfo').mockReturnValue({ username: 'boxuser' });
        const osHome = jest.spyOn(os, 'homedir').mockReturnValue('/home/boxuser');
        const leaks = makeLeakCheck({ root: '/work/Acme', names: ['annsmith'] });
        osUser.mockRestore();
        osHome.mockRestore();
        const dropped = [
            '%2FUsers%2Fboxuser%2FDesktop%2Fsecret.psd', // F74 probe
            'file%3A%2F%2F%2Fhome%2Fboxuser%2Fa.psd', // F74 probe
            '%2fprojects%2fa.psd', // lower-case escapes, no user name: still a path
            'Projects%5CClient%5Ca.psd',
            '%252FUsers%252Fann%252Fa.psd', // double-encoded
            '%25252Fa%25252Fb', // triple-encoded
            'by%20boxuser', // the name hidden by an escape
            'by+boxuser', // form-encoded space
            '%E2%88%95Volumes%E2%88%95a.psd', // an encoded lookalike slash
            'file%3Aa.psd',
            'bad %ZZ escape then %2Fetc%2Fpasswd', // a bad escape does not stop the decode
            '%C3%28 broken utf8 %2Fa%2Fb',
            'Macintosh HD:Projects:Secret Client:a.psd', // F75
            'Macintosh HD:a.psd', // a volume prefix alone
            'Server HD:Jobs',
            'Projects:Client:a.psd', // 3+ segments, no space after the colons
            '／Volumes／Client Secret／a.psd', // F78 fullwidth solidus
            '＼＼server＼share', // fullwidth reverse solidus
            'a﹨b', // small reverse solidus
            'Projects∕Client', // division slash
            'Projects⧸Client', // big solidus
            'Ｃ：＼Ｕｓｅｒｓ', // fullwidth drive
            'C:', // a bare drive
            'C:Users', // a drive-relative path
            'ｂｏｘｕｓｅｒ', // fullwidth user name
            'boxuser',
            'by boxuser',
            '-home-boxuser-scry', // a flattened path that holds the name
            'Users_boxuser_Desktop',
            'boxuser-', // the name with nothing joined to it
        ];
        for (const value of dropped) expect({ value, dropped: leaks(value) }).toEqual({ value, dropped: true });
        const kept = [
            'Version A:B', // F76 probe
            'Note: final',
            'Home screen: v2 (final)',
            'Ratio 16:9',
            'Exported 10:30:15',
            '100% done',
            '50%2 off', // not an escape
            'boxuser-brand', // F76: the name joined into a longer phrase that is not a path
            'brand_boxuser_kit',
            'xboxuser', // F78: glued names are the accepted trade-off of the whole-word rule
            'joannsmithers',
            'boxuser2024',
            '1⁄2 size', // the fraction slash is left alone: it is how fractions are written
        ];
        for (const value of kept) expect({ value, dropped: leaks(value) }).toEqual({ value, dropped: false });
    });

    /**
     * Review round 3 (F108-F111): the decode fails closed past its bound, `%uXXXX` and HTML entities are decoded, an
     * escape is a word break, more slash lookalikes, more folder words, spaced colon paths, and a linear check.
     */
    const encodeTimes = (text, times) => {
        let out = text;
        for (let i = 0; i < times; i += 1) out = out.replace(/%/g, '%25');
        return out;
    };
    const fiveFold = encodeTimes('%2Fhome%2Fboxuser%2Fa', 4); // %252525252Fhome... (the review's probe)
    const sixFold = encodeTimes('%2Fhome%2Fboxuser%2Fa', 5);
    const round3Dropped = [
        fiveFold,
        sixFold,
        encodeTimes('%2Fa%2Fb', 7), // no name, still a path, past the bound
        '%u002Fhome%u002Fboxuser',
        '%u002fVolumes%u002fClient', // %u escape, no name
        'x%2Fboxuser', // the name glued to the hex letters of an escape
        'x%u00A0boxuser',
        '&#47;Volumes&#47;Client&#47;a.psd',
        '&amp;#47;Volumes&amp;#47;Client&amp;#47;a.psd',
        '&amp;amp;#47;Volumes&amp;amp;#47;Client&amp;amp;#47;a.psd',
        '&#x2F;Volumes&#x2f;a.psd',
        'Volumes&sol;Client&sol;a.psd',
        'C&colon;&bsol;Projects',
        'Volumes∖Client∖a',
        'Volumes⧵Client',
        'Volumes╱Client',
        'Volumes⟋Client',
        'srv-boxuser-scry', // F111 folder words
        'opt_boxuser',
        'var-boxuser',
        'tmp-boxuser',
        'private_boxuser_x',
        'root-boxuser',
        'Macintosh HD: Projects: a.psd', // F111 spaced colon path
        'Data HD: Jobs: a.psd',
        'Client:a.psd', // one colon before a file name with an extension
        'a'.repeat(5000), // over-long text is dropped whole, never scanned
    ];
    const round3Kept = ['Version A:B', 'Note: final', 'Ratio 16:9', 'Exported 10:30:15', 'boxuser-brand', 'Art-director', 'TODO: fix: now', 'Mockup 3:4:5', 'Tom &amp; Jerry', 'R&D notes', '100% done', 'Ratio: 4:3', 'Time: 10:30', 'Step 1: crop', 'Option: A: B'];

    test('guarantee-2-no-originals-no-paths: round 3 probes are dropped (fail closed past the decode bound) and ordinary text stays', () => {
        const { makeLeakCheck } = require('../lib/converter/privacy.js');
        const osUser = jest.spyOn(os, 'userInfo').mockReturnValue({ username: 'boxuser' });
        const osHome = jest.spyOn(os, 'homedir').mockReturnValue('/home/boxuser');
        const leaks = makeLeakCheck({ root: '/work/Acme' });
        osUser.mockRestore();
        osHome.mockRestore();
        for (const value of round3Dropped) expect({ value: value.slice(0, 80), dropped: leaks(value) }).toEqual({ value: value.slice(0, 80), dropped: true });
        for (const value of round3Kept) expect({ value, dropped: leaks(value) }).toEqual({ value, dropped: false });
    });

    test('guarantee-2-no-originals-no-paths: round 3 probes in a real bundle leave no name and no path, noted by field name', async () => {
        const osUser = jest.spyOn(os, 'userInfo').mockReturnValue({ username: 'boxuser' });
        const osHome = jest.spyOn(os, 'homedir').mockReturnValue('/home/boxuser');
        try {
            const root = path.join(work, 'g2-round3', 'Acme');
            write(root, 'Five.png', makePng(8, 8, { xmp: xmpPacket({ title: fiveFold, description: sixFold, keywords: ['nav', fiveFold, '%u002Fhome%u002Fboxuser', '&amp;#47;Volumes&amp;#47;Client&amp;#47;a.psd', 'Volumes∖Client∖a'] }) }));
            const out = path.join(work, 'g2-round3-out');
            const longLabel = `Acme ${'brand-'.repeat(10_000)}`;
            const { manifest, results } = await buildBundle({ folderUuid: FOLDER, scan: scanFolder(root), outDir: out, appVersion: APP, folderLabel: longLabel, convertOptions: { tools: [] } });
            const five = manifest.captures.find((c) => c.id === pictureId(FOLDER, 'Five.png'));
            expect(five['x-scry-sync'].keywords).toEqual(['nav']);
            expect(five.tags).toEqual(['nav']);
            expect(five['x-scry-sync']).not.toHaveProperty('description');
            expect(five['x-scry-sync'].notes).toEqual([{ code: 'metadata_dropped', fields: ['title', 'description', 'keywords'] }]);
            expect(results.find((r) => r.rel === 'Five.png').notes).toEqual([{ code: 'metadata_dropped', fields: ['title', 'description', 'keywords'] }]);
            // The long label is cut to 200 BEFORE the check, then kept (it holds no location).
            expect(five.title[0]).toBe(longLabel.slice(0, 200));
            const text = fs.readFileSync(path.join(out, 'scf.json'), 'utf8');
            for (const needle of ['boxuser', '%25', '%u', '&#47;', '&amp;', 'Volumes', '∖']) expect({ needle, found: text.includes(needle) }).toEqual({ needle, found: false });
        } finally {
            osUser.mockRestore();
            osHome.mockRestore();
        }
    }, 60_000);

    test('guarantee-2-no-originals-no-paths: the leak check takes linear time (4x the text costs well under 16x)', () => {
        const { makeLeakCheck } = require('../lib/converter/privacy.js');
        const leaks = makeLeakCheck({ root: '/work/Acme', names: ['annsmith'] });
        const cost = (text) => {
            let best = Infinity;
            for (let trial = 0; trial < 5; trial += 1) {
                const start = process.hrtime.bigint();
                for (let i = 0; i < 10; i += 1) leaks(text);
                best = Math.min(best, Number(process.hrtime.bigint() - start));
            }
            return best;
        };
        for (const unit of ['a', 'a-', 'a_b-']) {
            const small = unit.repeat(Math.floor(1000 / unit.length));
            const large = unit.repeat(Math.floor(4000 / unit.length));
            cost(small); // warm up
            const ratio = cost(large) / cost(small);
            expect({ unit, linear: ratio < 9 }).toEqual({ unit, linear: true });
        }
    });

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
