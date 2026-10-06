// Review finding (metadata-zip-100mb-limit, stage 4): the PUT of the metadata ZIP to the presigned
// URL had no timeout, so a stalled connection hung the deploy for ever (the "hung deploy" failure
// mode the retry logger already calls out) and the build stayed pending, never marked failed.
// A PUT that is never answered must time out, retry, then mark the build failed and exit 1.
const { runDeployerCli } = require('./helpers/runDeployerCli.js');

describe('regression-metadata-put-timeout', () => {
  test('a PUT that is never answered times out, marks the build failed, and exits 1', async () => {
    const r = await runDeployerCli({
      presign: 'ok',
      metadataPut: 'hang',
      env: { SCRY_UPLOAD_TIMEOUT_FLOOR_MS: '400', SCRY_UPLOAD_BACKOFF_MS: '50' },
    });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].buildId).toBe('stub-build');
    expect(r.requests.some((q) => q.path.endsWith('/metadata/complete'))).toBe(false);
    expect(r.out).toContain('NOTHING WILL BE INDEXED');
    expect(r.out).toContain('marked failed');
    expect(r.code).toBe(1);
  }, 90000);
});

// Review finding 2: against an upload service with no presign route there is no metadata/failed route
// either, so no warning is printed about marking the build failed; the red summary must not send the
// reader to "the warning above" (there is none), it must say the service has no way to mark it failed.
describe('regression-metadata-old-service-failure-message', () => {
  test('old service, old route rejects: the summary says the service cannot mark it failed, not "see the warning above"', async () => {
    const r = await runDeployerCli({ presign: 'none', metadata: 'reject', env: { SCRY_UPLOAD_TIMEOUT_FLOOR_MS: '5000', SCRY_UPLOAD_BACKOFF_MS: '50' } });
    expect(r.out).toContain('NOTHING WILL BE INDEXED');
    expect(r.out).toContain('has no way to mark it failed');
    expect(r.out).not.toContain('see the warning above');
    expect(r.code).toBe(1);
  }, 60000);
});
