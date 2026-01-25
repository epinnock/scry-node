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
    ).resolves.toEqual({ url: 'https://upload.example.com', visibility: undefined });
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

  test('requestPresignedUrl() returns visibility when present', async () => {
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
      post: jest.fn().mockResolvedValue({ data: { url: 'https://upload.example.com', visibility: 'private' } }),
    };

    await expect(
      requestPresignedUrl(apiClient, { project: 'p', version: 'v' }, { fileName: 'storybook.zip', contentType: 'application/zip' })
    ).resolves.toEqual({ url: 'https://upload.example.com', visibility: 'private' });
  });

  test('uploadBuild() uploads zip via presigned URL and coverage via attach endpoint', async () => {
    jest.useFakeTimers();
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
        // First call: presigned URL for storybook.zip
        .mockResolvedValueOnce({ data: { url: 'https://upload.example.com/storybook' } })
        // Second call: coverage attach endpoint (POST /upload/:project/:version/coverage)
        .mockResolvedValueOnce({ data: { success: true, buildId: 'build-123', coverageUrl: 'https://r2.example.com/coverage' } }),
    };

    const uploadPromise = uploadBuild(apiClient, { project: 'p', version: 'v' }, { zipPath: tmpZip, coverageReport: { ok: true } });
    await jest.advanceTimersByTimeAsync(5000);
    const result = await uploadPromise;

    expect(result.zipUpload.success).toBe(true);
    expect(result.zipUpload.visibility).toBeUndefined();
    expect(result.coverageUpload.success).toBe(true);
    expect(result.coverageUpload.buildId).toBe('build-123');
    expect(result.coverageUpload.coverageUrl).toBe('https://r2.example.com/coverage');
    // ZIP uses presigned URL (1 post for presign, 1 put for upload)
    // Coverage uses attach endpoint (1 post directly)
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    // Only ZIP upload uses PUT to presigned URL
    expect(axiosPut).toHaveBeenCalledTimes(1);

    // Verify coverage was posted to the attach endpoint, not presigned
    expect(apiClient.post).toHaveBeenNthCalledWith(
      2,
      '/upload/p/v/coverage',
      { ok: true },
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
    );

    fs.unlinkSync(tmpZip);
    jest.useRealTimers();
  });

  test('uploadCoverageReportDirectly() posts to coverage attach endpoint', async () => {
    jest.doMock('axios', () => ({
      put: jest.fn(),
      create: jest.fn(() => ({
        defaults: { baseURL: 'https://api' },
      })),
    }));

    const { uploadCoverageReportDirectly } = require('../lib/apiClient.js');

    const apiClient = {
      defaults: { baseURL: 'https://api' },
      post: jest.fn().mockResolvedValue({
        data: { success: true, buildId: 'build-456', coverageUrl: 'https://r2.example.com/coverage.json' },
      }),
    };

    const coverageReport = {
      summary: { componentCoverage: 0.9 },
      qualityGate: { passed: true },
      generatedAt: '2024-01-01T00:00:00Z',
    };

    const result = await uploadCoverageReportDirectly(apiClient, { project: 'myproj', version: 'v1.0.0' }, coverageReport);

    expect(result.success).toBe(true);
    expect(result.buildId).toBe('build-456');
    expect(result.coverageUrl).toBe('https://r2.example.com/coverage.json');
    expect(apiClient.post).toHaveBeenCalledWith(
      '/upload/myproj/v1.0.0/coverage',
      coverageReport,
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
    );
  });
});
