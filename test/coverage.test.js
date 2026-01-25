const fs = require('fs');
const path = require('path');

describe('lib/coverage', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  test('extractCoverageSummary() returns null for null report', () => {
    const { extractCoverageSummary } = require('../lib/coverage.js');
    expect(extractCoverageSummary(null)).toBeNull();
  });

  test('extractCoverageSummary() extracts expected fields from report', () => {
    const { extractCoverageSummary } = require('../lib/coverage.js');

    const report = {
      summary: {
        metrics: {
          componentCoverage: 90.1,
          propCoverage: 80.2,
          variantCoverage: 70.3,
        },
        health: {
          passRate: 99.9,
          failingStories: 2,
        },
        totalComponents: 10,
        componentsWithStories: 8,
      },
      qualityGate: { passed: true },
      generatedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(extractCoverageSummary(report)).toEqual({
      reportUrl: null,
      summary: {
        componentCoverage: 90.1,
        propCoverage: 80.2,
        variantCoverage: 70.3,
        passRate: 99.9,
        totalComponents: 10,
        componentsWithStories: 8,
        failingStories: 2,
      },
      qualityGate: { passed: true },
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  test('runCoverageAnalysis() returns report and deletes temp file on success', async () => {
    jest.resetModules();

    const execSync = jest.fn();
    jest.doMock('child_process', () => ({ execSync }));

    const fixedNow = 1234567890;
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    const { runCoverageAnalysis } = require('../lib/coverage.js');

    const outPath = path.join(process.cwd(), `.scry-coverage-report-${fixedNow}.json`);

    execSync.mockImplementation(() => {
      fs.writeFileSync(
        outPath,
        JSON.stringify({ summary: { metrics: {}, health: {} }, qualityGate: {}, generatedAt: 'x' })
      );
    });

    const report = await runCoverageAnalysis({ storybookDir: './storybook-static', baseBranch: 'main' });

    expect(report).toEqual({ summary: { metrics: {}, health: {} }, qualityGate: {}, generatedAt: 'x' });
    expect(fs.existsSync(outPath)).toBe(false);

    // Ensure we invoked npx @scrymore/scry-sbcov
    expect(execSync).toHaveBeenCalledWith(expect.stringContaining('@scrymore/scry-sbcov'), expect.any(Object));
  });

  test('runCoverageAnalysis() returns null when tool fails and failOnThreshold=false', async () => {
    jest.resetModules();

    const execSync = jest.fn(() => {
      throw new Error('tool failed');
    });
    jest.doMock('child_process', () => ({ execSync }));

    const { runCoverageAnalysis } = require('../lib/coverage.js');

    await expect(
      runCoverageAnalysis({ storybookDir: './storybook-static', baseBranch: 'main', failOnThreshold: false })
    ).resolves.toBeNull();
  });

  test('runCoverageAnalysis() throws when tool fails and failOnThreshold=true', async () => {
    jest.resetModules();

    const execSync = jest.fn(() => {
      throw new Error('tool failed');
    });
    jest.doMock('child_process', () => ({ execSync }));

    const { runCoverageAnalysis } = require('../lib/coverage.js');

    await expect(
      runCoverageAnalysis({ storybookDir: './storybook-static', baseBranch: 'main', failOnThreshold: true })
    ).rejects.toThrow('tool failed');
  });

  test('runCoverageAnalysis() prefers GitHub PR base SHA when available', async () => {
    jest.resetModules();

    const execSync = jest.fn();
    jest.doMock('child_process', () => ({ execSync }));

    const eventPath = path.join(process.cwd(), 'test', 'fixtures', 'github-event.json');
    process.env.GITHUB_EVENT_PATH = eventPath;

    const fixedNow = 1730000000000;
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    const { runCoverageAnalysis } = require('../lib/coverage.js');

    execSync.mockImplementation(() => {
      const reportPath = path.join(process.cwd(), `.scry-coverage-report-${fixedNow}.json`);
      fs.writeFileSync(
        reportPath,
        JSON.stringify({ summary: { metrics: {}, health: {} }, qualityGate: {}, generatedAt: 'x' })
      );
    });

    await runCoverageAnalysis({ storybookDir: './storybook-static', baseBranch: 'main' });

    const calledCommand = execSync.mock.calls[0][0];
    expect(calledCommand).toContain('--base');
    expect(calledCommand).toContain('d34db33fd34db33fd34db33fd34db33fd34db33f');
  });

  test('runCoverageAnalysis() falls back to base branch when PR base SHA missing', async () => {
    jest.resetModules();

    const execSync = jest.fn();
    jest.doMock('child_process', () => ({ execSync }));

    process.env = {};

    const fixedNow = 1730000000001;
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    const { runCoverageAnalysis } = require('../lib/coverage.js');

    execSync.mockImplementation(() => {
      const reportPath = path.join(process.cwd(), `.scry-coverage-report-${fixedNow}.json`);
      fs.writeFileSync(
        reportPath,
        JSON.stringify({ summary: { metrics: {}, health: {} }, qualityGate: {}, generatedAt: 'x' })
      );
    });

    await runCoverageAnalysis({ storybookDir: './storybook-static', baseBranch: 'develop' });

    const calledCommand = execSync.mock.calls[0][0];
    expect(calledCommand).toContain('--base');
    expect(calledCommand).toContain('origin/develop');
  });

  test('runCoverageAnalysis() uses GitLab target SHA when available', async () => {
    jest.resetModules();

    const execSync = jest.fn();
    jest.doMock('child_process', () => ({ execSync }));

    process.env.CI_MERGE_REQUEST_TARGET_BRANCH_SHA = 'abc123abc123abc123abc123abc123abc123abc1';

    const fixedNow = 1730000000002;
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    const { runCoverageAnalysis } = require('../lib/coverage.js');

    execSync.mockImplementation(() => {
      const reportPath = path.join(process.cwd(), `.scry-coverage-report-${fixedNow}.json`);
      fs.writeFileSync(
        reportPath,
        JSON.stringify({ summary: { metrics: {}, health: {} }, qualityGate: {}, generatedAt: 'x' })
      );
    });

    await runCoverageAnalysis({ storybookDir: './storybook-static', baseBranch: 'main' });

    const calledCommand = execSync.mock.calls[0][0];
    expect(calledCommand).toContain('--base');
    expect(calledCommand).toContain('abc123abc123abc123abc123abc123abc123abc1');
  });

  test('runCoverageAnalysis() uses Bitbucket destination SHA when available', async () => {
    jest.resetModules();

    const execSync = jest.fn();
    jest.doMock('child_process', () => ({ execSync }));

    process.env.BITBUCKET_PR_DESTINATION_COMMIT = 'bbd00fbbd00fbbd00fbbd00fbbd00fbbd00fbbd0';

    const fixedNow = 1730000000003;
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    const { runCoverageAnalysis } = require('../lib/coverage.js');

    execSync.mockImplementation(() => {
      const reportPath = path.join(process.cwd(), `.scry-coverage-report-${fixedNow}.json`);
      fs.writeFileSync(
        reportPath,
        JSON.stringify({ summary: { metrics: {}, health: {} }, qualityGate: {}, generatedAt: 'x' })
      );
    });

    await runCoverageAnalysis({ storybookDir: './storybook-static', baseBranch: 'main' });

    const calledCommand = execSync.mock.calls[0][0];
    expect(calledCommand).toContain('--base');
    expect(calledCommand).toContain('bbd00fbbd00fbbd00fbbd00fbbd00fbbd00fbbd0');
  });
});
