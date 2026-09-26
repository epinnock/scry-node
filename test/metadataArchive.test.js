const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const { countMetadataEntries } = require('../lib/metadataArchive.js');

function writeZip(zipPath, entries, { store = false } = {}) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const a = archiver('zip', store ? { store: true } : { zlib: { level: 9 } });
    out.on('close', resolve);
    a.on('error', reject);
    a.pipe(out);
    for (const [name, body] of Object.entries(entries)) a.append(body, { name });
    a.finalize();
  });
}

describe('countMetadataEntries (ISSUES.md #50)', () => {
  let dir;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scry-meta-')); });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('counts entries in a deflated archive with screenshots', async () => {
    const p = path.join(dir, 'three.zip');
    await writeZip(p, {
      'images/a.png': Buffer.alloc(2048, 1),
      'metadata.json': JSON.stringify([{ storyId: 'a' }, { storyId: 'b' }, { storyId: 'c' }]),
      'images/b.png': Buffer.alloc(10, 2),
    });
    expect(countMetadataEntries(p)).toEqual({ count: 3, error: null });
  });

  test('counts entries in a stored (uncompressed) archive', async () => {
    const p = path.join(dir, 'stored.zip');
    await writeZip(p, { 'metadata.json': JSON.stringify([{ storyId: 'a' }]) }, { store: true });
    expect(countMetadataEntries(p)).toEqual({ count: 1, error: null });
  });

  test('an archive whose metadata.json is [] counts zero', async () => {
    const p = path.join(dir, 'empty.zip');
    await writeZip(p, { 'metadata.json': '[]' });
    expect(countMetadataEntries(p)).toEqual({ count: 0, error: null });
  });

  test('an archive with no metadata.json counts zero and says why', async () => {
    const p = path.join(dir, 'nometa.zip');
    await writeZip(p, { 'other.txt': 'x' });
    expect(countMetadataEntries(p)).toEqual({ count: 0, error: 'archive has no metadata.json' });
  });

  test('an unreadable archive is unknown (null), never zero, and says why', () => {
    const p = path.join(dir, 'junk.zip');
    fs.writeFileSync(p, 'not a zip at all');
    const r = countMetadataEntries(p);
    expect(r.count).toBeNull();
    expect(r.error).toMatch(/not a zip archive/);
    expect(countMetadataEntries(path.join(dir, 'missing.zip')).count).toBeNull();
  });

  test('metadata.json that is not a list is unknown', async () => {
    const p = path.join(dir, 'obj.zip');
    await writeZip(p, { 'metadata.json': '{"stories":[]}' });
    expect(countMetadataEntries(p)).toEqual({ count: null, error: 'metadata.json is not a list' });
  });
});

describe('runDeployment with an archive it cannot count', () => {
  afterEach(() => { jest.resetModules(); jest.restoreAllMocks(); });

  test('uploads it anyway and warns, rather than calling it empty', async () => {
    const zip = path.join(os.tmpdir(), `scry-junk-${process.pid}.zip`);
    fs.writeFileSync(zip, 'junk');
    const uploadBuild = jest.fn().mockResolvedValue({ zipUpload: { success: true }, metadataUpload: { success: true, queued: true } });
    jest.doMock('../lib/apiClient.js', () => ({ getApiClient: jest.fn(() => ({})), uploadBuild }));
    jest.doMock('../lib/archive.js', () => ({ zipDirectory: jest.fn(async (_d, out) => fs.writeFileSync(out, 'zip')) }));
    jest.doMock('../lib/pr-comment.js', () => ({ postPRComment: jest.fn(async () => {}) }));
    jest.doMock('../lib/coverage.js', () => ({
      runCoverageAnalysis: jest.fn(async () => ({ report: null, metadataZipPath: zip, sbcovFailure: null })),
      loadCoverageReport: jest.fn(),
      extractCoverageSummary: jest.fn(() => null),
    }));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const prev = process.exitCode;

    const { runDeployment } = require('../bin/cli.js');
    await runDeployment({ dir: './test-storybook-static', project: 'p', version: 'v', withAnalysis: true, coverage: true });

    expect(uploadBuild.mock.calls[0][2].metadataZipPath).toBe(zip);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/Could not count the stories in the analysis archive/);
    expect(process.exitCode).not.toBe(1);
    process.exitCode = prev;
  });
});
