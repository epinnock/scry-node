// regression-metadata-zip-100mb-limit (scry-management/features/metadata-zip-100mb-limit,
// ISSUES.md #74, plan.md Fix 1).
//
// On 2026-10-06 the dashboard's metadata ZIP reached 101.5 MiB. The deployer
// POSTed it through the upload Worker with maxContentLength/maxBodyLength of
// 100 MiB, so axios refused it before sending a byte, the job ended red
// (NOTHING WILL BE INDEXED), and the build stayed "pending" forever.
//
// Target behaviour: the ZIP goes presign -> PUT straight to storage -> complete,
// so no ZIP bytes pass through the Worker and no size cap applies at 100 MiB.
// A failed PUT or complete marks the build failed and exits non-zero. Against
// an upload service without the presign route the old route is used up to
// 100 MiB, and above that the deploy stops saying the service is too old.
//
// Driven through the real CLI against the local stub upload service.
const { runDeployerCli } = require('./helpers/runDeployerCli.js');

const MiB = 1024 * 1024;
const FAST = { SCRY_UPLOAD_TIMEOUT_FLOOR_MS: '5000', SCRY_UPLOAD_BACKOFF_MS: '50' };
const metaReqs = (r) => r.requests.filter((q) => /\/metadata(\/|$)/.test(q.path) || q.path.startsWith('/put-meta/'));
const put = (r) => r.requests.filter((q) => q.method === 'PUT' && q.path.startsWith('/put-meta/'));
const viaWorker = (r) => r.requests.filter((q) => q.path.startsWith('/upload/'));

describe('regression-metadata-zip-100mb-limit', () => {
  test.each([101, 200])('a %i MiB metadata ZIP goes presign, PUT, complete; no ZIP bytes pass the Worker; exit 0', async (mib) => {
    const r = await runDeployerCli({ presign: 'ok', env: { ...FAST, FAKE_SBCOV_PAD_BYTES: String(mib * MiB) } });
    const puts = put(r);
    expect(puts).toHaveLength(1);
    expect(puts[0].bytes).toBeGreaterThan(mib * MiB);
    // Everything that went to the Worker is small JSON (G1).
    for (const q of viaWorker(r)) expect(q.bytes).toBeLessThan(MiB);
    const order = metaReqs(r).map((q) => q.path.split('/').pop());
    expect(order).toEqual(['presign', 'metadata-screenshots.zip', 'complete']);
    expect(r.out).toContain('Indexing has been queued');
    expect(r.out).not.toContain('NOTHING WILL BE INDEXED');
    expect(r.code).toBe(0);
  }, 300000);

  test('complete carries the commit and branch, like the old route did (G5)', async () => {
    const r = await runDeployerCli({ presign: 'ok', env: { ...FAST, SCRY_COMMIT_SHA: 'abc1234', SCRY_BRANCH: 'feat/x' } });
    const complete = r.requests.find((q) => q.path.endsWith('/metadata/complete'));
    expect(complete.query).toContain('commitSha=abc1234');
    expect(complete.query).toContain('branch=feat%2Fx');
    expect(complete.json).toEqual({ buildId: 'stub-build', zipKey: 'fixture/main/builds/1/metadata-screenshots.zip' });
    expect(r.code).toBe(0);
  }, 60000);

  test('a rejected PUT marks the build failed, says so, and exits 1', async () => {
    const r = await runDeployerCli({ presign: 'ok', metadataPut: 'reject403', env: FAST });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].buildId).toBe('stub-build');
    expect(r.failed[0].reason).toMatch(/PUT|upload|403/i);
    expect(r.requests.some((q) => q.path.endsWith('/metadata/complete'))).toBe(false);
    expect(r.out).toContain('NOTHING WILL BE INDEXED');
    expect(r.out).toContain('marked failed');
    expect(r.out).not.toContain('is left pending');
    expect(r.out).not.toContain('Indexing has been queued');
    expect(r.code).toBe(1);
  }, 60000);

  test('a rejected complete marks the build failed, says so, and exits 1', async () => {
    const r = await runDeployerCli({ presign: 'ok', metadataComplete: 'reject400', env: FAST });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].buildId).toBe('stub-build');
    expect(r.failed[0].reason).toContain('metadata zip not found (stub)');
    expect(r.out).toContain('NOTHING WILL BE INDEXED');
    expect(r.out).toContain('marked failed');
    expect(r.code).toBe(1);
  }, 60000);

  test('an upload service without the presign route: the old route up to 100 MiB, and the log says so', async () => {
    const r = await runDeployerCli({ presign: 'none', env: FAST });
    const old = r.requests.filter((q) => q.method === 'POST' && /\/metadata$/.test(q.path));
    expect(old).toHaveLength(1);
    expect(old[0].bytes).toBeGreaterThan(0);
    expect(put(r)).toHaveLength(0);
    expect(r.out).toMatch(/no presigned metadata upload.*old route/is);
    expect(r.out).toContain('Indexing has been queued');
    expect(r.code).toBe(0);
  }, 60000);

  test('an upload service without the presign route and a ZIP over 100 MiB: stops, says the service is too old, exits 1', async () => {
    const r = await runDeployerCli({ presign: 'none', env: { ...FAST, FAKE_SBCOV_PAD_BYTES: String(101 * MiB) } });
    expect(r.requests.filter((q) => q.method === 'POST' && /\/metadata$/.test(q.path))).toHaveLength(0);
    expect(r.out).toContain('upload service too old for a ZIP this size');
    expect(r.out).toContain('NOTHING WILL BE INDEXED');
    expect(r.code).toBe(1);
  }, 120000);
});

// No silent paths: each fallback or swallowed failure is logged at warn or above.
describe('metadata upload failure paths are never silent', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { uploadMetadataZip } = require('../lib/apiClient.js');
  const httpError = (status, error) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { error } } });
  const mkLog = () => ({ info: jest.fn(), success: jest.fn(), warn: jest.fn(), error: jest.fn() });
  let zip;
  beforeAll(() => { zip = path.join(os.tmpdir(), `mz100-small-${process.pid}.zip`); fs.writeFileSync(zip, Buffer.from('zip')); });
  afterAll(() => fs.rmSync(zip, { force: true }));
  beforeEach(() => { process.env.SCRY_UPLOAD_BACKOFF_MS = '1'; });
  afterEach(() => { delete process.env.SCRY_UPLOAD_BACKOFF_MS; });

  test('presign refused (400): no fallback to the old route, the known build is marked failed', async () => {
    const post = jest.fn(async (url) => {
      if (url.endsWith('/presign')) throw httpError(400, 'Upload storybook.zip first');
      return { status: 200, data: { success: true } };
    });
    const log = mkLog();
    const res = await uploadMetadataZip({ defaults: { baseURL: 'https://u' }, post }, { project: 'p', version: 'v' }, zip, log, {}, { buildId: 'known-build' });
    expect(res.success).toBe(false);
    expect(res.markedFailed).toBe(true);
    expect(res.error).toContain('Upload storybook.zip first');
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/upload/p/v/metadata/presign', '/upload/p/v/metadata/failed']);
    expect(post.mock.calls[1][1]).toEqual({ buildId: 'known-build', reason: expect.stringContaining('Upload storybook.zip first') });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Metadata ZIP upload failed'));
  });

  test('presign refused and no build id is known: says the build cannot be marked failed', async () => {
    const post = jest.fn(async () => { throw httpError(403, 'forbidden'); });
    const log = mkLog();
    const res = await uploadMetadataZip({ defaults: { baseURL: 'https://u' }, post }, { project: 'p', version: 'v' }, zip, log);
    expect(res.success).toBe(false);
    expect(res.markedFailed).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('could not be marked failed'));
  });

  test('metadata/failed itself fails: a warning says the build stays pending, the upload still reports failure', async () => {
    const post = jest.fn(async (url) => {
      if (url.endsWith('/presign')) throw httpError(403, 'forbidden');
      throw httpError(404, 'not found');
    });
    const log = mkLog();
    const res = await uploadMetadataZip({ defaults: { baseURL: 'https://u' }, post }, { project: 'p', version: 'v' }, zip, log, {}, { buildId: 'b1' });
    expect(res.success).toBe(false);
    expect(res.markedFailed).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/could not be marked failed.*build b1 stays pending/));
  });

  test('a missing ZIP file ends red and says so', async () => {
    const post = jest.fn(async () => ({ status: 200, data: {} }));
    const log = mkLog();
    const res = await uploadMetadataZip({ defaults: { baseURL: 'https://u' }, post }, { project: 'p', version: 'v' }, path.join(os.tmpdir(), 'mz100-does-not-exist.zip'), log);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/reading the ZIP failed/);
    expect(log.error).toHaveBeenCalled();
  });
});
