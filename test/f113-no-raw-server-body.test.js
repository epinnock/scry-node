/**
 * F113 (capture-sources lint wave): after merging #73 into the lint PR, no path
 * prints a raw server error body. Only a string `error` field (sanitised,
 * capped) and the request id may reach the console.
 */
const { setupApiErrorLines } = require('../lib/init.js');
const { sendCiTimings } = require('../lib/ciTimings.js');
const { providerErrorText } = require('../lib/localImageProcessing.js');

const CANARY = 'BODY_CANARY_secret_query_text';
const REF = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';

function axiosError(status, data, headers = {}) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, statusText: 'Bad', data, headers };
  return err;
}

describe('init: failed API call', () => {
  test('prints status + error field + Ref, never the rest of the body', () => {
    const lines = setupApiErrorLines(
      axiosError(422, { error: 'Invalid project', detail: CANARY }, { 'x-scry-request-id': REF })
    );
    expect(lines).toEqual(['API Error: 422 - Invalid project', `Ref: ${REF}`]);
    expect(lines.join('\n')).not.toContain(CANARY);
  });

  test('a string body is not printed; the status text is', () => {
    const lines = setupApiErrorLines(axiosError(500, `<html>${CANARY}</html>`));
    expect(lines).toEqual(['API Error: 500 - Bad']);
  });

  test('an object body without an error field is not stringified', () => {
    const lines = setupApiErrorLines(axiosError(400, { issues: [CANARY] }));
    expect(lines.join('\n')).not.toContain(CANARY);
    expect(lines.join('\n')).not.toContain('[object Object]');
  });
});

describe('sendCiTimings: printed detail', () => {
  const client = (err) => ({ post: jest.fn().mockRejectedValue(err) });

  test('404 build-not-found with a string body does not echo the body', async () => {
    const r = await sendCiTimings(client(axiosError(404, `Build not found ${CANARY}`)), {}, 'b1', {});
    expect(r).toEqual({ stored: false, reason: 'build-not-found', detail: 'Build not found' });
  });

  test('404 build-not-found with an error field shows that field only', async () => {
    const r = await sendCiTimings(client(axiosError(404, { error: 'Build not found', detail: CANARY })), {}, 'b1', {});
    expect(r).toEqual({ stored: false, reason: 'build-not-found', detail: 'Build not found' });
  });

  test('400 error field is sanitised (ANSI stripped)', async () => {
    const r = await sendCiTimings(client(axiosError(400, { error: '\u001b[31mbad record\u001b[0m' })), {}, 'b1', {});
    expect(r).toEqual({ stored: false, reason: 'rejected', detail: 'bad record' });
  });
});

describe('local processing: provider error bodies', () => {
  test('only the message field of a JSON error body is kept', () => {
    const text = providerErrorText(JSON.stringify({ error: { message: 'quota exceeded', param: CANARY } }));
    expect(text).toBe('quota exceeded');
  });

  test('a non-JSON body is not echoed', () => {
    expect(providerErrorText(`<html>${CANARY}</html>`)).toBe('non-JSON error body');
  });

  test('a JSON body with no message field is not echoed', () => {
    expect(providerErrorText(JSON.stringify({ input: CANARY }))).toBe('no error message');
  });
});
