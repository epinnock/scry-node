# scry-node implementation plan — PR-base for scry-sbcov

## Goal
Ensure scry-node passes the **PR base SHA** to scry-sbcov so `newStories` reflects parent-of-PR instead of previous build.

## File-by-file plan

### 1) [`scry-node/lib/coverage.js`](scry-node/lib/coverage.js:29)
- Update base-ref selection to prefer PR base SHA when present:
  - GitHub: read `GITHUB_EVENT_PATH` and use `pull_request.base.sha` if available.
  - GitLab: use `CI_MERGE_REQUEST_TARGET_BRANCH_SHA`.
  - Bitbucket: use base SHA env var (if present in your CI environment).
- Fallback: existing `baseBranch` argument (default `main`).
- Ensure `normalizeGitBaseRef()` already accepts SHA values (no change needed).

### 2) Tests — [`scry-node/test/coverage.test.js`](scry-node/test/coverage.test.js:1)
- Add/extend tests to validate:
  - PR base SHA is selected and passed to `--base`.
  - On non-PR builds, `--base` defaults to `origin/main` or provided base branch.
  - If env var is missing, it safely falls back without throwing.

### 3) Documentation touchpoints
- If scry-node has coverage docs (e.g., in `docs/`), add a note:
  - “For accurate PR new-story analysis, ensure the runner provides a PR base SHA.”

## Acceptance criteria
- `runCoverageAnalysis()` passes the correct `--base` ref in PR builds.
- Tests cover PR and non-PR branches.
- No regressions for existing pipelines.
