/**
 * adobe-bride-investigation, PR2: `scry import <folder>`.
 * guarantee-3 (only the folder given is read), guarantee-4 (client side: file text is data and is
 * never logged), guarantee-5 (no location or device identifiers, no paths, are uploaded), plus
 * the fixture folder end to end against a local fake of the upload route.
 */
const fs = require('fs');
const path = require('path');
const { runImport } = require('../lib/importCommand.js');
const { convertFile } = require('../lib/importConvert.js');
const {
    CANARY, makePng, makeJpeg, makeWebp, xmpPacket, tempDir, write, startFakeUploadService,
} = require('./helpers/importFixtures.js');

function recorder() {
    const lines = [];
    const push = (level) => (m) => lines.push(`${level}: ${m}`);
    return {
        lines,
        logger: { info: push('info'), warn: push('warn'), error: push('error'), success: push('success'), debug: push('debug') },
        print: (m) => lines.push(`print: ${m}`),
    };
}

/** A fake ImageMagick: answers -version, and writes a PNG that still carries a tEXt canary. */
function fakeMagick(calls) {
    return (file, args) => {
        calls.push({ file, args });
        if (args.includes('-version')) return { status: 0 };
        const out = args.find((a) => /^(png|jpeg):/.test(a));
        fs.writeFileSync(out.replace(/^(png|jpeg):/, ''), makePng(6, 5, { text: [`Comment\0${CANARY.gps} ${CANARY.serial}`] }));
        return { status: 0 };
    };
}

describe('scry import', () => {
    let svc;
    let work;
    let spies;
    const consoleLines = [];

    beforeEach(async () => {
        svc = await startFakeUploadService();
        work = tempDir('folder');
        consoleLines.length = 0;
        spies = ['log', 'warn', 'error', 'info'].map((m) => jest.spyOn(console, m).mockImplementation((...a) => consoleLines.push(a.join(' '))));
    });
    afterEach(async () => {
        spies.forEach((s) => s.mockRestore());
        await svc.close();
        fs.rmSync(work, { recursive: true, force: true });
    });

    const argvFor = (folder, extra = {}) => ({ folder, project: 'p1', version: 'v1', apiUrl: svc.url, apiKey: 'k', yes: true, ...extra });

    test('a fixture folder goes end to end: convert, XMP allow-list, SCF bundle, upload, honest counts', async () => {
        const folder = path.join(work, 'export');
        write(folder, 'kitchen.jpg', makeJpeg(8, 6, { xmp: xmpPacket({ title: 'Warm kitchen', description: 'Wood tones', keywords: ['kitchen', 'warm & wood'], rating: 4, label: 'Red' }) }));
        write(folder, 'sub/teapot.png', makePng(4, 4, { xmp: xmpPacket({ keywords: ['teapot'], form: 'attribute', rating: 2, label: 'Blue', title: 'Teapot' }) }));
        write(folder, 'sub/wave.webp', makeWebp(5, 3));
        write(folder, 'poster.psd', Buffer.from('8BPS fake psd bytes'));
        write(folder, 'poster.xmp', Buffer.from(xmpPacket({ keywords: ['poster', 'print'], rating: 5 })));
        write(folder, 'scan.tif', Buffer.from('II*\0 fake tiff'));
        write(folder, 'logo.ai', Buffer.from('%PDF-1.5 fake ai'));
        write(folder, 'copy-of-kitchen.jpg', fs.readFileSync(path.join(folder, 'kitchen.jpg')));
        write(folder, 'broken.png', Buffer.from('not a png'));
        write(folder, 'notes.txt', 'ignored');
        const calls = [];
        const rec = recorder();
        const tools = ['magick'];
        const convert = (abs, ext, o) => (ext === '.ai'
            ? Promise.resolve({ ok: false, reason: 'unsupported', detail: 'no converter for .ai on this machine' })
            : convertFile(abs, ext, { ...o, tools, run: fakeMagick(calls) }));

        const out = await runImport(argvFor(folder), { ...rec, deps: { convert, tools } });

        expect(out.exitCode).toBe(0);
        const bundle = svc.state.received[0];
        expect(bundle.manifest.source).toMatchObject({ kind: 'x-adobe-bridge', platform: 'other' });
        expect(bundle.manifest.captures.every((c) => c.kind === 'doc-image' && /^sha256-[0-9a-f]{64}$/.test(c.id))).toBe(true);
        // 5 pictures captured (jpg, png, webp, psd, tif); 3 skipped (duplicate, .ai, broken png); .txt ignored.
        expect(bundle.manifest.counts).toMatchObject({ declared: 8, captured: 5 });
        expect(bundle.manifest.counts.skipped.map((s) => s.reason).sort()).toEqual(['error', 'filtered', 'unsupported']);
        const kitchen = bundle.manifest.captures.find((c) => c['x-adobe-bridge']?.title === 'Warm kitchen');
        expect(kitchen.tags).toEqual(['kitchen', 'warm & wood']);
        expect(kitchen['x-adobe-bridge']).toEqual({ title: 'Warm kitchen', description: 'Wood tones', keywords: ['kitchen', 'warm & wood'], rating: 4, label: 'Red' });
        const poster = bundle.manifest.captures.find((c) => (c.tags || []).includes('poster'));
        expect(poster['x-adobe-bridge']).toEqual({ keywords: ['poster', 'print'], rating: 5 });
        expect(svc.state.requests[0].headers['x-scry-client']).toMatch(/^scry-deployer\//);
        expect(rec.lines.join('\n')).toMatch(/sent to Google Gemini and Jina/);
        // the converter ran with an explicit coder prefix and no shell string
        const psdCall = calls.find((c) => c.args.some((a) => a.startsWith('psd:')));
        expect(psdCall.file).toBe('magick');
        expect(psdCall.args).toEqual(expect.arrayContaining(['-strip']));
    });

    test('guarantee-3 only the folder given is read: symlinked files, folders and sidecars are never followed', async () => {
        const outside = tempDir('outside');
        const secretPng = write(outside, 'secret.png', makePng(4, 4, { shade: 77 }));
        write(outside, 'inner/deep.png', makePng(4, 4, { shade: 99 }));
        const secretXmp = write(outside, 'keys.xmp', Buffer.from(xmpPacket({ keywords: [CANARY.outsideKeyword] })));
        const folder = path.join(work, 'export');
        write(folder, 'ok.png', makePng(4, 4, { shade: 10 }));
        write(folder, 'plain.png', makePng(4, 4, { shade: 20 }));
        fs.symlinkSync(secretPng, path.join(folder, 'escape.png'));
        fs.symlinkSync(path.join(outside, 'inner'), path.join(folder, 'linked-dir'));
        fs.symlinkSync('../' + path.basename(outside) + '/secret.png', path.join(folder, 'dotdot.png'));
        fs.symlinkSync(secretXmp, path.join(folder, 'plain.xmp'));
        const outsideReads = [];
        const realRead = fs.readFileSync;
        const realOpen = fs.openSync;
        const note = (p) => { if (typeof p === 'string' && p.startsWith(outside)) outsideReads.push(p); };
        const rs = jest.spyOn(fs, 'readFileSync').mockImplementation((p, ...a) => { note(p); return realRead(p, ...a); });
        const os = jest.spyOn(fs, 'openSync').mockImplementation((p, ...a) => { note(p); return realOpen(p, ...a); });
        const rec = recorder();

        const out = await runImport(argvFor(folder), { ...rec, deps: { tools: [] } });
        rs.mockRestore();
        os.mockRestore();

        expect(out.exitCode).toBe(0);
        expect(outsideReads).toEqual([]);
        const bundle = svc.state.received[0];
        expect(bundle.manifest.counts.captured).toBe(2); // ok.png and plain.png only
        const allBytes = Buffer.concat(Object.values(bundle.files)).toString('latin1');
        expect(allBytes).not.toContain(CANARY.outsideKeyword);
        expect(bundle.manifest.captures.flatMap((c) => c.tags || [])).toEqual([]);
        const skipped = bundle.manifest.counts.skipped;
        expect(skipped).toHaveLength(3); // escape.png, linked-dir, dotdot.png
        expect(skipped.every((s) => s.detail === 'symbolic link not followed')).toBe(true);
        expect(rec.lines.join('\n')).toMatch(/skipped escape\.png: symbolic link not followed/);
        expect(rec.lines.join('\n')).toMatch(/1 sidecar \.xmp file not read/);
        fs.rmSync(outside, { recursive: true, force: true });
    });

    test('guarantee-3 an empty or unsupported-only folder uploads nothing and says why', async () => {
        const folder = path.join(work, 'empty');
        write(folder, 'readme.txt', 'x');
        const rec = recorder();
        const out = await runImport(argvFor(folder), { ...rec, deps: { tools: [] } });
        expect(out.exitCode).toBe(1);
        expect(svc.state.requests).toHaveLength(0);
        expect(rec.lines.join('\n')).toMatch(/No supported images found/);
    });

    test('guarantee-5 no GPS, camera serial or path reaches the bundle: not in scf.json, not in any image', async () => {
        const folder = path.join(work, 'FOLDER-NAME-CANARY');
        const xmp = xmpPacket({ title: 'Teapot', keywords: ['blue', 'ceramic'], rating: 3 });
        write(folder, 'a.jpg', makeJpeg(8, 6, { xmp, shade: 1 }));
        write(folder, 'b.png', makePng(4, 4, { xmp, text: [`Location\0${CANARY.gps}`, `Serial\0${CANARY.serial}`, `Source\0${CANARY.path}`], shade: 2 }));
        write(folder, 'c.webp', makeWebp(5, 3));
        write(folder, 'd.psd', Buffer.from(`8BPS ${CANARY.gps} ${CANARY.serial}`));
        write(folder, 'd.xmp', Buffer.from(xmpPacket({ keywords: ['psd'] })));
        const tools = ['magick'];
        const convert = (abs, ext, o) => convertFile(abs, ext, { ...o, tools, run: fakeMagick([]) });
        const rec = recorder();

        const out = await runImport(argvFor(folder), { ...rec, deps: { convert, tools } });

        expect(out.exitCode).toBe(0);
        const bundle = svc.state.received[0];
        expect(bundle.manifest.counts.captured).toBe(4);
        for (const [name, bytes] of Object.entries(bundle.files)) {
            const text = bytes.toString('latin1');
            for (const secret of [CANARY.gps, CANARY.serial, CANARY.path, 'IPTC-CANARY', 'comment-canary', 'Some Person', work]) {
                expect([name, text.includes(secret)]).toEqual([name, false]);
            }
        }
        // only the five allow-listed keys, and no file names or paths anywhere in the manifest
        const allowed = new Set(['title', 'description', 'keywords', 'rating', 'label']);
        for (const c of bundle.manifest.captures) {
            expect(Object.keys(c['x-adobe-bridge'] || {}).every((k) => allowed.has(k))).toBe(true);
            expect(c.image).toMatch(/^images\/[0-9a-f]{64}\.(jpg|png|webp)$/);
        }
        const manifestText = JSON.stringify(bundle.manifest);
        for (const word of ['a.jpg', 'b.png', 'c.webp', 'd.psd', 'FOLDER-NAME-CANARY']) expect(manifestText).not.toContain(word);
        expect(rec.lines.concat(consoleLines).join('\n')).not.toContain(CANARY.gps);
    });

    test('guarantee-4 text inside a file is data: capped, stripped of markup, never logged or printed', async () => {
        const folder = path.join(work, 'export');
        const evil = `${CANARY.injection} &lt;script&gt;alert(1)&lt;/script&gt; &amp;lt;b&amp;gt;bold ${'x'.repeat(5000)}`;
        write(folder, 'a.png', makePng(4, 4, { xmp: xmpPacket({ title: `&lt;img src=x onerror=alert(1)&gt;${CANARY.injection}`, description: evil, keywords: [`${CANARY.injection} &lt;b&gt;k&lt;/b&gt;`, 'k'.repeat(500)], label: 'L'.repeat(100), rating: 5 }) }));
        const rec = recorder();

        const out = await runImport(argvFor(folder), { ...rec, deps: { tools: [] } });

        expect(out.exitCode).toBe(0);
        const meta = svc.state.received[0].manifest.captures[0]['x-adobe-bridge'];
        expect(meta.description.length).toBeLessThanOrEqual(2000);
        expect(meta.description).toContain(CANARY.injection); // kept as inert text, not obeyed or removed
        for (const value of [meta.title, meta.description, ...meta.keywords, meta.label]) {
            expect(value).not.toMatch(/[<>]/);
        }
        expect(meta.title).not.toContain('onerror=alert(1)>');
        expect(meta.keywords.every((k) => k.length <= 64)).toBe(true);
        expect(meta.label.length).toBeLessThanOrEqual(32);
        const everything = rec.lines.concat(consoleLines).join('\n');
        expect(everything).not.toContain('ignore previous instructions');
        expect(everything).not.toContain('onerror');
    });

    test('a non-interactive run without --yes sends nothing and says how to confirm', async () => {
        const folder = path.join(work, 'export');
        write(folder, 'a.png', makePng());
        const rec = recorder();
        const out = await runImport(argvFor(folder, { yes: false }), { ...rec, deps: { tools: [], isInteractive: () => false } });
        expect(out.exitCode).toBe(1);
        expect(svc.state.requests).toHaveLength(0);
        expect(rec.lines.join('\n')).toMatch(/Re-run with --yes/);
    });

    test('an interactive "no" sends nothing; an interactive "yes" uploads', async () => {
        const folder = path.join(work, 'export');
        write(folder, 'a.png', makePng());
        const asked = [];
        const no = await runImport(argvFor(folder, { yes: false }), { ...recorder(), deps: { tools: [], isInteractive: () => true, confirm: async (q) => { asked.push(q); return false; } } });
        expect(no.exitCode).toBe(1);
        expect(svc.state.requests).toHaveLength(0);
        expect(asked[0]).toMatch(/Send 1 image for AI processing/);
        const yes = await runImport(argvFor(folder, { yes: false }), { ...recorder(), deps: { tools: [], isInteractive: () => true, confirm: async () => true } });
        expect(yes.exitCode).toBe(0);
        expect(svc.state.received).toHaveLength(1);
    });

    test('--dry-run builds and validates the bundle and sends nothing, without needing --yes or --project', async () => {
        const folder = path.join(work, 'export');
        write(folder, 'a.png', makePng());
        const out = await runImport({ folder, dryRun: true, apiUrl: svc.url }, { ...recorder(), deps: { tools: [] } });
        expect(out.exitCode).toBe(0);
        expect(svc.state.requests).toHaveLength(0);
    });
});
