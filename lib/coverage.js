const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

/**
 * @typedef {Object} RunCoverageOptions
 * @property {string} storybookDir Path to a built Storybook static directory (e.g. ./storybook-static)
 * @property {string} [baseBranch='main'] Base branch name to compare for "new code" analysis
 * @property {boolean} [failOnThreshold=false] If true, pass "--ci" to the coverage tool and rethrow errors
 */

/**
 * Run Storybook coverage analysis via `@scrymore/scry-sbcov`.
 *
 * Behavior:
 * - Writes a temporary report file in the current working directory
 * - Executes the `@scrymore/scry-sbcov` CLI
 * - Reads and returns the parsed JSON report
 * - Deletes the temporary report file
 *
 * If the underlying tool fails and `failOnThreshold` is false, returns `null`.
 *
 * @param {RunCoverageOptions} options
 * @returns {Promise<any|null>} The full coverage report JSON, or null if skipped/failed (non-fatal)
 */
async function runCoverageAnalysis(options) {
  const { storybookDir, baseBranch = 'main', failOnThreshold = false, execute = false } = options || {};

  if (!storybookDir || typeof storybookDir !== 'string') {
    throw new Error('runCoverageAnalysis: options.storybookDir is required');
  }

  console.log(chalk.blue('Running Storybook coverage analysis...'));

  const outputPath = path.join(process.cwd(), `.scry-coverage-report-${Date.now()}.json`);

  /** @type {string[]} */
  const args = [
    '@scrymore/scry-sbcov',
    '--storybook-static',
    storybookDir,
    '--output',
    outputPath,
    '--base',
    `origin/${baseBranch}`,
    '--verbose', // Enable verbose logging to debug component detection
  ];

  if (failOnThreshold) {
    args.push('--ci');
  }

  if (execute) {
    args.push('--execute');
  }

  // Debug logging to show the exact command being executed
  console.log(chalk.yellow('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.yellow('DEBUG: Executing coverage command:'));
  console.log(chalk.gray(`npx ${args.join(' ')}`));
  console.log(chalk.yellow('Working directory: ' + process.cwd()));
  console.log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  try {
    // Determine the correct working directory
    // If storybookDir is relative, resolve it from cwd
    // Then use its parent directory as the project root
    const absoluteStorybookDir = path.isAbsolute(storybookDir)
      ? storybookDir
      : path.resolve(process.cwd(), storybookDir);
    
    const projectRoot = path.dirname(absoluteStorybookDir);
    
    console.log(chalk.yellow('Project root: ' + projectRoot));
    console.log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    execSync(`npx ${args.map(shellEscape).join(' ')}`, {
      stdio: 'inherit',
      cwd: projectRoot // Run from the project root, not scry-node directory
    });

    const raw = fs.readFileSync(outputPath, 'utf-8');
    const report = JSON.parse(raw);

    safeUnlink(outputPath);
    return report;
  } catch (error) {
    safeUnlink(outputPath);
    if (failOnThreshold) throw error;
    return null;
  }
}

/**
 * Load a coverage report from disk.
 *
 * @param {string} reportPath
 * @returns {any}
 */
function loadCoverageReport(reportPath) {
  if (!reportPath || typeof reportPath !== 'string') {
    throw new Error('loadCoverageReport: reportPath is required');
  }
  const raw = fs.readFileSync(reportPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Extracts a stable, API-friendly subset of the full report.
 *
 * NOTE: This function is intentionally defensive: if the report shape changes,
 * we return `null` instead of throwing to avoid breaking deployments.
 *
 * @param {any|null} report
 * @returns {null|{
 *   reportUrl: string|null,
 *   summary: {
 *     componentCoverage: number,
 *     propCoverage: number,
 *     variantCoverage: number,
 *     passRate: number,
 *     totalComponents: number,
 *     componentsWithStories: number,
 *     failingStories: number
 *   },
 *   qualityGate: any,
 *   generatedAt: string
 * }}
 */
function extractCoverageSummary(report) {
  if (!report) return null;

  try {
    return {
      reportUrl: null,
      summary: {
        componentCoverage: report.summary.metrics.componentCoverage,
        propCoverage: report.summary.metrics.propCoverage,
        variantCoverage: report.summary.metrics.variantCoverage,
        passRate: report.summary.health.passRate,
        totalComponents: report.summary.totalComponents,
        componentsWithStories: report.summary.componentsWithStories,
        failingStories: report.summary.health.failingStories,
      },
      qualityGate: report.qualityGate,
      generatedAt: report.generatedAt,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Best-effort deletion: ignore ENOENT and other fs errors.
 *
 * @param {string} filePath
 */
function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_) {
    // ignore
  }
}

/**
 * Minimal shell escaping for arguments.
 *
 * @param {string} value
 * @returns {string}
 */
function shellEscape(value) {
  if (typeof value !== 'string') return '';
  if (/^[a-zA-Z0-9_\-./:@]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

module.exports = {
  runCoverageAnalysis,
  loadCoverageReport,
  extractCoverageSummary,
};
