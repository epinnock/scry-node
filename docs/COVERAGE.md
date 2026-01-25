# Coverage Analysis & Reporting

`scry-deployer` can run Storybook coverage analysis during deployment (enabled by default), upload the full JSON report, and post a PR comment with a coverage summary.

This feature is powered by [`@scrymore/scry-sbcov`](https://www.npmjs.com/package/@scrymore/scry-sbcov), which is a **direct dependency** of this package (you do not need to install it separately).

---

## What gets produced

When coverage is enabled:

1. `scry-deployer` runs `@scrymore/scry-sbcov` against your built Storybook directory (e.g. `./storybook-static`).
2. The full JSON report is uploaded as `coverage-report.json` alongside your deployment artifacts.
3. A PR comment is created/updated (when running in GitHub Actions and `GITHUB_TOKEN` is available) including:
   - Storybook URL
   - Coverage summary table
   - Quality gate pass/fail

---

## CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--coverage` / `--no-coverage` | enabled | Enable/disable running coverage during deployment |
| `--coverage-report <path>` | - | Use an existing report file (skips running the analyzer) |
| `--coverage-fail-on-threshold` | false | Fail the deployment if the coverage tool reports failing thresholds (`--ci`) |
| `--coverage-base <branch>` | `main` | Base branch used for new-code analysis (uses `origin/<branch>` unless a PR base SHA is provided by CI) |

Examples:

```bash
# Default: coverage enabled
npx @scrymore/scry-deployer --dir ./storybook-static

# Disable coverage
npx @scrymore/scry-deployer --dir ./storybook-static --no-coverage

# Use a pre-generated report
npx @scrymore/scry-deployer --dir ./storybook-static --coverage-report ./.scry-coverage-report.json

# Enforce thresholds
npx @scrymore/scry-deployer --dir ./storybook-static --coverage-fail-on-threshold
```

---

## Environment variables

These variables can be set in CI:

| Variable | Default | Description |
|----------|---------|-------------|
| `SCRY_COVERAGE_ENABLED` | `true` | Set to `false` to disable coverage |
| `SCRY_COVERAGE_FAIL_ON_THRESHOLD` | `false` | Set to `true` to fail if thresholds not met |
| `SCRY_COVERAGE_BASE` | `main` | Base branch for new-code analysis (used when no PR base SHA is provided by CI) |
| `SCRY_COVERAGE_REPORT` | - | Path to an existing JSON report (skips analysis) |

For accurate PR new-story analysis, ensure your CI runner provides a PR base SHA (for example, GitHub Actions uses `GITHUB_EVENT_PATH` with `pull_request.base.sha`).

---

## GitHub Actions requirements

### `fetch-depth: 0`

`@scrymore/scry-sbcov` uses git history for new-code analysis. GitHub Actions defaults to a shallow clone (`fetch-depth: 1`), which is insufficient.

Always use:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

### PR comments

To post PR comments from the CLI:

- Ensure the workflow job has `pull-requests: write` permission.
- Ensure `GITHUB_TOKEN` is available in the deploy step environment.

---

## Troubleshooting

### Coverage fails but I don't want deployments to fail

Use default behavior (do not pass `--coverage-fail-on-threshold`). The CLI will attempt analysis and continue if the coverage tool exits non-zero.

### Coverage tool is slow

Consider:

- Disabling coverage for draft PRs (`--no-coverage`)
- Running coverage in a separate job if you want to parallelize builds

---

## Implementation notes

- The full coverage report is generated to a temporary JSON file and deleted after parsing.
- The PR comment uses a stable marker (`<!-- scry-deployer -->`) and is updated instead of creating duplicates.

### Coverage upload flow

Coverage is uploaded via the dedicated coverage attach endpoint (`POST /upload/:project/:version/coverage`) rather than using presigned URLs. This ensures:

1. **Single build per version**: Only the Storybook ZIP upload creates a Firestore build record. Coverage is attached to that existing build.
2. **Atomic operation**: The coverage JSON is uploaded to R2 storage and the normalized coverage data is attached to the build in a single API call.
3. **Validation**: The server can validate and normalize the coverage data before storing it.

The flow is:
1. CLI requests presigned URL for `storybook.zip` → Build created in Firestore
2. CLI uploads ZIP to R2 via presigned URL
3. CLI posts coverage JSON to `/upload/:project/:version/coverage` → Coverage attached to existing build
