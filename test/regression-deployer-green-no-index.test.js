// Reproduction for scry-management/features/deployer-green-no-index (ISSUES.md #50).
// Each test asserts the TARGET behaviour and is expected to FAIL on 0.6.1
// (origin/main 64defb0): a deploy asked to index that indexes nothing ends green.
const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');

function writeZip(zipPath, entries) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const a = archiver('zip');
    out.on('close', resolve);
    a.on('error', reject);
    a.pipe(out);
    for (const [name, body] of Object.entries(entries)) a.append(body, { name });
    a.finalize();
  });
}

const ZIP_ONE = path.join(os.tmpdir(), `repro-one-entry-${process.pid}.zip`);
const ZIP_EMPTY = path.join(os.tmpdir(), `repro-zero-entries-${process.pid}.zip`);

describe('deployer-green-no-index reproduction', () => {
  // Built once, before any module is reset or mocked.
  beforeAll(async () => {
    await writeZip(ZIP_ONE, { 'metadata.json': JSON.stringify([{ storyId: 's' }]) });
    await writeZip(ZIP_EMPTY, { 'metadata.json': '[]' });
  });
  let prevExit;
  beforeEach(() => { prevExit = process.exitCode; process.exitCode = undefined; });
  afterEach(() => { process.exitCode = prevExit; jest.resetModules(); jest.restoreAllMocks(); });

  function mockDeps({ uploadBuild, metadataZipPath = null }) {
    jest.doMock('../lib/apiClient.js', () => ({
      getApiClient: jest.fn(() => ({ defaults: { baseURL: 'x' } })),
      uploadBuild,
    }));
    jest.doMock('../lib/archive.js', () => ({
      zipDirectory: jest.fn(async (_d, outPath) => fs.writeFileSync(outPath, 'zip')),
    }));
    jest.doMock('../lib/pr-comment.js', () => ({ postPRComment: jest.fn(async () => {}) }));
    jest.doMock('../lib/coverage.js', () => ({
      runCoverageAnalysis: jest.fn(async () => ({ report: null, metadataZipPath })),
      loadCoverageReport: jest.fn(),
      extractCoverageSummary: jest.fn(() => null),
    }));
    for (const m of ['log', 'warn', 'error']) jest.spyOn(console, m).mockImplementation(() => {});
  }

  const args = {
    dir: './test-storybook-static', project: 'p', version: 'main',
    apiUrl: 'https://example.invalid', apiKey: 'k',
    withAnalysis: true, coverage: true, verbose: false,
  };

  // (a) apiClient.uploadMetadataZip returns {success:false} on a rejected upload
  // (lib/apiClient.js:410-412); cli.js:159 only tests truthiness, warns, exit 0.
  test('(a) a failed metadata upload ends red', async () => {
    const zip = ZIP_ONE;
    mockDeps({
      metadataZipPath: zip,
      uploadBuild: jest.fn().mockResolvedValue({
        zipUpload: { success: true }, coverageUpload: null,
        metadataUpload: { success: false, error: 'Request failed with status code 500' },
      }),
    });
    const { runDeployment } = require('../bin/cli.js');
    await runDeployment({ ...args });
    expect(process.exitCode).toBe(1);
  });

  // (b) sbcov writes metadata.json = [] when every story fails after the browser
  // launches (scry-sbcov src/core/zip-generator.ts:152-164, 194-195); the deployer
  // uploads it, the build is queued with nothing to index, exit 0.
  test('(b) an analysis archive with zero entries is not queued and ends red', async () => {
    const zip = ZIP_EMPTY;
    const uploadBuild = jest.fn().mockResolvedValue({
      zipUpload: { success: true }, coverageUpload: null,
      metadataUpload: { success: true, queued: true, buildNumber: 1 },
    });
    mockDeps({ uploadBuild, metadataZipPath: zip });
    const { runDeployment } = require('../bin/cli.js');
    await runDeployment({ ...args });
    const sentZip = uploadBuild.mock.calls[0]?.[2]?.metadataZipPath ?? null;
    expect({ sentEmptyArchive: sentZip === zip, exitCode: process.exitCode })
      .toEqual({ sentEmptyArchive: false, exitCode: 1 });
  });

  // (c) the generated workflow installs a floating Playwright before the deployer
  // (and so sbcov's playwright) is resolved, and runs bare `npx @scrymore/scry-deployer`,
  // which resolves a repo-local pin first (lib/templates.js:115-127, 199-201).
  test.each(['generateMainWorkflow', 'generatePRWorkflow'])(
    '(c) %s installs the browser from the deployer\'s own Playwright and invokes a floored deployer',
    (fn) => {
      const t = require('../lib/templates.js');
      const yml = t[fn]('p', 'https://api', 'npm', 'build-storybook');
      const floatingInstall = /npx --yes playwright install/.test(yml);
      const bareInvoke = /npx @scrymore\/scry-deployer(\s|\\)/.test(yml);
      expect({ floatingInstall, bareInvoke }).toEqual({ floatingInstall: false, bareInvoke: false });
    },
  );
});
