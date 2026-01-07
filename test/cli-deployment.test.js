const fs = require('fs');
const os = require('os');
const path = require('path');

describe('bin/cli runDeployment()', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
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

  test('deploys with analysis (no screenshots) and with coverage disabled', async () => {
    const uploadBuild = jest.fn().mockResolvedValue({ zipUpload: { success: true }, coverageUpload: null });

    jest.doMock('../lib/apiClient.js', () => ({
      getApiClient: jest.fn(() => ({ defaults: { baseURL: 'x' } })),
      uploadBuild,
    }));

    jest.doMock('../lib/archiveUtils.js', () => ({
      createMasterZip: jest.fn(async ({ outPath }) => {
        fs.writeFileSync(outPath, 'zip');
      }),
    }));

    jest.doMock('../lib/analysis.js', () => ({
      analyzeStorybook: jest.fn(() => ({ summary: { totalStories: 0, withScreenshots: 0 } })),
    }));

    jest.doMock('../lib/screencap.js', () => ({ captureScreenshots: jest.fn(async () => {}) }));

    jest.doMock('../lib/pr-comment.js', () => ({ postPRComment: jest.fn(async () => {}) }));

    const { runDeployment } = require('../bin/cli.js');

    await runDeployment({
      dir: './test-storybook-static',
      project: 'p',
      version: 'v',
      apiUrl: 'https://example.invalid',
      apiKey: 'k',
      withAnalysis: true,
      storybookUrl: '',
      screenshotsDir: path.join(os.tmpdir(), `shots-${Date.now()}`),
      storiesDir: null,
      coverage: false,
      verbose: false,
    });

    expect(uploadBuild).toHaveBeenCalled();
  });
});
