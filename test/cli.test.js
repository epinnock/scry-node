describe('bin/cli helpers', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('buildDeployResult() builds viewUrl and coverageUrl', () => {
    const { buildDeployResult } = require('../bin/cli.js');

    process.env.SCRY_VIEW_URL = 'https://view.scrymore.com/';

    const res = buildDeployResult(
      { project: 'p', version: 'v' },
      { summary: {}, qualityGate: {} },
      { zipUpload: { visibility: 'private' } }
    );

    expect(res.viewUrl).toBe('https://view.scrymore.com/p/v/');
    expect(res.coverageUrl).toBe('https://view.scrymore.com/p/v/coverage-report.json');
    expect(res.visibility).toBe('private');

    delete process.env.SCRY_VIEW_URL;
  });

  test('logUploadLinks() prints private message when visibility is private', () => {
    const { logUploadLinks } = require('../bin/cli.js');

    const logger = {
      info: jest.fn(),
      debug: jest.fn(),
      success: jest.fn(),
      error: jest.fn(),
    };

    logUploadLinks(
      { project: 'p', version: 'v' },
      null,
      { zipUpload: { visibility: 'private' } },
      logger
    );

    const output = logger.info.mock.calls.flat().join(' ');
    expect(output).toContain('private');
  });

  test('logUploadLinks() skips private message when visibility is public', () => {
    const { logUploadLinks } = require('../bin/cli.js');

    const logger = {
      info: jest.fn(),
      debug: jest.fn(),
      success: jest.fn(),
      error: jest.fn(),
    };

    logUploadLinks(
      { project: 'p', version: 'v' },
      null,
      { zipUpload: { visibility: 'public' } },
      logger
    );

    const output = logger.info.mock.calls.flat().join(' ');
    expect(output).not.toContain('private');
  });

  test('resolveCoverage() returns nulls when coverage disabled', async () => {
    const { resolveCoverage } = require('../bin/cli.js');

    const logger = {
      info: jest.fn(),
      debug: jest.fn(),
      success: jest.fn(),
      error: jest.fn(),
    };

    const res = await resolveCoverage({ coverage: false }, logger);

    expect(res).toEqual({ coverageReport: null, coverageSummary: null, metadataZipPath: null, sbcovFailure: null, effectiveMaxDropped: null, maxDroppedUnsupported: false });
  });

  test('resolveCoverage() loads report from --coverage-report path', async () => {
    jest.doMock('../lib/coverage.js', () => ({
      runCoverageAnalysis: jest.fn(),
      loadCoverageReport: jest.fn(() => ({
        summary: { metrics: { componentCoverage: 1, propCoverage: 2, variantCoverage: 3 }, health: { passRate: 4, failingStories: 0 }, totalComponents: 1, componentsWithStories: 1 },
        qualityGate: { passed: true },
        generatedAt: 'x',
      })),
      extractCoverageSummary: jest.fn(() => ({
        reportUrl: null,
        summary: {
          componentCoverage: 1,
          propCoverage: 2,
          variantCoverage: 3,
          passRate: 4,
          totalComponents: 1,
          componentsWithStories: 1,
          failingStories: 0,
        },
        qualityGate: { passed: true },
        generatedAt: 'x',
      })),
    }));

    const { resolveCoverage } = require('../bin/cli.js');

    const logger = {
      info: jest.fn(),
      debug: jest.fn(),
      success: jest.fn(),
      error: jest.fn(),
    };

    const res = await resolveCoverage({
      coverage: true,
      coverageReport: '/tmp/report.json',
      coverageBase: 'main',
      coverageFailOnThreshold: false,
      dir: './storybook-static',
    }, logger);

    expect(res.coverageReport).toBeTruthy();
    expect(res.coverageSummary).toBeTruthy();
    expect(res.metadataZipPath).toBeNull();
    expect(logger.success).toHaveBeenCalled();
  });
});

describe('resolveAnalysis (D2: analysis on by default since 0.7.0)', () => {
  const { resolveAnalysis } = require('../bin/cli.js');
  test.each([
    [{}, true, null],
    [{ withAnalysis: true }, true, null],
    [{ withAnalysis: true, coverage: false }, true, null],
    [{ analysis: false }, false, '--no-analysis'],
    [{ analysis: false, withAnalysis: true }, false, '--no-analysis'],
    [{ withAnalysis: false }, false, 'withAnalysis is false in .storybook-deployer.json or SCRY_WITH_ANALYSIS'],
    [{ coverage: false }, false, '--no-coverage (analysis runs inside coverage)'],
    [{ coverageReport: 'r.json' }, false, '--coverage-report (a supplied report has no screenshots)'],
    [{ coverageReport: 'r.json', withAnalysis: true }, true, null],
  ])('%j -> enabled %s', (argv, enabled, optOut) => {
    expect(resolveAnalysis(argv)).toEqual({ enabled, optOut });
  });
});
