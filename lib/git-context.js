const { execSync } = require('child_process');
const fs = require('fs');

/**
 * @typedef {Object} GitContext
 * @property {string|null} commitSha - Full commit SHA
 * @property {string|null} branch - Branch name
 * @property {string|null} buildUrl - CI build URL
 * @property {string|null} buildId - CI build/run ID
 * @property {number|null} prNumber - Pull request number
 * @property {string|null} commitUrl - Direct link to commit
 */

/**
 * Extract git context from GitHub Actions environment.
 *
 * @returns {GitContext}
 */
function extractGitHubContext() {
  const env = process.env;

  if (!env.GITHUB_ACTIONS) {
    return {};
  }

  const context = {};

  // Commit SHA
  if (env.GITHUB_SHA) {
    context.commitSha = env.GITHUB_SHA;
  }

  // Branch name - prefer GITHUB_REF_NAME, fall back to parsing GITHUB_REF
  if (env.GITHUB_REF_NAME) {
    context.branch = env.GITHUB_REF_NAME;
  } else if (env.GITHUB_REF) {
    const ref = env.GITHUB_REF;
    if (ref.startsWith('refs/heads/')) {
      context.branch = ref.replace('refs/heads/', '');
    } else if (ref.startsWith('refs/tags/')) {
      context.branch = ref.replace('refs/tags/', '');
    }
  }

  // PR number - parse from GITHUB_REF or read from event payload
  if (env.GITHUB_REF) {
    const prMatch = env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
    if (prMatch && prMatch[1]) {
      context.prNumber = parseInt(prMatch[1], 10);
    }
  }

  // If no PR number from ref, try event payload
  if (!context.prNumber && env.GITHUB_EVENT_PATH) {
    const prFromEvent = readPRNumberFromGitHubEvent(env.GITHUB_EVENT_PATH);
    if (prFromEvent) {
      context.prNumber = prFromEvent;
    }
  }

  // Build ID
  if (env.GITHUB_RUN_ID) {
    context.buildId = env.GITHUB_RUN_ID;
  }

  // Build URL - construct from components
  if (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID) {
    context.buildUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  }

  // Commit URL
  if (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && context.commitSha) {
    context.commitUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/commit/${context.commitSha}`;
  }

  return context;
}

/**
 * Read PR number from GitHub event payload file.
 *
 * @param {string} eventPath - Path to the GitHub event JSON file
 * @returns {number|null}
 */
function readPRNumberFromGitHubEvent(eventPath) {
  if (!eventPath || typeof eventPath !== 'string') {
    return null;
  }

  try {
    if (!fs.existsSync(eventPath)) {
      return null;
    }
    const raw = fs.readFileSync(eventPath, 'utf-8');
    const payload = JSON.parse(raw);
    const prNumber = payload?.pull_request?.number || payload?.number;
    if (typeof prNumber === 'number' && prNumber > 0) {
      return prNumber;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Extract git context from GitLab CI environment.
 *
 * @returns {GitContext}
 */
function extractGitLabContext() {
  const env = process.env;

  // Check for GitLab CI
  if (!env.GITLAB_CI) {
    return {};
  }

  const context = {};

  // Commit SHA
  if (env.CI_COMMIT_SHA) {
    context.commitSha = env.CI_COMMIT_SHA;
  }

  // Branch name
  if (env.CI_COMMIT_REF_NAME) {
    context.branch = env.CI_COMMIT_REF_NAME;
  }

  // Build ID
  if (env.CI_PIPELINE_ID) {
    context.buildId = env.CI_PIPELINE_ID;
  }

  // Build URL
  if (env.CI_PIPELINE_URL) {
    context.buildUrl = env.CI_PIPELINE_URL;
  }

  // PR/MR number
  if (env.CI_MERGE_REQUEST_IID) {
    context.prNumber = parseInt(env.CI_MERGE_REQUEST_IID, 10);
  }

  // Commit URL
  if (env.CI_PROJECT_URL && context.commitSha) {
    context.commitUrl = `${env.CI_PROJECT_URL}/-/commit/${context.commitSha}`;
  }

  return context;
}

/**
 * Extract git context from Bitbucket Pipelines environment.
 *
 * @returns {GitContext}
 */
function extractBitbucketContext() {
  const env = process.env;

  // Check for Bitbucket Pipelines
  if (!env.BITBUCKET_BUILD_NUMBER) {
    return {};
  }

  const context = {};

  // Commit SHA
  if (env.BITBUCKET_COMMIT) {
    context.commitSha = env.BITBUCKET_COMMIT;
  }

  // Branch name
  if (env.BITBUCKET_BRANCH) {
    context.branch = env.BITBUCKET_BRANCH;
  }

  // Build ID
  if (env.BITBUCKET_BUILD_NUMBER) {
    context.buildId = env.BITBUCKET_BUILD_NUMBER;
  }

  // PR number
  if (env.BITBUCKET_PR_ID) {
    context.prNumber = parseInt(env.BITBUCKET_PR_ID, 10);
  }

  // Build URL - construct from workspace and repo slug
  if (env.BITBUCKET_WORKSPACE && env.BITBUCKET_REPO_SLUG && env.BITBUCKET_BUILD_NUMBER) {
    context.buildUrl = `https://bitbucket.org/${env.BITBUCKET_WORKSPACE}/${env.BITBUCKET_REPO_SLUG}/pipelines/results/${env.BITBUCKET_BUILD_NUMBER}`;
  }

  // Commit URL
  if (env.BITBUCKET_WORKSPACE && env.BITBUCKET_REPO_SLUG && context.commitSha) {
    context.commitUrl = `https://bitbucket.org/${env.BITBUCKET_WORKSPACE}/${env.BITBUCKET_REPO_SLUG}/commits/${context.commitSha}`;
  }

  return context;
}

/**
 * Extract git context from CircleCI environment.
 *
 * @returns {GitContext}
 */
function extractCircleCIContext() {
  const env = process.env;

  // Check for CircleCI
  if (!env.CIRCLECI) {
    return {};
  }

  const context = {};

  // Commit SHA
  if (env.CIRCLE_SHA1) {
    context.commitSha = env.CIRCLE_SHA1;
  }

  // Branch name
  if (env.CIRCLE_BRANCH) {
    context.branch = env.CIRCLE_BRANCH;
  }

  // Build ID
  if (env.CIRCLE_BUILD_NUM) {
    context.buildId = env.CIRCLE_BUILD_NUM;
  }

  // Build URL
  if (env.CIRCLE_BUILD_URL) {
    context.buildUrl = env.CIRCLE_BUILD_URL;
  }

  // PR number
  if (env.CIRCLE_PR_NUMBER) {
    context.prNumber = parseInt(env.CIRCLE_PR_NUMBER, 10);
  }

  return context;
}

/**
 * Execute a git command and return the output.
 *
 * @param {string} command - Git command to execute
 * @returns {string|null} - Command output or null on failure
 */
function execGitCommand(command) {
  try {
    const result = execSync(command, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch (error) {
    return null;
  }
}

/**
 * Extract git context from local git repository.
 *
 * @returns {GitContext}
 */
function extractLocalGitContext() {
  const context = {};

  // Commit SHA
  const commitSha = execGitCommand('git rev-parse HEAD');
  if (commitSha) {
    context.commitSha = commitSha;
  }

  // Branch name - try multiple methods
  let branch = execGitCommand('git branch --show-current');
  if (!branch) {
    // Fallback for detached HEAD or older git versions
    branch = execGitCommand('git rev-parse --abbrev-ref HEAD');
    if (branch === 'HEAD') {
      // Truly detached HEAD, no branch name available
      branch = null;
    }
  }
  if (branch) {
    context.branch = branch;
  }

  return context;
}

/**
 * Sanitize a branch name for URL safety.
 *
 * @param {string} branch - Raw branch name
 * @returns {string} - URL-safe branch name
 */
function sanitizeBranchName(branch) {
  if (!branch || typeof branch !== 'string') {
    return '';
  }
  // Replace characters that are not URL-safe
  return branch.replace(/[^a-zA-Z0-9-_./]/g, '-');
}

/**
 * Get comprehensive git context from CI environment or local git.
 *
 * Priority order:
 * 1. GitHub Actions
 * 2. GitLab CI
 * 3. Bitbucket Pipelines
 * 4. CircleCI
 * 5. Local git repository
 *
 * @returns {GitContext}
 */
function getGitContext() {
  // Try CI providers in order
  let context = extractGitHubContext();
  if (Object.keys(context).length > 0) {
    return normalizeContext(context);
  }

  context = extractGitLabContext();
  if (Object.keys(context).length > 0) {
    return normalizeContext(context);
  }

  context = extractBitbucketContext();
  if (Object.keys(context).length > 0) {
    return normalizeContext(context);
  }

  context = extractCircleCIContext();
  if (Object.keys(context).length > 0) {
    return normalizeContext(context);
  }

  // Fall back to local git
  context = extractLocalGitContext();
  return normalizeContext(context);
}

/**
 * Normalize context to ensure all fields are present (null if not available).
 *
 * @param {Partial<GitContext>} context
 * @returns {GitContext}
 */
function normalizeContext(context) {
  return {
    commitSha: context.commitSha || null,
    branch: context.branch ? sanitizeBranchName(context.branch) : null,
    buildUrl: context.buildUrl || null,
    buildId: context.buildId || null,
    prNumber: context.prNumber || null,
    commitUrl: context.commitUrl || null,
  };
}

/**
 * Extract CI-specific context (for debugging/logging).
 *
 * @returns {{ provider: string|null, isCI: boolean }}
 */
function extractCIContext() {
  const env = process.env;

  if (env.GITHUB_ACTIONS) {
    return { provider: 'github', isCI: true };
  }
  if (env.GITLAB_CI) {
    return { provider: 'gitlab', isCI: true };
  }
  if (env.BITBUCKET_BUILD_NUMBER) {
    return { provider: 'bitbucket', isCI: true };
  }
  if (env.CIRCLECI) {
    return { provider: 'circleci', isCI: true };
  }
  if (env.CI) {
    return { provider: 'unknown', isCI: true };
  }

  return { provider: null, isCI: false };
}

module.exports = {
  getGitContext,
  extractCIContext,
  extractGitHubContext,
  extractGitLabContext,
  extractBitbucketContext,
  extractCircleCIContext,
  extractLocalGitContext,
  readPRNumberFromGitHubEvent,
  sanitizeBranchName,
  normalizeContext,
  // Exported for testing
  execGitCommand,
};
