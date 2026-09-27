# Workflow templates

Copies of the two GitHub Actions workflows that `scry-deployer init` and
`scry-deployer update-workflows` write, generated from `lib/templates.js` for an
npm project whose Storybook build script is `build-storybook`. They are
reference copies, not active workflows, and are not shipped in the npm package.

Do not edit them by hand. Change `lib/templates.js`, then run:

```bash
node scripts/regenerate-workflow-templates.js
```

`test/templates.test.js` fails when these files differ from the generator.

## What the workflows do

- Install `@scrymore/scry-deployer@^0.9.0` into `$RUNNER_TEMP/scry`, outside the
  checkout, so the repo's own pin or lockfile cannot choose an older deployer
  and a pnpm or yarn `node_modules` is left alone.
- Install the Playwright browser with **that deployer's own Playwright**
  (`npx --no-install playwright install --with-deps chromium-headless-shell` in
  `$RUNNER_TEMP/scry`), cached by its Playwright version, so the browser build
  is the one the analyzer launches.
- Run that deployer with `--with-analysis`. It exits 1 when the build was asked
  to index and nothing will be indexed.
- Bound the job with `timeout-minutes: 20` and grant `actions: read` (plus
  `contents: read`) so the deployer can record the whole job's CI time from the
  Actions API; see the main README, "CI time".
- `deploy-pr-preview.yml` skips draft PRs, deploys when a PR is marked ready,
  and cancels a superseded run for the same PR (`concurrency`
  `storybook-pr-<number>`).

## Repository settings they read

- `SCRY_API_KEY` (secret), `SCRY_API_URL`, `SCRY_PROJECT_ID` (variables)
- Optional variables: `SCRY_COVERAGE_ENABLED`, `SCRY_COVERAGE_FAIL_ON_THRESHOLD`,
  `SCRY_COVERAGE_EXECUTE`, `SCRY_COVERAGE_BASE`, `SCRY_VIEW_URL`,
  `SCRY_MAX_DROPPED` (stories allowed to fail capture before the deploy ends red; default 0),
  `SCRY_CONCURRENCY`, `SCRY_RENDER_TIMEOUT_MS` (scry-sbcov 0.7+),
  `SCRY_EXECUTE_BUDGET_BASE_S`, `SCRY_EXECUTE_BUDGET_PER_STORY_S` (story execution budget; over it = a warning)

To refresh a project's workflows to the current templates:

```bash
npx -y @scrymore/scry-deployer@^0.9.0 update-workflows
```
