describe('lib/apiClient', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('requestPresignedUrl() returns url from api response', async () => {
    jest.doMock('axios', () => {
      const put = jest.fn();
      const create = jest.fn(() => ({
        defaults: { baseURL: 'https://api' },
        post: jest.fn(),
      }));
      return { put, create };
    });

    const { requestPresignedUrl } = require('../lib/apiClient.js');

    const apiClient = {
      defaults: { baseURL: 'https://api' },
      post: jest.fn().mockResolvedValue({ data: { url: 'https://upload.example.com' } }),
    };

    await expect(
      requestPresignedUrl(apiClient, { project: 'p', version: 'v' }, { fileName: 'storybook.zip', contentType: 'application/zip' })
    ).resolves.toBe('https://upload.example.com');
  });

  test('requestPresignedUrl() throws if url missing', async () => {
    jest.doMock('axios', () => ({ put: jest.fn(), create: jest.fn() }));

    const { requestPresignedUrl } = require('../lib/apiClient.js');

    const apiClient = {
      defaults: { baseURL: 'https://api' },
      post: jest.fn().mockResolvedValue({ data: { nope: true } }),
    };

    await expect(
      requestPresignedUrl(apiClient, { project: 'p', version: 'v' }, { fileName: 'storybook.zip', contentType: 'application/zip' })
    ).rejects.toThrow('Failed to get valid presigned URL');
  });

  test('uploadBuild() uploads zip and optional coverage report', async () => {
    const axiosPut = jest.fn().mockResolvedValue({ status: 200 });

    jest.doMock('axios', () => ({
      put: axiosPut,
      create: jest.fn(() => ({
        defaults: { baseURL: 'https://api' },
      })),
    }));

    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const tmpZip = path.join(os.tmpdir(), `scry-zip-${Date.now()}.zip`);
    fs.writeFileSync(tmpZip, Buffer.from('zip'));

    const { uploadBuild } = require('../lib/apiClient.js');

    const apiClient = {
      defaults: { baseURL: 'https://api' },
      post: jest
        .fn()
        .mockResolvedValueOnce({ data: { url: 'https://upload.example.com/storybook' } })
        .mockResolvedValueOnce({ data: { url: 'https://upload.example.com/coverage' } }),
    };

    const result = await uploadBuild(apiClient, { project: 'p', version: 'v' }, { zipPath: tmpZip, coverageReport: { ok: true } });

    expect(result.zipUpload.success).toBe(true);
    expect(result.coverageUpload.success).toBe(true);
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    expect(axiosPut).toHaveBeenCalledTimes(2);

    fs.unlinkSync(tmpZip);
  });
});
