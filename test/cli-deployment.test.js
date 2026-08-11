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

    // ISSUES.md #24. The gap between "queued" and "uploaded but not queued":
    // analysis was requested, produced nothing, and the command reported plain
    // success. Nothing is ever indexed and CI stays green, so the first sign of
    // trouble is a customer saying search is empty days later.
    test('fails loudly when analysis was requested but produced no metadata', async () => {
      mockDeps(jest.fn().mockResolvedValue({
        zipUpload: { success: true },
        coverageUpload: null,
        metadataUpload: null,
      }));
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const err = jest.spyOn(console, 'error').mockImplementation(() => {});
      const previousExitCode = process.exitCode;

      const { runDeployment } = require('../bin/cli.js');
      await runDeployment({ ...baseArgs, withAnalysis: true });

      const out = [...log.mock.calls, ...warn.mock.calls, ...err.mock.calls]
        .map((c) => String(c[0])).join('\n');
      expect(out).toContain('NOTHING WILL BE INDEXED');
      // A green build here would mean search silently returns nothing.
      expect(process.exitCode).toBe(1);

      process.exitCode = previousExitCode;
    });

    // The quiet path stays quiet: no analysis asked for, none expected.
    test('stays silent when analysis was never requested', async () => {
      mockDeps(jest.fn().mockResolvedValue({
        zipUpload: { success: true },
        coverageUpload: null,
        metadataUpload: null,
      }));
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      const err = jest.spyOn(console, 'error').mockImplementation(() => {});
      const previousExitCode = process.exitCode;

      const { runDeployment } = require('../bin/cli.js');
      await runDeployment({ ...baseArgs, withAnalysis: false });

      const out = [...log.mock.calls, ...err.mock.calls].map((c) => String(c[0])).join('\n');
      expect(out).not.toContain('NOTHING WILL BE INDEXED');
      expect(process.exitCode).not.toBe(1);

      process.exitCode = previousExitCode;
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
