/**
 * capture-sources guarantees for the CLI (plan table G6, G7; AT-17).
 *
 * guarantee-6: without --include-source no source text is ever packed, even when the input
 *   bundle carries some; with it, component source is packed and the CLI says so.
 * guarantee-7: the CLI's local validation is the vendored @scrymore/scf validator: every
 *   conformance fixture is accepted/rejected with exactly the fixture's expected codes, and a
 *   rejected bundle is never uploaded.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runUploadBundle } = require('../lib/uploadCommand.js');
const { validateBundle } = require('../lib/scf.js');
const { writeAnalysisBundle } = require('../lib/analysisBundle.js');
const { encodePng } = require('../lib/capture/png.js');

const FIXTURES = path.join(__dirname, 'fixtures', 'scf-conformance');
const UNZIP = path.join(__dirname, '..', 'lib', 'scf-unzip.mjs');

function recordingLogger() {
    const lines = [];
    const rec = (level) => (m) => lines.push(`${level}: ${m}`);
    return { lines, info: rec('info'), warn: rec('warn'), error: rec('error'), success: rec('success'), debug: () => {} };
}

function tmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'scry-g-test-'));
}

function unzipMembers(zipPath) {
    const out = tmp();
    const res = spawnSync(process.execPath, [UNZIP, zipPath, out], { encoding: 'utf8' });
    if (res.status !== 0) throw new Error(res.stderr);
    const members = [];
    const walk = (d, rel) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(path.join(d, e.name), r);
            else members.push(r);
        }
    };
    walk(out, '');
    return { dir: out, members: members.sort() };
}

/** An RN-shaped bundle whose captures point at a component file in a fake repo. */
function rnBundleWithRepo({ carrySourceText = false } = {}) {
    const repo = tmp();
    fs.mkdirSync(path.join(repo, 'src/components'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src/components/Button.tsx'), 'export function Button() { return null; }\n');
    const bundle = path.join(repo, '.scry', 'capture');
    fs.mkdirSync(path.join(bundle, 'images'), { recursive: true });
    const png = encodePng({ width: 2, height: 2, data: Buffer.alloc(16, 200) });
    fs.writeFileSync(path.join(bundle, 'images/0001.png'), png);
    fs.writeFileSync(path.join(bundle, 'images/0002.png'), png);
    const captures = [
        { id: 'components-button--primary', image: 'images/0001.png', code: { file: 'src/components/Button.stories.tsx', componentFile: 'src/components/Button.tsx' } },
        { id: 'components-button--secondary', image: 'images/0002.png', code: { file: 'src/components/Button.stories.tsx', componentFile: 'src/components/Button.tsx' } },
    ];
    const manifest = { scf: '1.0', source: { kind: 'storybook-rn', platform: 'ios' }, counts: { declared: 2, captured: 2, skipped: [] }, captures };
    if (carrySourceText) {
        fs.mkdirSync(path.join(bundle, 'source'), { recursive: true });
        fs.writeFileSync(path.join(bundle, 'source/old.src.txt'), 'stale source from another run\n');
        captures[0].sourceText = { file: 'source/old.src.txt' };
        manifest.optIn = { sourceText: true };
    }
    fs.writeFileSync(path.join(bundle, 'scf.json'), JSON.stringify(manifest));
    return { repo, bundle };
}

describe('guarantee-6 source text is packed only with --include-source (AT-17)', () => {
    test('guarantee-6 without --include-source: no source/ member, no sourceText, even when the input carried some', async () => {
        const { repo, bundle } = rnBundleWithRepo({ carrySourceText: true });
        const logger = recordingLogger();
        const res = await runUploadBundle({ path: bundle, repoRoot: repo, dryRun: true }, { logger });
        expect(res.exitCode).toBe(0);
        const { dir, members } = unzipMembers(res.prepared.zipPath);
        expect(members).toEqual(['images/0001.png', 'images/0002.png', 'scf.json']);
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'scf.json'), 'utf8'));
        expect(manifest.optIn).toBeUndefined();
        expect(manifest.captures.some((c) => c.sourceText)).toBe(false);
        expect(logger.lines.join('\n')).not.toMatch(/Uploading source text/);
        expect(logger.lines).toContain('info: Not uploading source text for 1 captures that carried it (pass --include-source to include it).');
    });

    test('guarantee-6 with --include-source: component source packed once, opt-in set, notice printed', async () => {
        const { repo, bundle } = rnBundleWithRepo();
        const logger = recordingLogger();
        const res = await runUploadBundle({ path: bundle, repoRoot: repo, includeSource: true, dryRun: true }, { logger });
        expect(res.exitCode).toBe(0);
        expect(logger.lines).toContain('info: Uploading source text for 1 components (--include-source)');
        const { dir, members } = unzipMembers(res.prepared.zipPath);
        expect(members).toEqual(['images/0001.png', 'images/0002.png', 'scf.json', 'source/src/components/Button.tsx.src.txt']);
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'scf.json'), 'utf8'));
        expect(manifest.optIn).toEqual({ sourceText: true });
        expect(manifest.captures.map((c) => c.sourceText)).toEqual([
            { file: 'source/src/components/Button.tsx.src.txt', path: 'src/components/Button.tsx' },
            { file: 'source/src/components/Button.tsx.src.txt', path: 'src/components/Button.tsx' },
        ]);
        expect(fs.readFileSync(path.join(dir, 'source/src/components/Button.tsx.src.txt'), 'utf8')).toContain('export function Button');
    });

    test('guarantee-6 --include-source never reads outside the repository root', async () => {
        const { repo, bundle } = rnBundleWithRepo();
        const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'scf.json'), 'utf8'));
        manifest.captures[0].code.componentFile = '../../../etc/passwd';
        fs.writeFileSync(path.join(bundle, 'scf.json'), JSON.stringify(manifest));
        const logger = recordingLogger();
        const res = await runUploadBundle({ path: bundle, repoRoot: repo, includeSource: true, dryRun: true }, { logger });
        expect(res.exitCode).toBe(0);
        const { members } = unzipMembers(res.prepared.zipPath);
        expect(members.filter((m) => m.startsWith('source/'))).toEqual(['source/src/components/Button.tsx.src.txt']);
        expect(logger.lines).toContain('warn: Source text not included for ../../../etc/passwd: outside the repository root.');
    });
});

describe('guarantee-7 the CLI validates exactly like the vendored validator', () => {
    const cases = [];
    for (const kind of ['valid', 'invalid']) {
        for (const name of fs.readdirSync(path.join(FIXTURES, kind))) {
            cases.push([kind, name]);
        }
    }

    test.each(cases)('guarantee-7 conformance fixture %s/%s', (kind, name) => {
        const base = path.join(FIXTURES, kind, name);
        const bundle = fs.existsSync(path.join(base, 'bundle')) ? path.join(base, 'bundle') : base;
        const result = validateBundle(bundle);
        if (kind === 'valid') {
            expect(result.errors).toEqual([]);
            expect(result.ok).toBe(true);
        } else {
            const expected = JSON.parse(fs.readFileSync(path.join(base, 'expected.json'), 'utf8'));
            expect(result.ok).toBe(false);
            expect([...new Set(result.errors.map((e) => e.code))].sort()).toEqual([...new Set(expected.errors)].sort());
        }
    });

    test('guarantee-7 a rejected bundle is never uploaded and every problem is printed', async () => {
        const uploadBundle = jest.fn();
        const logger = recordingLogger();
        const res = await runUploadBundle(
            { path: path.join(FIXTURES, 'invalid', 'forbidden-member', 'bundle'), project: 'p1', version: 'v1' },
            { logger, deps: { uploadBundle, getApiClient: () => ({}), resolveBuildGitContext: () => ({}) } }
        );
        expect(res.exitCode).toBe(1);
        expect(uploadBundle).not.toHaveBeenCalled();
        expect(logger.lines.some((l) => /error FORBIDDEN_MEMBER \[evil.html\]/.test(l))).toBe(true);
    });

    test('guarantee-7 a server-side 422 prints the service messages and exits 1', async () => {
        const logger = recordingLogger();
        const uploadBundle = jest.fn(async () => ({ success: false, status: 422, error: 'Bundle rejected', errors: [{ code: 'DUPLICATE_ID', id: 'a', message: 'Duplicate capture id (2×): a' }] }));
        const res = await runUploadBundle(
            { path: path.join(FIXTURES, 'valid', 'basic'), project: 'p1', version: 'v1' },
            { logger, deps: { uploadBundle, getApiClient: () => ({}), resolveBuildGitContext: () => ({}) } }
        );
        expect(res.exitCode).toBe(1);
        expect(uploadBundle).toHaveBeenCalledWith({}, { project: 'p1', version: 'v1' }, expect.stringMatching(/bundle\.zip$/), expect.objectContaining({ sourceKey: 'storybook:web' }));
        expect(logger.lines).toContain('error:   error DUPLICATE_ID [a]: Duplicate capture id (2×): a');
    });

    test('a valid bundle is uploaded with its source key and exits 0 once queued', async () => {
        const logger = recordingLogger();
        const uploadBundle = jest.fn(async () => ({ success: true, status: 200, queued: true, buildNumber: 7 }));
        const res = await runUploadBundle(
            { path: path.join(FIXTURES, 'valid', 'basic'), project: 'p1', version: 'v1' },
            { logger, deps: { uploadBundle, getApiClient: () => ({}), resolveBuildGitContext: () => ({ commitSha: 'abc' }) } }
        );
        expect(res.exitCode).toBe(0);
        expect(uploadBundle.mock.calls[0][3]).toMatchObject({ sourceKey: 'storybook:web', gitContext: { commitSha: 'abc' } });
    });

    test('--source that disagrees with scf.json is refused before upload', async () => {
        const uploadBundle = jest.fn();
        const res = await runUploadBundle(
            { path: path.join(FIXTURES, 'valid', 'basic'), project: 'p1', source: 'storybook-rn:android' },
            { logger: recordingLogger(), deps: { uploadBundle, getApiClient: () => ({}), resolveBuildGitContext: () => ({}) } }
        );
        expect(res.exitCode).toBe(1);
        expect(uploadBundle).not.toHaveBeenCalled();
    });
});

describe('scry analyze writes an SCF bundle (ledger F3)', () => {
    test('the analyze bundle is validator-clean and accounts for stories without a screenshot', () => {
        const repo = tmp();
        const shots = path.join(repo, '__screenshots__');
        fs.mkdirSync(shots, { recursive: true });
        fs.writeFileSync(path.join(shots, 'Primary.png'), encodePng({ width: 2, height: 2, data: Buffer.alloc(16, 9) }));
        const analysis = {
            stories: [
                { filepath: path.join(repo, 'src/Button.stories.tsx'), componentName: 'Button', storyTitle: 'Components/Button', testName: 'Primary', location: { startLine: 5, endLine: 9 }, screenshotPath: path.join(shots, 'Primary.png') },
                { filepath: path.join(repo, 'src/Button.stories.tsx'), componentName: 'Button', storyTitle: 'Components/Button', testName: 'PrimaryLong', location: { startLine: 11, endLine: 14 }, screenshotPath: null },
            ],
        };
        const out = path.join(tmp(), 'bundle');
        const { manifest } = writeAnalysisBundle(analysis, out, { toolVersion: '1.2.3', repoRoot: repo });
        const result = validateBundle(out);
        expect(result.errors).toEqual([]);
        expect(manifest.source).toMatchObject({ kind: 'storybook', platform: 'web' });
        expect(manifest.captures[0]).toMatchObject({ id: 'components-button--primary', code: { file: 'src/Button.stories.tsx', line: 5, component: 'Button' } });
        expect(manifest.counts).toEqual({ declared: 2, captured: 1, skipped: [{ id: 'components-button--primary-long', reason: 'error', detail: 'no screenshot matched this story' }] });
    });
});
