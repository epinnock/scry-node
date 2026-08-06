const fs = require('fs');
const os = require('os');
const path = require('path');

describe('bin/cli runDeployment()', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  // ISSUES.md #4. Uploading is synchronous; indexing is not. This command used
  // to print "Deployment successful" and stop, so a build that died in the queue
  // seconds later looked like a success and sent people debugging three steps
  // downstream. These assert it no longer overclaims.
  describe('does not report indexing it cannot confirm', () => {
    function mockDeps(uploadBuild) {
      jest.doMock('../lib/apiClient.js', () => ({
        getApiClient: jest.fn(() => ({ defaults: { baseURL: 'x' } })),
        uploadBuild,
      }));
      jest.doMock('../lib/archive.js', () => ({
        zipDirectory: jest.fn(async (_dir, outPath) => {
          fs.writeFileSync(outPath, 'zip');
        }),
      }));
      jest.doMock('../lib/pr-comment.js', () => ({ postPRComment: jest.fn(async () => {}) }));
    }

    const baseArgs = {
      dir: './test-storybook-static',
      project: 'p',
      version: 'v',
      apiUrl: 'https://example.invalid',
      apiKey: 'k',
      withAnalysis: false,
      coverage: false,
      verbose: false,
    };

    test('says indexing is queued but unconfirmed, and never claims success', async () => {
      mockDeps(jest.fn().mockResolvedValue({
        zipUpload: { success: true },
        coverageUpload: null,
        metadataUpload: { success: true, queued: true, buildNumber: 7 },
      }));
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});

      const { runDeployment } = require('../bin/cli.js');
      await runDeployment({ ...baseArgs });

      const out = log.mock.calls.map((c) => String(c[0])).join('\n');
      expect(out).toContain('Upload complete');
      expect(out).toContain('queued, not finished');
      expect(out).not.toContain('Deployment successful');
    });

    test('warns loudly when metadata uploaded but was not queued', async () => {
      mockDeps(jest.fn().mockResolvedValue({
        zipUpload: { success: true },
        coverageUpload: null,
        metadataUpload: { success: true, queued: false },
      }));
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const { runDeployment } = require('../bin/cli.js');
      await runDeployment({ ...baseArgs });

      const out = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(out).toContain('NOT being indexed');
    });

    test('stays quiet about indexing when no metadata was uploaded', async () => {
      mockDeps(jest.fn().mockResolvedValue({
        zipUpload: { success: true },
        coverageUpload: null,
        metadataUpload: null,
      }));
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const { runDeployment } = require('../bin/cli.js');
      await runDeployment({ ...baseArgs });

      const out = [...log.mock.calls, ...warn.mock.calls].map((c) => String(c[0])).join('\n');
      expect(out).toContain('Upload complete');
      expect(out).not.toContain('queued, not finished');
      expect(out).not.toContain('NOT being indexed');
    });
  });

  test('deploys without analysis and with coverage disabled', async () => {
    const uploadBuild = jest.fn().mockResolvedValue({ zipUpload: { success: true }, coverageUpload: null });

    jest.doMock('../lib/apiClient.js', () => ({
      getApiClient: jest.fn(() => ({ defaults: { baseURL: 'x' } })),
      uploadBuild,
    }));

    jest.doMock('../lib/archive.js', () => ({
      zipDirectory: jest.fn(async (_dir, outPath) => {
        fs.writeFileSync(outPath, 'zip');
      }),
    }));

    jest.doMock('../lib/pr-comment.js', () => ({ postPRComment: jest.fn(async () => {}) }));

    const { runDeployment } = require('../bin/cli.js');

    await runDeployment({
      dir: './test-storybook-static',
      project: 'p',
      version: 'v',
      apiUrl: 'https://example.invalid',
      apiKey: 'k',
      withAnalysis: false,
      coverage: false,
      verbose: false,
    });

    expect(uploadBuild).toHaveBeenCalledWith(
      expect.any(Object),
      { project: 'p', version: 'v' },
      expect.objectContaining({ zipPath: expect.any(String), coverageReport: null })
    );
  });

  test('deploys with analysis using storybook-only ZIP and with coverage disabled', async () => {
    const uploadBuild = jest.fn().mockResolvedValue({ zipUpload: { success: true }, coverageUpload: null });

    jest.doMock('../lib/apiClient.js', () => ({
      getApiClient: jest.fn(() => ({ defaults: { baseURL: 'x' } })),
      uploadBuild,
    }));

    jest.doMock('../lib/archive.js', () => ({
      zipDirectory: jest.fn(async (_dir, outPath) => {
        fs.writeFileSync(outPath, 'zip');
      }),
    }));

    jest.doMock('../lib/pr-comment.js', () => ({ postPRComment: jest.fn(async () => {}) }));

    const { runDeployment } = require('../bin/cli.js');

    await runDeployment({
      dir: './test-storybook-static',
      project: 'p',
      version: 'v',
      apiUrl: 'https://example.invalid',
      apiKey: 'k',
      withAnalysis: true,
      coverage: false,
      verbose: false,
    });

    expect(uploadBuild).toHaveBeenCalledWith(
      expect.any(Object),
      { project: 'p', version: 'v' },
      expect.objectContaining({ metadataZipPath: null })
    );
  });
});
