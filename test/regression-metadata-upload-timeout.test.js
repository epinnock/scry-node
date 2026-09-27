// regression-metadata-upload-timeout (storybook-preview-ci-runtime RCA 2,
// scry-management/features/storybook-preview-ci-runtime/rca-metadata-upload.md).
//
// After sbcov 0.7 (root crop at 2x) the dashboard's metadata ZIP grew to 28 MB.
// The deployer POSTed it through the upload Worker with a fixed 60 s timeout
// and no retry; the self-hosted runner uploads at 0.41-0.85 MB/s, so both runs
// on 0.9.0 ended "timeout of 60000ms exceeded" -> NOTHING WILL BE INDEXED, and
// the log still printed "Archive uploaded" and "Upload complete" around it.
//
// Driven through the real CLI against the local stub upload service.
const { runDeployerCli } = require('./helpers/runDeployerCli.js');

const MB = 1024 * 1024;
const metadataPosts = (r) => r.requests.filter((q) => q.method === 'POST' && /\/metadata$/.test(q.path));

describe('regression-metadata-upload-timeout', () => {
  // The symptom, at real sizes and the real default timeout: 28 MB over a
  // ~400 KB/s link takes ~70 s, past the old fixed 60 s.
  test('a 28 MB metadata ZIP over a 400 KB/s link is uploaded and queued', async () => {
    const r = await runDeployerCli({
      metadataRate: 400 * 1024,
      env: { FAKE_SBCOV_PAD_BYTES: String(28 * MB) },
    });
    const posts = metadataPosts(r);
    expect(posts.length).toBeGreaterThanOrEqual(1);
    expect(posts[posts.length - 1].bytes).toBeGreaterThan(28 * MB);
    expect(r.out).not.toContain('timeout of 60000ms exceeded');
    expect(r.out).toContain('Indexing has been queued');
    expect(r.code).toBe(0);
  }, 240000);
});

describe('metadata / coverage upload: timeout, retry, and what the log says', () => {
  // Small bodies with a 1 s floor so the timeout paths run in seconds.
  const FAST = { SCRY_UPLOAD_TIMEOUT_FLOOR_MS: '1000', SCRY_UPLOAD_BACKOFF_MS: '100' };

  test('a timed-out metadata upload is retried and then succeeds; each attempt is logged with size and time', async () => {
    const r = await runDeployerCli({ metadata: 'hang-once', env: FAST });
    expect(metadataPosts(r)).toHaveLength(2);
    expect(r.out).toMatch(/Metadata ZIP: attempt 1\/3 \([\d.]+ (KB|MB|B)\) failed after [\d.]+ s \(timeout[^)]*\); retrying in 0\.1 s/);
    expect(r.out).toMatch(/Metadata ZIP: sent [\d.]+ (KB|MB|B) in [\d.]+ s \(attempt 2\/3\)/);
    expect(r.out).toContain('Indexing has been queued');
    expect(r.code).toBe(0);
  }, 60000);

  test('a metadata upload that fails every attempt prints no success line, says the build is left pending, exits 1', async () => {
    const r = await runDeployerCli({ metadata: 'hang', env: FAST });
    expect(metadataPosts(r)).toHaveLength(3);
    expect(r.out).toContain('Metadata ZIP: attempt 3/3');
    expect(r.out).toContain('NOTHING WILL BE INDEXED');
    expect(r.out).toContain('Build stub-build (#1) is left pending');
    const failedAt = r.out.indexOf('Metadata ZIP upload failed');
    expect(failedAt).toBeGreaterThan(-1);
    const after = r.out.slice(failedAt);
    expect(after).not.toContain('Archive uploaded');
    expect(after).not.toContain('Upload complete');
    expect(r.out).not.toContain('✅ Archive uploaded');
    expect(r.out).not.toContain('✅ Upload complete');
    expect(r.code).toBe(1);
  }, 60000);

  test('a 4xx from the metadata route is not retried', async () => {
    const r = await runDeployerCli({ metadata: 'reject400', env: FAST });
    expect(metadataPosts(r)).toHaveLength(1);
    expect(r.out).toContain('Metadata ZIP upload failed: Empty body (stub)');
    expect(r.out).not.toContain('retrying');
    expect(r.code).toBe(1);
  }, 60000);

  test('a 5xx from the metadata route is retried, then ends red', async () => {
    const r = await runDeployerCli({ metadata: 'reject', env: FAST });
    expect(metadataPosts(r)).toHaveLength(3);
    expect(r.code).toBe(1);
  }, 60000);
});

describe('uploadTimeoutMs', () => {
  const { uploadTimeoutMs } = require('../lib/apiClient.js');
  test('max(60 s, bytes / 100 KB/s), capped at 15 min', () => {
    expect(uploadTimeoutMs(1000, {})).toBe(60000);
    expect(uploadTimeoutMs(28 * MB, {})).toBe(Math.ceil((28 * MB) / (100 * 1024) * 1000));
    expect(uploadTimeoutMs(28 * MB, {})).toBeGreaterThan(280000);
    expect(uploadTimeoutMs(500 * MB, {})).toBe(15 * 60 * 1000);
  });
});

describe('coverage JSON upload', () => {
  const http = require('http');
  const { getApiClient, uploadCoverageReportDirectly } = require('../lib/apiClient.js');

  async function withServer(handler, fn) {
    const server = http.createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      return await fn(`http://127.0.0.1:${server.address().port}`);
    } finally {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
  }

  test('a timed-out coverage upload is retried; a 4xx is not', async () => {
    const prev = { ...process.env };
    process.env.SCRY_UPLOAD_TIMEOUT_FLOOR_MS = '500';
    process.env.SCRY_UPLOAD_BACKOFF_MS = '50';
    try {
      let calls = 0;
      await withServer((req, res) => {
        req.resume();
        req.on('end', () => {
          calls += 1;
          if (calls === 1) return; // hang: client times out
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, buildId: 'b' }));
        });
      }, async (url) => {
        const res = await uploadCoverageReportDirectly(getApiClient(url, 'k'), { project: 'p', version: 'v' }, { a: 1 });
        expect(res.success).toBe(true);
      });
      expect(calls).toBe(2);

      calls = 0;
      await withServer((req, res) => {
        req.resume();
        req.on('end', () => {
          calls += 1;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'too large' }));
        });
      }, async (url) => {
        await expect(uploadCoverageReportDirectly(getApiClient(url, 'k'), { project: 'p', version: 'v' }, { a: 1 })).rejects.toThrow(/413/);
      });
      expect(calls).toBe(1);
    } finally {
      process.env = prev;
    }
  }, 30000);
});
