/** uploadBundle(): presigned bundle.zip?source= → PUT → bundle/complete (capture-sources contract §9). */
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
            .mockResolvedValueOnce({ status: 200, data: { url: 'https://acct.r2.cloudflarestorage.com/x?sig=1', buildId: 'b1', buildNumber: 3 } })
            .mockResolvedValueOnce({ status: 200, data: { queued: true, zipKey: 'p/v/builds/3/bundle.zip' } });
        const apiClient = { defaults: { baseURL: 'https://upload' }, post };

        const res = await uploadBundle(apiClient, { project: 'p1', version: 'v1' }, zipFile(), { sourceKey: 'storybook-rn:ios', gitContext: { commitSha: 'abc' }, log });

        expect(post.mock.calls[0][0]).toBe('/presigned-url/p1/v1/bundle.zip?source=storybook-rn%3Aios');
        expect(post.mock.calls[0][1]).toMatchObject({ contentType: 'application/zip', commitSha: 'abc' });
        expect(put).toHaveBeenCalledWith('https://acct.r2.cloudflarestorage.com/x?sig=1', expect.any(Buffer), expect.objectContaining({ headers: { 'Content-Type': 'application/zip' } }));
        expect(post.mock.calls[1][0]).toBe('/upload/p1/v1/bundle/complete?source=storybook-rn%3Aios&commitSha=abc');
        expect(post.mock.calls[1][1]).toEqual({ buildId: 'b1', buildNumber: 3, source: 'storybook-rn:ios' });
        expect(res).toEqual({ success: true, status: 200, queued: true, buildId: 'b1', buildNumber: 3, zipKey: 'p/v/builds/3/bundle.zip' });
    });

    test('a 422 from complete returns the validator messages, no throw', async () => {
        jest.doMock('axios', () => ({ put: jest.fn().mockResolvedValue({ status: 200 }), create: jest.fn() }));
        const { uploadBundle } = require('../lib/apiClient.js');
        const err = Object.assign(new Error('Request failed with status code 422'), {
            response: { status: 422, data: { error: 'Bundle rejected', errors: [{ code: 'FORBIDDEN_MEMBER', path: 'x.html', message: 'no' }] } },
        });
        const post = jest.fn()
            .mockResolvedValueOnce({ status: 200, data: { url: 'https://acct.r2.cloudflarestorage.com/x', buildId: 'b1' } })
            .mockRejectedValueOnce(err);
        const res = await uploadBundle({ defaults: {}, post }, { project: 'p1', version: 'v1' }, zipFile(), { sourceKey: 'storybook:web', log });
        expect(res).toMatchObject({ success: false, status: 422, error: 'Bundle rejected', errors: [{ code: 'FORBIDDEN_MEMBER' }] });
    });
});
