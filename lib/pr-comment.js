const { Octokit } = require('@octokit/rest');

const COMMENT_MARKER = '<!-- scry-deployer -->';

/**
 * Post (create or update) a PR comment with deployment and optional coverage info.
 *
 * This function is no-op unless:
 * - `GITHUB_TOKEN` is set
 * - The workflow context includes a pull request number
 *
 * @param {object} deployResult
 * @param {any|null} coverageSummary Coverage summary (typically from extractCoverageSummary())
 * @returns {Promise<void>}
 */
async function postPRComment(deployResult, coverageSummary) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return;

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const event = require(eventPath);
  const prNumber = event.pull_request?.number;
  if (!prNumber) return;

  const repoFull = process.env.GITHUB_REPOSITORY;
  if (!repoFull || !repoFull.includes('/')) return;

  const [owner, repo] = repoFull.split('/');
  const octokit = new Octokit({ auth: token });

  const body = formatPRComment(deployResult, coverageSummary);

  // Upsert: update existing marker comment if present, else create new
  const existing = await findExistingMarkerComment(octokit, owner, repo, prNumber);

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }
}

/**
 * Build a deterministic markdown comment body.
 *
 * @param {object} deployResult
 * @param {any|null} coverageSummary
 * @returns {string}
 */
function formatPRComment(deployResult, coverageSummary) {
  const viewUrl = deployResult?.viewUrl;
  const coveragePageUrl = deployResult?.coveragePageUrl || deployResult?.coverageUrl;

  let body = `${COMMENT_MARKER}
## Storybook Deployed

${viewUrl ? `[View Storybook](${viewUrl})` : 'Storybook deployed successfully.'}`;

  if (coverageSummary) {
    const qualityGate = coverageSummary.qualityGate;
    const passed = Boolean(qualityGate?.passed);
    const statusIcon = passed ? '✅' : '❌';

    const m = coverageSummary.summary;

    body += `

---

## Coverage Report

| Metric | Value |
|--------|-------|
| Component Coverage | ${formatPercent(m?.componentCoverage)} |
| Prop Coverage | ${formatPercent(m?.propCoverage)} |
| Variant Coverage | ${formatPercent(m?.variantCoverage)} |
| Pass Rate | ${formatPercent(m?.passRate)} |

**Quality Gate:** ${statusIcon} ${passed ? 'PASSED' : 'FAILED'}`;

    if (coveragePageUrl) {
      body += `

[View Coverage Report](${coveragePageUrl})`;
    }
  }

  return body;
}

/**
 * Find a previously-posted comment containing our marker.
 *
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {number} prNumber
 */
async function findExistingMarkerComment(octokit, owner, repo, prNumber) {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  return comments.find((c) => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER)) || null;
}

/**
 * @param {number|undefined|null} value
 */
function formatPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return `${value.toFixed(1)}%`;
}

module.exports = {
  postPRComment,
  formatPRComment,
  findExistingMarkerComment,
  COMMENT_MARKER,
};
