/**
 * Creative Cloud Libraries source (`x-scry-cc`), converter side (feature cc-libraries-source, PR 1).
 *   - the default ids and source kind are unchanged (regression);
 *   - the id function is pluggable; Creative Cloud ids ignore names (G7);
 *   - `origin` carries library, item, link, stock and never a URL, token or path (G2).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { scanFolder, buildBundle, pictureId, ccLibraryId, cleanAdobeLink, SOURCE_KIND, SOURCE_KINDS, CC_SOURCE_KIND, PictureIdError } = require('../lib/converter');
const { validateBundle } = require('../lib/scf.js');
const { tempDir, write, makePng } = require('./helpers/importFixtures.js');

const FOLDER = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const SOURCE = '7a1d9c52-0e3b-4f86-9d21-5b6c7d8e9f01';
const APP = '0.1.0-beta.1';
const CANARY_SIG = 'CANARY-SIGNATURE-9f3a';
const CANARY_TOKEN = 'CANARY-TOKEN-77c1';

let work;
beforeAll(() => {
    work = tempDir('cc-source');
});
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

function stagedFolder(name, files) {
    const root = path.join(work, name);
    for (const [rel, shade] of Object.entries(files)) write(root, rel, makePng(8, 8, { shade }));
    return root;
}

function ccArgs(root, outName, origins, extra = {}) {
    const scan = scanFolder(root);
    for (const file of scan.files) file.origin = origins[file.rel];
    return {
        sourceKind: CC_SOURCE_KIND,
        scan,
        outDir: path.join(work, outName),
        appVersion: APP,
        idFor: (file, page) => ccLibraryId(SOURCE, 'lib-1', file.rel.replace(/\.png$/, ''), page),
        ...extra,
    };
}

describe('default ids and source kind are unchanged (regression)', () => {
    test('pictureId still gives the ids it gave before the id function became pluggable (fixed vectors)', () => {
        expect(pictureId(FOLDER, 'Screens/Home.psd')).toBe('633439d8bdaebd4de9bbb1159e1dc6141de6ca4e55499add23aec4ae7340a51d');
        expect(pictureId(FOLDER, 'Deck.pdf', 2)).toBe('2345158fadb9c473f5fd4e3ea9d1d1ff7d1560876ca1179dd57764edad8267c7#p2');
    });

    test('a folder bundle built with no new argument has the same ids, kind x-scry-sync and the old origin', async () => {
        const root = stagedFolder('legacy', { 'Screens/Home.png': 10, 'Docs/Card.png': 20 });
        const { manifest } = await buildBundle({ folderUuid: FOLDER, scan: scanFolder(root), outDir: path.join(work, 'legacy-out'), appVersion: APP, folderLabel: 'My folder' });
        expect(manifest.source.kind).toBe('x-scry-sync');
        const byId = Object.fromEntries(manifest.captures.map((c) => [c.id, c]));
        expect(Object.keys(byId).sort()).toEqual([pictureId(FOLDER, 'Docs/Card.png'), pictureId(FOLDER, 'Screens/Home.png')].sort());
        const capture = byId[pictureId(FOLDER, 'Screens/Home.png')];
        expect(capture['x-scry-sync'].origin).toEqual({ convertedFrom: 'png', verdict: 'faithful', appVersion: APP });
        expect(capture['x-scry-cc']).toBeUndefined();
        expect(capture.title).toEqual(['My folder', 'Home']);
        expect(validateBundle(path.join(work, 'legacy-out')).ok).toBe(true);
    });

    test('a folder bundle ignores per-file origin and a Creative Cloud id function is only used when given', async () => {
        const root = stagedFolder('legacy-ignore', { 'a.png': 5 });
        const scan = scanFolder(root);
        scan.files[0].origin = { library: 'Brand', item: 'Logo', link: 'https://assets.adobe.com/x', stock: true };
        const { manifest } = await buildBundle({ folderUuid: FOLDER, scan, outDir: path.join(work, 'legacy-ignore-out'), appVersion: APP });
        expect(manifest.captures[0].id).toBe(pictureId(FOLDER, 'a.png'));
        expect(manifest.captures[0]['x-scry-sync'].origin).toEqual({ convertedFrom: 'png', verdict: 'faithful', appVersion: APP });
    });

    test('the source kinds are a closed set and an unknown kind or a non-function id hook is refused', async () => {
        expect(SOURCE_KINDS).toEqual([SOURCE_KIND, CC_SOURCE_KIND]);
        const root = stagedFolder('kinds', { 'a.png': 5 });
        const base = { folderUuid: FOLDER, scan: scanFolder(root), outDir: path.join(work, 'kinds-out'), appVersion: APP };
        await expect(buildBundle({ ...base, sourceKind: 'x-scry-other' })).rejects.toThrow(TypeError);
        await expect(buildBundle({ ...base, sourceKind: 'x-adobe-bridge' })).rejects.toThrow(TypeError);
        await expect(buildBundle({ ...base, idFor: 'nope' })).rejects.toThrow(TypeError);
    });
});

describe('guarantee-7 a rename keeps the same picture (Creative Cloud ids ignore names)', () => {
    test('guarantee-7 ccLibraryId is sha256 of the documented text and does not take a name or path', () => {
        const expected = crypto.createHash('sha256').update(`cc-library\n${SOURCE}\nLIB-A\nEL-9`).digest('hex');
        expect(ccLibraryId(SOURCE, 'LIB-A', 'EL-9')).toBe(expected);
        expect(ccLibraryId(SOURCE.toUpperCase(), 'LIB-A', 'EL-9')).toBe(expected);
        expect(ccLibraryId(SOURCE, 'LIB-A', 'EL-9', 3)).toBe(`${expected}#p3`);
    });

    test('guarantee-7 other source, library or element gives another id; a line break inside a part is refused (no ambiguity)', () => {
        const base = ccLibraryId(SOURCE, 'LIB-A', 'EL-9');
        expect(new Set([base, ccLibraryId(SOURCE, 'LIB-B', 'EL-9'), ccLibraryId(SOURCE, 'LIB-A', 'EL-8'), ccLibraryId('11111111-2222-3333-4444-555555555555', 'LIB-A', 'EL-9')]).size).toBe(4);
        expect(() => ccLibraryId(SOURCE, 'LIB-A\nEL', '9')).toThrow(PictureIdError);
        expect(() => ccLibraryId(SOURCE, '', 'EL-9')).toThrow(PictureIdError);
        expect(() => ccLibraryId(SOURCE, 'LIB-A', 'EL-9', 0)).toThrow(PictureIdError);
        expect(ccLibraryId(SOURCE, 'a', 'b\u0000c')).not.toBe(ccLibraryId(SOURCE, 'a', 'bc'));
    });

    test('guarantee-7 renaming an item (new item name, same element) keeps the id and changes only the title', async () => {
        const root = stagedFolder('rename', { 'el-1.png': 40 });
        const before = await buildBundle(ccArgs(root, 'rename-a', { 'el-1.png': { library: 'Brand', item: 'Logo draft', stock: false } }));
        const after = await buildBundle(ccArgs(root, 'rename-b', { 'el-1.png': { library: 'Brand', item: 'Logo final', stock: false } }));
        expect(after.manifest.captures[0].id).toBe(before.manifest.captures[0].id);
        expect(before.manifest.captures[0].title).toEqual(['Brand', 'Logo draft']);
        expect(after.manifest.captures[0].title).toEqual(['Brand', 'Logo final']);
        expect(after.manifest.captures[0].image).toBe(before.manifest.captures[0].image);
    });
});

describe('x-scry-cc bundle', () => {
    test('a generated bundle passes the vendored `scf validate`, with kind x-scry-cc and the allow-listed origin', async () => {
        const root = stagedFolder('cc-ok', { 'own.png': 11, 'stock.png': 22 });
        const out = path.join(work, 'cc-ok-out');
        const { manifest } = await buildBundle(ccArgs(root, 'cc-ok-out', {
            'own.png': { library: 'Brand kit', item: 'Hero banner', link: 'https://assets.adobe.com/libraries/abc-123?token=SECRET#frag', stock: false },
            'stock.png': { library: 'Brand kit', item: 'Sunset', stock: true },
        }));
        expect(manifest.source).toMatchObject({ kind: 'x-scry-cc', platform: 'other' });
        const result = validateBundle(out);
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);
        const own = manifest.captures.find((c) => c.id === ccLibraryId(SOURCE, 'lib-1', 'own'));
        expect(own['x-scry-cc'].origin).toEqual({
            convertedFrom: 'png', verdict: 'faithful', appVersion: APP,
            kind: 'cc-library', library: 'Brand kit', item: 'Hero banner', stock: false, link: 'https://assets.adobe.com/libraries/abc-123',
        });
        expect(own['x-scry-sync']).toBeUndefined();
        const stock = manifest.captures.find((c) => c.id === ccLibraryId(SOURCE, 'lib-1', 'stock'));
        expect(stock['x-scry-cc'].origin).toMatchObject({ kind: 'cc-library', stock: true });
        expect(stock['x-scry-cc'].origin.link).toBeUndefined();
    });

    test('an id hook that throws or returns nothing fails that file as odd_name, not the whole bundle', async () => {
        const root = stagedFolder('cc-badid', { 'a.png': 1, 'b.png': 2 });
        const { manifest, results } = await buildBundle(ccArgs(root, 'cc-badid-out', {}, {
            idFor: (file) => {
                if (file.rel === 'a.png') throw new Error('no');
                return ccLibraryId(SOURCE, 'l', 'b');
            },
        }));
        expect(manifest.captures.map((c) => c.id)).toEqual([ccLibraryId(SOURCE, 'l', 'b')]);
        expect(results.find((r) => r.rel === 'a.png').codes).toContain('odd_name');
    });
});

describe('guarantee-2 no URL, token or path in an origin field (converter)', () => {
    const SIGNED = [
        `https://cc-api-storage.adobe.io/id/x/y?X-Amz-Signature=${CANARY_SIG}&X-Amz-Credential=a`,
        `https://adobe-libraries.s3.amazonaws.com/a/b?token=${CANARY_TOKEN}`,
        `http://assets.adobe.com/libraries/x`,
        `https://user:${CANARY_TOKEN}@assets.adobe.com/x`,
        `https://assets.adobe.com:8443/x`,
        `https://adobe.com.evil.example/x?t=${CANARY_TOKEN}`,
        `https://notadobe.com/x`,
        `https://evil.example/https://adobe.com/x`,
        `https://assets.adobe.com/libraries/${CANARY_TOKEN}/token/${CANARY_SIG}`,
        `https://assets.adobe.com/x/${'a'.repeat(80)}`,
        `https://assets.adobe.com/x%2F..%2Fsecret`,
        `${'java'}script:alert('${CANARY_TOKEN}')`,
        `file:///home/user/${CANARY_TOKEN}`,
        `//assets.adobe.com/x`,
        'https://assets.adobe.com/x y',
        `https:\\\\assets.adobe.com\\x`,
        '',
        null,
        42,
    ];

    test('guarantee-2 cleanAdobeLink drops every signed-URL-looking or non-adobe.com string (canary)', () => {
        for (const raw of SIGNED) expect(cleanAdobeLink(raw)).toBeNull();
    });

    test('cc-library-no-adobe-link: the two link shapes Scry Sync 0.1.5 builds from ids survive unchanged', () => {
        const lib = '45f7d4a9-73b2-4002-ba47-432c86554852';
        const item = '0d6e8a52-9c1b-4f7e-8a3d-6b2f1c9e4a70';
        for (const link of [`https://www.adobe.com/files/libraries/${lib}/${item}`, `https://www.adobe.com/files/libraries/${lib}`, 'https://stock.adobe.com/123456789']) {
            expect(cleanAdobeLink(link)).toBe(link);
        }
    });

    test('guarantee-2 cleanAdobeLink keeps a plain https adobe.com address and strips query and fragment', () => {
        expect(cleanAdobeLink('https://assets.adobe.com/libraries/abc-123')).toBe('https://assets.adobe.com/libraries/abc-123');
        expect(cleanAdobeLink('https://ASSETS.Adobe.com/libraries/abc?x=1#y')).toBe('https://assets.adobe.com/libraries/abc');
        expect(cleanAdobeLink('https://adobe.com/')).toBe('https://adobe.com');
        expect(cleanAdobeLink(`https://assets.adobe.com/libraries/abc?X-Amz-Signature=${CANARY_SIG}`)).toBe('https://assets.adobe.com/libraries/abc');
    });

    test('guarantee-2 a bundle built from canary links, names and tokens carries none of them anywhere', async () => {
        const files = {};
        const origins = {};
        SIGNED.filter((v) => typeof v === 'string').forEach((link, i) => {
            files[`e${i}.png`] = i + 1;
            origins[`e${i}.png`] = { library: 'Lib', item: `Item ${i}`, link, stock: false };
        });
        files['n.png'] = 99;
        origins['n.png'] = { library: `https://cc.adobe.io/x?sig=${CANARY_SIG}`, item: `https://cc.adobe.io/y?token=${CANARY_TOKEN}`, link: 'https://assets.adobe.com/libraries/ok', stock: 'yes' };
        const root = stagedFolder('canary', files);
        const out = path.join(work, 'canary-out');
        const { manifest, results } = await buildBundle(ccArgs(root, 'canary-out', origins));
        const text = JSON.stringify({ manifest, results }) + fs.readFileSync(path.join(out, 'scf.json'), 'utf8');
        for (const needle of [CANARY_SIG, CANARY_TOKEN, 'X-Amz', 'amazonaws', 'adobe.io', 'evil.example', 'user:']) expect(text).not.toContain(needle);
        const n = manifest.captures.find((c) => c.id === ccLibraryId(SOURCE, 'lib-1', 'n'));
        expect(n['x-scry-cc'].origin.library).toBeUndefined();
        expect(n['x-scry-cc'].origin.item).toBeUndefined();
        expect(n['x-scry-cc'].origin.stock).toBeUndefined();
        expect(n['x-scry-cc'].origin.link).toBe('https://assets.adobe.com/libraries/ok');
        const note = n['x-scry-cc'].notes.find((x) => x.code === 'metadata_dropped');
        expect(note.fields).toEqual(expect.arrayContaining(['library', 'item']));
        expect(validateBundle(out).ok).toBe(true);
    });

    test('guarantee-2 origin carries only the allow-listed keys even when the app passes more', async () => {
        const root = stagedFolder('extra-keys', { 'a.png': 3 });
        const { manifest } = await buildBundle(ccArgs(root, 'extra-keys-out', {
            'a.png': { library: 'L', item: 'I', stock: true, token: CANARY_TOKEN, path: '/home/x', signedUrl: `https://a.adobe.com/?s=${CANARY_SIG}`, manifest: { a: 1 }, kind: 'evil' },
        }));
        expect(Object.keys(manifest.captures[0]['x-scry-cc'].origin).sort()).toEqual(['appVersion', 'convertedFrom', 'item', 'kind', 'library', 'stock', 'verdict']);
        expect(manifest.captures[0]['x-scry-cc'].origin.kind).toBe('cc-library');
        expect(JSON.stringify(manifest)).not.toContain(CANARY_TOKEN);
    });
});
