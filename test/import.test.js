/** `scry import` units: XMP allow-list reader, metadata stripping, conversion ladder, folder scan. */
const fs = require('fs');
const path = require('path');
const { parseAllowListed, extractXmpPacket, sanitizeText, readEmbeddedPacket } = require('../lib/importXmp.js');
const { stripMetadata } = require('../lib/importStrip.js');
const { convertFile, detectTools, measure } = require('../lib/importConvert.js');
const { scanFolder, ImportInputError } = require('../lib/importScan.js');
const { runImport } = require('../lib/importCommand.js');
const { CANARY, makePng, makeJpeg, makeWebp, xmpPacket, tempDir, write } = require('./helpers/importFixtures.js');

describe('XMP allow-list reader', () => {
    test('element form: x-default title, description, keywords, rating, label; nothing else', () => {
        const meta = parseAllowListed(xmpPacket({ title: 'Teapot', description: 'Blue ceramic', keywords: ['blue', 'ceramic', 'blue'], rating: 4, label: 'Green' }));
        expect(meta).toEqual({ title: 'Teapot', description: 'Blue ceramic', keywords: ['blue', 'ceramic'], rating: 4, label: 'Green' });
        expect(JSON.stringify(meta)).not.toContain(CANARY.gps);
    });
    test('attribute form (Bridge writes this too)', () => {
        expect(parseAllowListed(xmpPacket({ form: 'attribute', title: 'T', rating: 2, label: 'Red' }))).toEqual({ title: 'T', rating: 2, label: 'Red' });
    });
    test('rating 0 (unrated) and -1 (rejected) are not stored', () => {
        expect(parseAllowListed(xmpPacket({ rating: -1, extra: false }))).toEqual({});
        expect(parseAllowListed(xmpPacket({ rating: 0, extra: false }))).toEqual({});
    });
    test('decodes entities, limits keyword count, ignores unparseable or foreign packets', () => {
        const many = Array.from({ length: 80 }, (_, i) => `kw${i}`);
        expect(parseAllowListed(xmpPacket({ keywords: many })).keywords).toHaveLength(50);
        expect(parseAllowListed(xmpPacket({ title: 'Salt &amp; pepper' })).title).toBe('Salt & pepper');
        expect(parseAllowListed('<x:xmpmeta><broken')).toEqual({});
        expect(parseAllowListed('<x:xmpmeta xmlns:x="a"></x:xmpmeta>')).toEqual({});
    });
    test('an entity bomb is not expanded', () => {
        const bomb = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><x:xmpmeta xmlns:x="a"><rdf:RDF xmlns:rdf="r"><rdf:Description xmlns:dc="d"><dc:title>&b;&b;&b;</dc:title></rdf:Description></rdf:RDF></x:xmpmeta>';
        const meta = parseAllowListed(bomb);
        expect((meta.title || '').length).toBeLessThan(100);
    });
    test('sanitizeText strips markup, control and bidi characters, and caps by characters', () => {
        expect(sanitizeText('a<b>b</b>‮c\u0000d', 50)).toBe('a b c d');
        expect(sanitizeText('x'.repeat(300), 200)).toHaveLength(200);
    });
    test('packet extraction from a JPEG and a large file window', () => {
        const jpg = makeJpeg(8, 6, { xmp: xmpPacket({ title: 'In JPEG', extra: false }) });
        expect(extractXmpPacket(jpg)).toMatch(/^<x:xmpmeta/);
        const dir = tempDir('xmp');
        const file = write(dir, 'big.bin', Buffer.concat([Buffer.alloc(9 * 1024 * 1024), Buffer.from(xmpPacket({ title: 'At the tail', extra: false }))]));
        const fd = fs.openSync(file, 'r');
        const packet = readEmbeddedPacket(fd, fs.statSync(file).size);
        fs.closeSync(fd);
        expect(parseAllowListed(packet).title).toBe('At the tail');
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe('metadata stripping', () => {
    test('JPEG keeps the picture and drops EXIF, XMP, IPTC and comments', () => {
        const src = makeJpeg(8, 6, { xmp: xmpPacket({ title: 'x' }) });
        const out = stripMetadata(src, 'jpeg');
        expect(measure(out)).toMatchObject({ family: 'jpeg', width: 8, height: 6 });
        const text = out.toString('latin1');
        for (const gone of [CANARY.gps, 'xap/1.0', 'IPTC-CANARY', 'comment-canary']) expect(text).not.toContain(gone);
        expect(text).toContain('JFIF');
        expect(out.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    });
    test('PNG keeps IHDR/IDAT/IEND and drops text and XMP chunks', () => {
        const out = stripMetadata(makePng(4, 4, { text: [`k\0${CANARY.gps}`], xmp: xmpPacket({ title: 'x' }) }), 'png');
        expect(measure(out)).toMatchObject({ family: 'png', width: 4, height: 4 });
        expect(out.toString('latin1')).not.toMatch(/tEXt|iTXt|CANARY/);
    });
    test('WebP drops EXIF and XMP chunks, clears the VP8X flags and fixes the RIFF size', () => {
        const out = stripMetadata(makeWebp(5, 3), 'webp');
        expect(measure(out)).toMatchObject({ family: 'webp', width: 5, height: 3 });
        expect(out.readUInt32LE(4)).toBe(out.length - 8);
        expect(out[20] & 0x0c).toBe(0);
        expect(out.toString('latin1')).not.toMatch(/EXIF|XMP |CANARY/);
    });
    test('truncated or foreign bytes return null instead of being passed through', () => {
        expect(stripMetadata(Buffer.from('nope'), 'png')).toBeNull();
        expect(stripMetadata(makePng().subarray(0, 40), 'png')).toBeNull();
        expect(stripMetadata(makeJpeg().subarray(0, 30), 'jpeg')).toBeNull();
        expect(stripMetadata(Buffer.from('RIFFxxxxWAVE'), 'webp')).toBeNull();
    });
});

describe('conversion', () => {
    const writeOut = (args, bytes) => fs.writeFileSync(args.find((a) => /^(png|jpeg):/.test(a)).replace(/^(png|jpeg):/, ''), bytes);

    test('detectTools reports only installed tools', () => {
        const run = (name) => ({ status: name === 'magick' || name === 'pdftoppm' ? 0 : 1 });
        expect(detectTools(run)).toEqual(['magick', 'pdftoppm']);
        expect(detectTools(() => ({ error: new Error('ENOENT') }))).toEqual([]);
    });
    test('no converter installed: a named skip reason, not a crash', async () => {
        const res = await convertFile('/x/a.psd', '.psd', { tools: [] });
        expect(res).toMatchObject({ ok: false, reason: 'unsupported' });
        expect(res.detail).toMatch(/install ImageMagick/);
    });
    test('first attempt is lossless PNG; passes an explicit coder prefix and the file as one argument', async () => {
        const calls = [];
        const run = (file, args) => { calls.push({ file, args }); writeOut(args, makePng(10, 8)); return { status: 0 }; };
        const res = await convertFile('/work/my file [1].psd', '.psd', { tools: ['magick'], run });
        expect(res).toMatchObject({ ok: true, family: 'png', width: 10, height: 8 });
        expect(calls).toHaveLength(1);
        expect(calls[0].args.filter((a) => a.startsWith('psd:'))).toEqual(['psd:/work/my file [1].psd[0]']);
    });
    test('over 20 MB falls down the ladder to a smaller JPEG', async () => {
        const bigJpeg = Buffer.concat([makeJpeg(10, 8, { exif: false }).subarray(0, -2), Buffer.alloc(21 * 1024 * 1024, 7), Buffer.from([0xff, 0xd9])]);
        const attempts = [];
        const run = (file, args) => {
            const out = args.find((a) => /^(png|jpeg):/.test(a));
            attempts.push(out.split(':')[0]);
            writeOut(args, attempts.length === 1 ? bigJpeg : makeJpeg(10, 8, { exif: false }));
            return { status: 0 };
        };
        // first attempt writes a "png" that is really an oversize jpeg; it is rejected on size
        const res = await convertFile('/work/a.tif', '.tif', { tools: ['magick'], run });
        expect(res).toMatchObject({ ok: true, family: 'jpeg' });
        expect(attempts).toEqual(['png', 'jpeg']);
    });
    test('a tool that fails on every attempt gives a reason', async () => {
        const res = await convertFile('/work/a.pdf', '.pdf', { tools: ['magick', 'pdftoppm'], run: () => ({ status: 1 }) });
        expect(res).toMatchObject({ ok: false, reason: 'error' });
    });
    test('pdftoppm is only used for PDF and AI', async () => {
        const calls = [];
        const res = await convertFile('/work/a.tif', '.tif', { tools: ['pdftoppm'], run: (f) => { calls.push(f); return { status: 0 }; } });
        expect(res.ok).toBe(false);
        expect(calls).toEqual([]);
    });
});

describe('folder scan and command input', () => {
    test('hidden files, __MACOSX and non-images are ignored; links are reported', () => {
        const dir = tempDir('scan');
        write(dir, 'a.PNG', makePng());
        write(dir, '.hidden.png', makePng());
        write(dir, '__MACOSX/b.png', makePng());
        write(dir, 'x/y/c.jpeg', makeJpeg());
        write(dir, 'notes.txt', 'n');
        fs.symlinkSync(path.join(dir, 'a.PNG'), path.join(dir, 'link.png'));
        fs.symlinkSync(path.join(dir, 'notes.txt'), path.join(dir, 'link.txt'));
        const scan = scanFolder(dir);
        expect(scan.files.map((f) => f.rel)).toEqual(['a.PNG', 'x/y/c.jpeg']);
        expect(scan.skipped).toEqual([{ rel: 'link.png', reason: 'filtered', detail: 'symbolic link not followed' }]);
        expect(scan.ignored).toBe(2);
        fs.rmSync(dir, { recursive: true, force: true });
    });
    test('a path that is not a folder is a clear error', () => {
        expect(() => scanFolder('/definitely/not/here')).toThrow(ImportInputError);
        const dir = tempDir('scan2');
        const file = write(dir, 'a.png', makePng());
        expect(() => scanFolder(file)).toThrow(/Not a folder/);
        fs.rmSync(dir, { recursive: true, force: true });
    });
    test('runImport: missing folder or project fails before reading anything', async () => {
        const lines = [];
        const logger = { info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m), success: (m) => lines.push(m), debug: () => {} };
        expect((await runImport({ project: 'p' }, { logger })).exitCode).toBe(1);
        expect((await runImport({ folder: '/tmp' }, { logger })).exitCode).toBe(1);
        expect((await runImport({ folder: '/definitely/not/here', project: 'p' }, { logger })).exitCode).toBe(1);
        expect(lines.join('\n')).toMatch(/--project is required/);
        expect(lines.join('\n')).toMatch(/Not a folder/);
    });
});
