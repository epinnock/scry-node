/**
 * log-standardization PR 6 (scry-node): the CLI reads x-scry-request-id, shows
 * it as "Ref: <id>", sends x-scry-client, never prints a server error body, and
 * never falls back to Sentry environment "production".
 */
const { sentText, sentEvents } = require('./fixtures/sentry-capture-transport');
const axios = require('axios');
const { version } = require('../package.json');
const { ApiError } = require('../lib/errors.js');
const { getApiClient, uploadFileDirectly, getRequestId } = require('../lib/apiClient.js');
const { initTelemetry, captureCliError, flushTelemetry } = require('../lib/telemetry.js');

process.env.SCRY_UPLOAD_BACKOFF_MS = '0';
const REF = '01J8ZQ4M7N2X5V9K3T6R1B0CDE';
const BODY_CANARY = 'canary-body-alice@example.com-sk-abcdefghijklmnop';

function axiosError(status, data, headers) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, statusText: 'Bad Request', data, headers: headers || {} };
  return err;
}

describe('x-scry-client header', () => {
  test('every API call carries scry-deployer/<version>', () => {
    const client = getApiClient('https://api.example.test', 'k');
    expect(client.defaults.headers['x-scry-client']).toBe(`scry-deployer/${version}`);
  });
});

describe('getRequestId', () => {
  test('reads the header from a plain object or an AxiosHeaders-like getter', () => {
    expect(getRequestId(axiosError(500, {}, { 'x-scry-request-id': REF }))).toBe(REF);
    expect(getRequestId(axiosError(500, {}, { get: (n) => (n === 'x-scry-request-id' ? REF : undefined) }))).toBe(REF);
  });
  test('absent or malformed header gives undefined', () => {
    expect(getRequestId(axiosError(500, {}, {}))).toBeUndefined();
    expect(getRequestId(new Error('no response'))).toBeUndefined();
    expect(getRequestId(axiosError(500, {}, { 'x-scry-request-id': 'bad id with spaces & <script>' }))).toBeUndefined();
  });
});

describe('failed API call', () => {
  function clientFailing(err) {
    return { defaults: { baseURL: 'https://api.example.test' }, post: jest.fn().mockRejectedValue(err) };
  }
  const opts = { fileName: 'storybook.zip', contentType: 'application/zip' };

  test('ApiError carries the request id when the response has the header', async () => {
    const client = clientFailing(axiosError(400, { error: 'Bad project' }, { 'x-scry-request-id': REF }));
    const err = await uploadFileDirectly(client, { project: 'p', version: 'v' }, __filename, opts.fileName, opts.contentType).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.requestId).toBe(REF);
    expect(err.statusCode).toBe(400);
  });

  test('absent header: no request id, message unchanged in shape', async () => {
    const client = clientFailing(axiosError(400, { error: 'Bad project' }, {}));
    const err = await uploadFileDirectly(client, { project: 'p', version: 'v' }, __filename, opts.fileName, opts.contentType).catch((e) => e);
    expect(err.requestId).toBeUndefined();
    expect(err.message).toContain('HTTP 400 Bad Request - Bad project');
  });

  test('guarantee-1 server error body is not printed, only status and the error field', async () => {
    const client = clientFailing(
      axiosError(422, { error: 'Upload failed', detail: BODY_CANARY, user: { email: 'alice@example.com' } }, { 'x-scry-request-id': REF })
    );
    const err = await uploadFileDirectly(client, { project: 'p', version: 'v' }, __filename, opts.fileName, opts.contentType).catch((e) => e);
    expect(err.message).toContain('HTTP 422');
    expect(err.message).toContain('Upload failed');
    expect(err.message).not.toContain(BODY_CANARY);
    expect(err.message).not.toContain('alice@example.com');
    expect(err.message).not.toContain('{');
  });
});

describe('Sentry', () => {
  const saved = { DO_NOT_TRACK: process.env.DO_NOT_TRACK, SCRY_TELEMETRY: process.env.SCRY_TELEMETRY, NODE_ENV: process.env.NODE_ENV };
  beforeAll(async () => {
    delete process.env.DO_NOT_TRACK;
    delete process.env.SCRY_TELEMETRY;
    delete process.env.NODE_ENV;
    expect(initTelemetry()).toBe(true);
    captureCliError(new ApiError('Failed to upload file: HTTP 500', 500, REF), { _: ['deploy'], project: 'proj' });
    await flushTelemetry(2000);
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('environment does not fall back to production', () => {
    expect(sentEvents()[0].environment).toBe('development');
  });
  test('request id is a tag; the only tags are project, command, request_id (no PII)', () => {
    const tags = sentEvents()[0].tags;
    expect(tags.request_id).toBe(REF);
    expect(Object.keys(tags).sort()).toEqual(['command', 'project', 'request_id']);
    expect(sentText()).not.toContain('@example.com');
  });
});
