const {
  isTransientUploadError,
  withUploadRetry,
  UPLOAD_MAX_ATTEMPTS,
} = require('../lib/apiClient.js');

/**
 * ISSUES.md #19. The upload is the last step of a deploy, so a one-second blip
 * used to discard the ~156s of screenshot capture that had already succeeded.
 * Six consecutive real deploys failed this way on 2026-08-06, every one a
 * single-shot network error.
 */
describe('isTransientUploadError', () => {
  it.each(['EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'])(
    'treats %s as worth retrying',
    (code) => {
      expect(isTransientUploadError(Object.assign(new Error('net'), { code }))).toBe(true);
    }
  );

  it.each([500, 502, 503, 429])('treats HTTP %i as worth retrying', (status) => {
    expect(isTransientUploadError({ response: { status } })).toBe(true);
  });

  // A malformed or unauthorised request fails identically on every attempt;
  // retrying only delays the error the user needs to see.
  it.each([400, 401, 403, 404])('treats HTTP %i as terminal', (status) => {
    expect(isTransientUploadError({ response: { status } })).toBe(false);
  });

  it('does not retry an unrecognised failure', () => {
    expect(isTransientUploadError(new TypeError('bad argument'))).toBe(false);
  });

  // An HTTP response takes precedence over any code on the error object —
  // axios sets both, and the status is the more specific signal.
  it('prefers the HTTP status over the error code', () => {
    const err = Object.assign(new Error('boom'), {
      code: 'ECONNRESET',
      response: { status: 403 },
    });
    expect(isTransientUploadError(err)).toBe(false);
  });
});

describe('withUploadRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Runs fn to completion while auto-advancing the backoff timers. */
  async function runWithTimers(fn) {
    const promise = fn();
    const settled = promise.then(
      (v) => ({ ok: true, v }),
      (e) => ({ ok: false, e })
    );
    // Each pass releases one pending backoff.
    for (let i = 0; i < UPLOAD_MAX_ATTEMPTS + 1; i++) {
      await Promise.resolve();
      jest.runOnlyPendingTimers();
    }
    return settled;
  }

  it('returns the value without retrying when the first attempt works', async () => {
    const attempt = jest.fn().mockResolvedValue('done');
    const result = await runWithTimers(() => withUploadRetry(attempt, 'Upload'));

    expect(result).toEqual({ ok: true, v: 'done' });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('recovers when a transient failure is followed by success', async () => {
    const attempt = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('dns'), { code: 'EAI_AGAIN' }))
      .mockResolvedValue('done');

    const result = await runWithTimers(() => withUploadRetry(attempt, 'Upload'));

    expect(result).toEqual({ ok: true, v: 'done' });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  // The whole point of re-running the closure rather than just the PUT: the
  // presigned URL is signed at request time and would be stale after a backoff.
  it('re-runs the entire attempt so the presigned URL is refreshed', async () => {
    const urls = [];
    const attempt = jest.fn(async (n) => {
      urls.push(`signed-url-${n}`);
      if (n < 3) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      return 'done';
    });

    await runWithTimers(() => withUploadRetry(attempt, 'Upload'));

    expect(urls).toEqual(['signed-url-1', 'signed-url-2', 'signed-url-3']);
  });

  it('gives up after the attempt cap and surfaces the last error', async () => {
    const attempt = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('dns'), { code: 'EAI_AGAIN' }));

    const result = await runWithTimers(() => withUploadRetry(attempt, 'Upload'));

    expect(result.ok).toBe(false);
    expect(result.e.code).toBe('EAI_AGAIN');
    expect(attempt).toHaveBeenCalledTimes(UPLOAD_MAX_ATTEMPTS);
  });

  it('fails immediately on a terminal error rather than burning attempts', async () => {
    const attempt = jest.fn().mockRejectedValue({ response: { status: 401 } });

    const result = await runWithTimers(() => withUploadRetry(attempt, 'Upload'));

    expect(result.ok).toBe(false);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
