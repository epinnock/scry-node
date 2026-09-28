/**
 * uploadBundle(): presigned bundle.zip?source= → PUT → bundle/complete (capture-sources
 * contract §9).
 *
 * Ledger F38/F46: this file's own earlier version asserted the WRONG complete body
 * ({buildId, buildNumber, source}, no zipKey) as correct — both sides were green because each
 * encoded its own mismatched assumption in a mock. The "contract" describe block below builds
 * uploadBundle()'s presign-response handling and complete-request body from a *fixture copied
 * from the server's own test*, not from this file's own assumptions, so the two sides can't
 * drift silently again the same way.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('uploadBundle', () => {
    afterEach(() => {
        jest.resetModules();
        jest.restoreAllMocks();
    });

    function zipFile() {
        const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scry-ub-')), 'bundle.zip');
        fs.writeFileSync(p, Buffer.from('PK\u0005\u0006' + '\0'.repeat(18), 'binary'));
        return p;
    }

    const log = { info: () => {}, success: () => {}, error: () => {}, warn: () => {} };

    test('calls the bundle routes with the source key and returns the queued build', async () => {
        const put = jest.fn().mockResolvedValue({ status: 200 });
        jest.doMock('axios', () => ({ put, create: jest.fn() }));
        const { uploadBundle } = require('../lib/apiClient.js');
        const post = jest.fn()
            .mockResolvedValueOnce({ status: 200, data: { url: 'https://acct.r2.cloudflarestorage.com/x?sig=1', fields: { key: 'p1/v1/builds/3/bundle.zip' }, buildId: 'b1', buildNumber: 3 } })
            .mockResolvedValueOnce({ status: 200, data: { success: true, message: 'ok', queued: true, buildId: 'b1', buildNumber: 3 } });
        const apiClient = { defaults: { baseURL: 'https://upload' }, post };

        const res = await uploadBundle(apiClient, { project: 'p1', version: 'v1' }, zipFile(), { sourceKey: 'storybook-rn:ios', gitContext: { commitSha: 'abc' }, log });

        expect(post.mock.calls[0][0]).toBe('/presigned-url/p1/v1/bundle.zip?source=storybook-rn%3Aios');
        expect(post.mock.calls[0][1]).toMatchObject({ contentType: 'application/zip', commitSha: 'abc' });
        expect(put).toHaveBeenCalledWith('https://acct.r2.cloudflarestorage.com/x?sig=1', expect.any(Buffer), expect.objectContaining({ headers: { 'Content-Type': 'application/zip' } }));
        // The server's BundleCompleteBodySchema requires exactly {buildId, zipKey} and nothing
        // else (F46) — no query string, no buildNumber/source in the body.
        expect(post.mock.calls[1][0]).toBe('/upload/p1/v1/bundle/complete');
        expect(post.mock.calls[1][1]).toEqual({ buildId: 'b1', zipKey: 'p1/v1/builds/3/bundle.zip' });
        expect(res).toEqual({ success: true, status: 200, queued: true, buildId: 'b1', buildNumber: 3, zipKey: 'p1/v1/builds/3/bundle.zip' });
    });

    test('a missing fields.key on the presign response fails fast, before any complete call', async () => {
        jest.doMock('axios', () => ({ put: jest.fn().mockResolvedValue({ status: 200 }), create: jest.fn() }));
        const { uploadBundle } = require('../lib/apiClient.js');
        const post = jest.fn().mockResolvedValue({ status: 200, data: { url: 'https://acct.r2.cloudflarestorage.com/x', buildId: 'b1' } });
        await expect(
            uploadBundle({ defaults: { baseURL: 'https://upload' }, post }, { project: 'p1', version: 'v1' }, zipFile(), { sourceKey: 'storybook:web', log })
        ).rejects.toThrow(/fields\.key/);
        expect(post).toHaveBeenCalledTimes(1); // presign only; complete was never called
    });

    test('a 422 from complete returns the validator messages, no throw', async () => {
        jest.doMock('axios', () => ({ put: jest.fn().mockResolvedValue({ status: 200 }), create: jest.fn() }));
        const { uploadBundle } = require('../lib/apiClient.js');
        const err = Object.assign(new Error('Request failed with status code 422'), {
            response: { status: 422, data: { success: false, error: 'Bundle rejected', errors: [{ code: 'FORBIDDEN_MEMBER', path: 'x.html', message: 'no' }] } },
        });
        const post = jest.fn()
            .mockResolvedValueOnce({ status: 200, data: { url: 'https://acct.r2.cloudflarestorage.com/x', fields: { key: 'p1/v1/builds/1/bundle.zip' }, buildId: 'b1' } })
            .mockRejectedValueOnce(err);
        const res = await uploadBundle({ defaults: {}, post }, { project: 'p1', version: 'v1' }, zipFile(), { sourceKey: 'storybook:web', log });
        expect(res).toMatchObject({ success: false, status: 422, error: 'Bundle rejected', errors: [{ code: 'FORBIDDEN_MEMBER' }] });
    });
});

/**
 * Contract test (ledger F38/F46): the presign-response fixture below is copied verbatim from
 * scryorg/scry-storybook-upload-service's own test of the REAL route (not reconstructed from
 * memory), so this test fails the moment either side's shape drifts again without the other
 * changing to match.
 *
 * Fixture source: scryorg/scry-storybook-upload-service, PR #33 (branch
 * feat/capture-sources-pr2-upload), sha b02700f778264dcd5f8a32dd037e5dd1a2885512,
 * src/app.bundle.test.ts, describe('POST /presigned-url/:project/:version/bundle.zip') >
 * it('parses ?source, creates the build with source, and keys the presigned URL by build
 * number') — that test's own assertions (`body.buildId`, `body.buildNumber`, `body.fields.key`)
 * are reproduced as test/fixtures/upload-service-bundle-presign-response.json, and its
 * BundleCompleteBodySchema (src/app.ts ~1236-1247, same sha) requires exactly {buildId, zipKey}.
 */
describe('uploadBundle contract: presign response -> complete request (server fixture)', () => {
    afterEach(() => {
        jest.resetModules();
        jest.restoreAllMocks();
    });

    const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'upload-service-bundle-presign-response.json');
    const PRESIGN_RESPONSE = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

    function zipFile() {
        const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scry-ub-contract-')), 'bundle.zip');
        fs.writeFileSync(p, Buffer.from('PK\u0005\u0006' + '\0'.repeat(18), 'binary'));
        return p;
    }

    const log = { info: () => {}, success: () => {}, error: () => {}, warn: () => {} };

    test('the complete request body is built from the recorded presign response exactly as the server schema requires', async () => {
        const put = jest.fn().mockResolvedValue({ status: 200 });
        jest.doMock('axios', () => ({ put, create: jest.fn() }));
        const { uploadBundle } = require('../lib/apiClient.js');
        const post = jest.fn()
            .mockResolvedValueOnce({ status: 200, data: PRESIGN_RESPONSE })
            .mockResolvedValueOnce({ status: 200, data: { success: true, message: 'ok', queued: true, buildId: PRESIGN_RESPONSE.buildId, buildNumber: PRESIGN_RESPONSE.buildNumber } });
        const apiClient = { defaults: { baseURL: 'https://upload' }, post };

        const res = await uploadBundle(apiClient, { project: 'acme', version: 'main' }, zipFile(), { sourceKey: 'storybook:web', log });

        // Exactly the two fields BundleCompleteBodySchema (server, same sha) requires - no more,
        // no less - built from the presign response's own fields.key, not a client-side guess.
        expect(post.mock.calls[1][1]).toEqual({
            buildId: PRESIGN_RESPONSE.buildId,
            zipKey: PRESIGN_RESPONSE.fields.key,
        });
        expect(res.success).toBe(true);
        expect(res.zipKey).toBe(PRESIGN_RESPONSE.fields.key);
        expect(res.buildId).toBe(PRESIGN_RESPONSE.buildId);
        expect(res.buildNumber).toBe(PRESIGN_RESPONSE.buildNumber);
    });
});
