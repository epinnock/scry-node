const { resolveBuildGitContext } = require('../lib/gitContext.js');

// P13a: the build document's commitSha is what lets a search result name the
// commit a component came from. `versionId` cannot — it is a PR number, a
// branch, a tag or a short SHA depending on which CI event fired.
describe('lib/gitContext', () => {
  const REPO = process.cwd();

  test('prefers the CI commit and pull-request head branch over the checkout', () => {
    // actions/checkout leaves a detached HEAD, and on a pull request the
    // checked-out commit is a synthetic merge commit that exists only in that
    // run. GITHUB_SHA and GITHUB_HEAD_REF are what a human can look up.
    const context = resolveBuildGitContext({
      cwd: REPO,
      env: {
        GITHUB_SHA: 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1',
        GITHUB_HEAD_REF: 'feature/login',
        GITHUB_REF_NAME: '17/merge',
      },
    });

    expect(context).toEqual({
      commitSha: 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1',
      branch: 'feature/login',
    });
  });

  test('SCRY_COMMIT_SHA and SCRY_BRANCH win, for a CI system we do not know', () => {
    const context = resolveBuildGitContext({
      cwd: REPO,
      env: {
        SCRY_COMMIT_SHA: 'aaaa1111',
        SCRY_BRANCH: 'release',
        GITHUB_SHA: 'c1c1c1c1',
        GITHUB_REF_NAME: 'main',
      },
    });

    expect(context).toEqual({ commitSha: 'aaaa1111', branch: 'release' });
  });

  test('falls back to the working copy outside CI', () => {
    const context = resolveBuildGitContext({ cwd: REPO, env: {} });

    // This test runs inside the repository, so both are knowable.
    expect(context.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof context.branch).toBe('string');
  });

  test('omits both members outside a git checkout rather than sending empties', () => {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scry-nogit-'));

    try {
      // An empty string would reach the build document and read as a commit
      // nobody can look up; absent makes search report freshness as unknown,
      // which is true.
      expect(resolveBuildGitContext({ cwd: dir, env: {} })).toEqual({});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
