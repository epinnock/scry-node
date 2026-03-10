const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

/**
 * @typedef {Object} RunCoverageOptions
 * @property {string} storybookDir Path to a built Storybook static directory (e.g. ./storybook-static)
 * @property {string} [baseBranch='main'] Base branch name to compare for "new code" analysis
 * @property {boolean} [failOnThreshold=false] If true, pass "--ci" to the coverage tool and rethrow errors
 * @property {string} [outputPath] If provided, write the report to this path (relative to cwd allowed)
 * @property {boolean} [keepReport=false] If true, do not delete the output file after reading
 * @property {boolean} [screenshots=false] Enable passing-story screenshots in scry-sbcov
 * @property {string|null} [outputZipPath=null] Where to write metadata+screenshots ZIP
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
 * If the underlying tool fails and `failOnThreshold` is false, returns
 * `{ report: null, metadataZipPath: null }`.
 *
 * @param {RunCoverageOptions} options
 * @returns {Promise<{report:any|null, metadataZipPath:string|null}>}
 */
async function runCoverageAnalysis(options) {
  const {
    storybookDir,
    baseBranch = 'main',
    failOnThreshold = false,
    execute = false,
    outputPath: providedOutputPath,
    keepReport = false,
    screenshots = false,
    outputZipPath = null,
  } = options || {};

  if (!storybookDir || typeof storybookDir !== 'string') {
    throw new Error('runCoverageAnalysis: options.storybookDir is required');
  }

  console.log(chalk.blue('Running Storybook coverage analysis...'));

  const outputPath = providedOutputPath
    ? (path.isAbsolute(providedOutputPath) ? providedOutputPath : path.resolve(process.cwd(), providedOutputPath))
    : path.join(process.cwd(), `.scry-coverage-report-${Date.now()}.json`);

  const resolvedBaseRef = resolveCoverageBaseRef(baseBranch);

  /** @type {string[]} */
  const cliArgs = [
    '--storybook-static',
    storybookDir,
    '--output',
    outputPath,
    '--base',
    normalizeGitBaseRef(resolvedBaseRef),
    '--verbose', // Enable verbose logging to debug component detection
  ];

  if (failOnThreshold) {
    cliArgs.push('--ci');
  }

  if (execute || screenshots) {
    cliArgs.push('--execute');
  }
  if (screenshots) {
    cliArgs.push('--screenshots');
    if (outputZipPath) {
      cliArgs.push('--output-zip', outputZipPath);
    }
  }

  // Allow local override for E2E testing before package publication.
  // Example:
  //   SCRY_SBCOV_CMD="node /abs/path/to/scry-sbcov/dist/cli/index.js"
  //
  // Default: resolve the CLI from the installed dependency to avoid npx cache
  // issues where `npx -y` might resolve a stale older version.
  let defaultSbcovCmd = 'npx -y @scrymore/scry-sbcov';
  try {
    const sbcovCli = require.resolve('@scrymore/scry-sbcov/dist/cli/index.js');
    defaultSbcovCmd = `node ${shellEscape(sbcovCli)}`;
  } catch (error) {
    // Fall back to npx if resolve fails (e.g. not installed as dependency)
    if (error.code !== 'MODULE_NOT_FOUND') {
      console.warn('[scry-deployer] Unexpected error resolving @scrymore/scry-sbcov, falling back to npx:', error);
    }
  }
  const sbcovCommandPrefix = (process.env.SCRY_SBCOV_CMD || defaultSbcovCmd).trim();
  const npxCommand = `${sbcovCommandPrefix} ${cliArgs.map(shellEscape).join(' ')}`;

  // Debug logging to show the exact command being executed
  console.log(chalk.yellow('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.yellow('DEBUG: Executing coverage command:'));
  console.log(chalk.gray(npxCommand));
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

    execSync(npxCommand, {
      stdio: 'inherit',
      cwd: projectRoot // Run from the project root, not scry-node directory
    });

    const raw = fs.readFileSync(outputPath, 'utf-8');
    const report = JSON.parse(raw);
    const metadataZipPath = (screenshots && outputZipPath && fs.existsSync(outputZipPath))
      ? outputZipPath
      : null;

    if (!keepReport && !providedOutputPath) safeUnlink(outputPath);
    return { report, metadataZipPath };
  } catch (error) {
    if (!keepReport && !providedOutputPath) safeUnlink(outputPath);
    if (failOnThreshold) throw error;
    return { report: null, metadataZipPath: null };
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



/**
 * Normalize a user-supplied base ref into something git understands.
 *
 * Why this exists:
 * - In CI, the best base for "push" is often a SHA (e.g. github.event.before)
 * - In PRs, the best base is often a remote-tracking branch (e.g. origin/main)
 * - Locally, users may pass branch names (e.g. main) or rev expressions (e.g. HEAD~1)
 *
 * `scry-sbcov` expects a value it can pass to git commands as the base reference.
 *
 * @param {string} baseBranch
 * @returns {string}
 */
function normalizeGitBaseRef(baseBranch) {
  const value = (baseBranch || '').trim();

  if (!value) return 'origin/main';

  // Commit SHA (short or full)
  if (/^[0-9a-f]{7,40}$/i.test(value)) return value;

  // Common rev expressions that should not be prefixed.
  if (value === 'HEAD' || value.startsWith('HEAD~') || value.startsWith('HEAD^')) return value;
  if (/[~^]/.test(value)) return value;

  // If user already provided a qualified ref, use it as-is.
  if (value.startsWith('origin/')) return value;
  if (value.startsWith('refs/')) return value;
  if (value.startsWith('remotes/')) return value;

  // Otherwise, treat it as a branch name and compare against the remote.
  // This also works for branch names that contain slashes (e.g. feature/foo).
  return `origin/${value}`;
}

/**
 * Resolve the base ref to pass into `scry-sbcov`, preferring PR base SHAs
 * from CI providers when available.
 *
 * @param {string} baseBranch
 * @returns {string}
 */
function resolveCoverageBaseRef(baseBranch) {
  const env = process.env || {};

  const githubBaseSha = readGithubPullRequestBaseSha(env.GITHUB_EVENT_PATH);
  if (githubBaseSha) return githubBaseSha;

  const gitlabBaseSha = env.CI_MERGE_REQUEST_TARGET_BRANCH_SHA;
  if (gitlabBaseSha) return gitlabBaseSha;

  const bitbucketBaseSha = env.BITBUCKET_PR_DESTINATION_COMMIT || env.BITBUCKET_PR_BASE_COMMIT;
  if (bitbucketBaseSha) return bitbucketBaseSha;

  return baseBranch || 'main';
}

/**
 * Read GitHub pull_request base.sha from the event payload.
 *
 * @param {string|undefined} eventPath
 * @returns {string|null}
 */
function readGithubPullRequestBaseSha(eventPath) {
  if (!eventPath || typeof eventPath !== 'string') return null;

  try {
    if (!fs.existsSync(eventPath)) return null;
    const raw = fs.readFileSync(eventPath, 'utf-8');
    const payload = JSON.parse(raw);
    const baseSha = payload?.pull_request?.base?.sha;
    if (typeof baseSha === 'string' && baseSha.trim()) return baseSha.trim();
    return null;
  } catch (error) {
    return null;
  }
}

module.exports = {
  runCoverageAnalysis,
  loadCoverageReport,
  extractCoverageSummary,
  normalizeGitBaseRef,
  resolveCoverageBaseRef,
  readGithubPullRequestBaseSha,
};
