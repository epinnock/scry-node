const { execSync } = require('child_process');

/**
 * The commit and branch this build was produced from.
 *
 * Sent alongside the metadata ZIP so the build document records it, which is
 * what lets a search result say which commit a component came from and whether
 * it is from the current build (P13a). Before this, `versionId` — a PR number,
 * a branch name, a tag, or a 7-char SHA depending on the event — was the only
 * provenance a build carried, and none of those identify a commit.
 *
 * Resolution order, most trustworthy first:
 *
 *   1. SCRY_COMMIT_SHA / SCRY_BRANCH, for a CI system this does not know about.
 *   2. GITHUB_SHA / GITHUB_HEAD_REF, because builds come from CI and
 *      `actions/checkout` leaves a detached HEAD: `git rev-parse --abbrev-ref
 *      HEAD` reports "HEAD", and on a pull request GITHUB_REF_NAME is
 *      "17/merge" while GITHUB_HEAD_REF is the branch a human would name.
 *   3. The working copy.
 *
 * Every member is omitted rather than defaulted. An absent commit makes search
 * report freshness as `unknown`, which is true; an empty string would read as a
 * commit that cannot be looked up.
 *
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv}} [options]
 * @returns {{commitSha?: string, branch?: string}}
 */
function resolveBuildGitContext(options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();

  const local = readLocalGit(cwd);

  const commitSha = env.SCRY_COMMIT_SHA || env.GITHUB_SHA || local.commitSha;

  const envBranch = env.SCRY_BRANCH || env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME;
  // "HEAD" is what a detached checkout reports; it names no branch.
  const localBranch = local.branch && local.branch !== 'HEAD' ? local.branch : undefined;
  const branch = envBranch || localBranch;

  return {
    ...(commitSha ? { commitSha } : {}),
    ...(branch ? { branch } : {}),
  };
}

/**
 * Read the working copy's HEAD, or `{}` if this is not a git checkout.
 *
 * Failure here is entirely unremarkable — a deploy from an unpacked tarball has
 * no git — so it is swallowed rather than warned about.
 *
 * @param {string} cwd
 * @returns {{commitSha?: string, branch?: string}}
 */
function readLocalGit(cwd) {
  const run = (args) => {
    try {
      return execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '';
    }
  };

  const commitSha = run('rev-parse HEAD');
  if (!commitSha) return {};

  return {
    commitSha,
    branch: run('rev-parse --abbrev-ref HEAD') || undefined,
  };
}

module.exports = { resolveBuildGitContext };
