const fs = require('fs');
const path = require('path');

describe('lib/coverage', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
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

  describe('enhanceReportWithGitContext()', () => {
    beforeEach(() => {
      jest.resetModules();
      process.env = {};
    });

    test('returns null/undefined input unchanged', () => {
      const { enhanceReportWithGitContext } = require('../lib/coverage.js');
      expect(enhanceReportWithGitContext(null)).toBeNull();
      expect(enhanceReportWithGitContext(undefined)).toBeUndefined();
    });

    test('returns non-object input unchanged', () => {
      const { enhanceReportWithGitContext } = require('../lib/coverage.js');
      expect(enhanceReportWithGitContext('string')).toBe('string');
      expect(enhanceReportWithGitContext(123)).toBe(123);
    });

    test('returns report unchanged when no git context available', () => {
      // Mock git commands to fail (no git available)
      jest.doMock('child_process', () => ({
        execSync: jest.fn(() => {
          throw new Error('git not found');
        }),
      }));

      const { enhanceReportWithGitContext } = require('../lib/coverage.js');
      const report = { summary: { test: true } };
      const result = enhanceReportWithGitContext(report);

      expect(result).toEqual(report);
      expect(result.gitContext).toBeUndefined();
    });

    test('adds gitContext when GitHub Actions env vars are set', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_SHA = 'abc123def456';
      process.env.GITHUB_REF_NAME = 'feature/test-branch';
      process.env.GITHUB_RUN_ID = '12345';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.GITHUB_REPOSITORY = 'owner/repo';

      const { enhanceReportWithGitContext } = require('../lib/coverage.js');
      const report = { summary: { test: true } };
      const result = enhanceReportWithGitContext(report);

      expect(result.gitContext).toBeDefined();
      expect(result.gitContext.commitSha).toBe('abc123def456');
      expect(result.gitContext.branch).toBe('feature/test-branch');
      expect(result.gitContext.buildId).toBe('12345');
      expect(result.gitContext.buildUrl).toBe('https://github.com/owner/repo/actions/runs/12345');
      expect(result.gitContext.commitUrl).toBe('https://github.com/owner/repo/commit/abc123def456');
      // Original report fields preserved
      expect(result.summary).toEqual({ test: true });
    });

    test('adds gitContext with PR number when in PR context', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_SHA = 'pr-sha-123';
      process.env.GITHUB_REF = 'refs/pull/42/merge';

      const { enhanceReportWithGitContext } = require('../lib/coverage.js');
      const report = { summary: {} };
      const result = enhanceReportWithGitContext(report);

      expect(result.gitContext).toBeDefined();
      expect(result.gitContext.prNumber).toBe(42);
    });

    test('preserves all original report fields', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_SHA = 'test-sha';

      const { enhanceReportWithGitContext } = require('../lib/coverage.js');
      const report = {
        summary: { metrics: { coverage: 80 } },
        qualityGate: { passed: true },
        generatedAt: '2026-01-01',
        stories: [{ id: 'story-1' }],
      };
      const result = enhanceReportWithGitContext(report);

      expect(result.summary).toEqual(report.summary);
      expect(result.qualityGate).toEqual(report.qualityGate);
      expect(result.generatedAt).toBe(report.generatedAt);
      expect(result.stories).toEqual(report.stories);
      expect(result.gitContext).toBeDefined();
    });
  });

  describe('addFingerprintsToReport()', () => {
    test('returns report unchanged when stories array missing', () => {
      const { addFingerprintsToReport } = require('../lib/coverage.js');
      const report = { summary: { metrics: {} } };

      const result = addFingerprintsToReport(report);
      expect(result).toEqual(report);
    });

    test('adds fingerprint to story when storyId present', () => {
      const { addFingerprintsToReport } = require('../lib/coverage.js');
      const report = {
        stories: [
          { componentPath: 'src/Button.tsx', storyId: 'button--primary', storyName: 'Primary' },
        ],
      };

      const result = addFingerprintsToReport(report);
      expect(result).not.toBe(report);
      expect(result.stories[0].fingerprint).toHaveLength(16);
    });

    test('leaves story unchanged when fingerprint cannot be generated', () => {
      const { addFingerprintsToReport } = require('../lib/coverage.js');
      const story = { componentPath: 'src/Button.tsx' };
      const report = { stories: [story] };

      const result = addFingerprintsToReport(report);
      expect(result.stories[0]).toBe(story);
      expect(result.stories[0].fingerprint).toBeUndefined();
    });
  });

  describe('runCoverageAnalysis() with git context', () => {
    test('includes gitContext in returned report when in CI', async () => {
      jest.resetModules();

      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_SHA = 'ci-commit-sha';
      process.env.GITHUB_REF_NAME = 'main';

      const execSync = jest.fn();
      jest.doMock('child_process', () => ({ execSync }));

      const fixedNow = 1730000000004;
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

      const { runCoverageAnalysis } = require('../lib/coverage.js');

      execSync.mockImplementation(() => {
        const reportPath = path.join(process.cwd(), `.scry-coverage-report-${fixedNow}.json`);
        fs.writeFileSync(
          reportPath,
          JSON.stringify({ summary: { metrics: {}, health: {} }, qualityGate: {}, generatedAt: 'x' })
        );
      });

      const report = await runCoverageAnalysis({ storybookDir: './storybook-static', baseBranch: 'main' });

      expect(report.gitContext).toBeDefined();
      expect(report.gitContext.commitSha).toBe('ci-commit-sha');
      expect(report.gitContext.branch).toBe('main');
    });

    test('adds transitions when previous report path provided', async () => {
      jest.resetModules();

      const execSync = jest.fn();
      jest.doMock('child_process', () => ({ execSync }));

      const fixedNow = 1730000000007;
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

      const { runCoverageAnalysis } = require('../lib/coverage.js');

      const previousPath = path.join(process.cwd(), `prev-report-${fixedNow}.json`);
      fs.writeFileSync(
        previousPath,
        JSON.stringify({
          stories: [
            { fingerprint: 'story-prev', status: 'failing', storyId: 'prev' },
          ],
        })
      );

      execSync.mockImplementation(() => {
        const reportPath = path.join(process.cwd(), `.scry-coverage-report-${fixedNow}.json`);
        fs.writeFileSync(
          reportPath,
          JSON.stringify({
            summary: { metrics: {}, health: {} },
            qualityGate: {},
            generatedAt: 'x',
            stories: [
              { fingerprint: 'story-prev', status: 'passing', storyId: 'prev' },
            ],
          })
        );
      });

      const report = await runCoverageAnalysis({
        storybookDir: './storybook-static',
        baseBranch: 'main',
        previousReportPath: previousPath,
      });

      expect(report.transitions).toBeDefined();
      expect(report.transitions.transitions.fixed).toEqual(['story-prev']);

      fs.unlinkSync(previousPath);
    });
  });

  describe('runCoverageAnalysis() with fingerprints', () => {
    test('adds fingerprints to stories when present in report', async () => {
      jest.resetModules();

      const execSync = jest.fn();
      jest.doMock('child_process', () => ({ execSync }));

      const fixedNow = 1730000000005;
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

      const { runCoverageAnalysis } = require('../lib/coverage.js');

      execSync.mockImplementation(() => {
        const reportPath = path.join(process.cwd(), `.scry-coverage-report-${fixedNow}.json`);
        fs.writeFileSync(
          reportPath,
          JSON.stringify({
            summary: { metrics: {}, health: {} },
            qualityGate: {},
            generatedAt: 'x',
            stories: [
              { componentPath: 'src/Button.tsx', storyId: 'button--primary', storyName: 'Primary' },
            ],
            execution: {
              stories: [
                { componentPath: 'src/Card.tsx', storyId: 'card--default', storyName: 'Default' },
              ],
            },
          })
        );
      });

      const report = await runCoverageAnalysis({ storybookDir: './storybook-static', baseBranch: 'main' });

      expect(report.stories[0].fingerprint).toHaveLength(16);
      expect(report.execution.stories[0].fingerprint).toHaveLength(16);
    });

    test('preserves existing fingerprints from report', async () => {
      jest.resetModules();

      const execSync = jest.fn();
      jest.doMock('child_process', () => ({ execSync }));

      const fixedNow = 1730000000006;
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

      const { runCoverageAnalysis } = require('../lib/coverage.js');

      execSync.mockImplementation(() => {
        const reportPath = path.join(process.cwd(), `.scry-coverage-report-${fixedNow}.json`);
        fs.writeFileSync(
          reportPath,
          JSON.stringify({
            summary: { metrics: {}, health: {} },
            qualityGate: {},
            generatedAt: 'x',
            stories: [
              { componentPath: 'src/Button.tsx', storyId: 'button--primary', storyName: 'Primary', fingerprint: 'abcdef1234567890' },
            ],
          })
        );
      });

      const report = await runCoverageAnalysis({ storybookDir: './storybook-static', baseBranch: 'main' });

      expect(report.stories[0].fingerprint).toBe('abcdef1234567890');
    });
  });
});
