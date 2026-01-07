const fs = require('fs');
const path = require('path');

describe('lib/coverage', () => {
  afterEach(() => {
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
});
