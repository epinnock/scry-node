# Changelog

## 0.5.0

### Minor Changes

- 7819a50: A deploy that was asked for `--with-analysis` now fails when analysis produces
  nothing.

  Previously it printed `✅ Upload successful!` and exited 0. No metadata archive
  meant nothing was queued, so no component ever became searchable — and because
  the indexing notice only prints when metadata _was_ sent, there was no output at
  all to distinguish it from a healthy run. CI stayed green. The first sign of
  trouble was search returning nothing, days later.

  **This is a behaviour change:** the command now exits non-zero in that state. The
  Storybook is still uploaded and hosted, so "failure" overstates it slightly — but
  the job asked for was to make components searchable, and a green build there means
  search silently returns nothing.

  Common causes, both seen in practice: a missing Playwright browser (fixed for
  generated workflows in 0.4.1), and a TypeScript resolution error in the analyzer
  on a plain `npm install` tree.

## 0.4.1

### Patch Changes

- a6ce9b3: `scry init` no longer reports success for steps that failed.

  Setting up a real repository end to end produced "✅ Changes committed and pushed"
  and "✅ Repository secret (SCRY_API_KEY)" while having done neither. CI then failed
  at the deploy step with no credentials, and the only clue was a warning printed
  twenty lines above the success banner that contradicted it.

  Three fixes:

  - **`git add` no longer aborts the commit.** It throws on a `.gitignore`'d path, and
    one throw skipped the workflow files entirely. A leftover `.storybook-deployer.json`
    ignore rule from the pre-0.4.0 workaround was enough to prevent CI ever being set up.
  - **`gh variable` is no longer assumed.** It arrived in gh 2.21; Ubuntu 22.04 ships
    2.4.0. On older `gh` the first call threw and the secret after it was never reached,
    leaving the repository with no variables _and_ no secret. There is now a capability
    check and a `gh api` fallback.
  - **The closing summary reports what happened**, including a distinct message for
    "not attempted" when GitHub setup was skipped.

- 92bc27e: The GitHub Actions workflow `scry init` generates now installs a browser.

  Without it, screenshot capture failed for every story, no metadata archive was
  produced, and **nothing was ever indexed** — while the deploy exited 0 and the
  workflow went green. Proved on a real repository: CI passed and the project
  recorded `storybook_uploaded` and nothing else.

  The install command follows the project's package manager. `npx` is not safe to
  assume: under pnpm it resolves against the pnpm-managed environment and reports
  `playwright: not found` (exit 127) even with `--yes`.

  **If you ran `scry init` before this release, add the step by hand** before your
  deploy step, or re-run `init` — otherwise CI will keep passing without indexing
  anything.

## 0.4.0

### Minor Changes

- b609957: `scry init` no longer writes your API key into the committed config file.

  `--commit-api-key` described itself as "not recommended" and defaulted to true, so
  every `init` wrote the key into `.storybook-deployer.json` and committed it. The
  copy was never load-bearing: `init` already stores the key as the `SCRY_API_KEY`
  GitHub secret and the workflow it generates reads it from there.

  Passing `--no-commit-api-key` did not help either — the key was written regardless,
  and the `.gitignore` entry it added never matched, because `#` only starts a comment
  at the beginning of a line in `.gitignore`.

  The default is now false and the escape hatch still exists behind an explicit
  `--commit-api-key`. For local runs, export `SCRY_API_KEY` instead.

  **If you ran an earlier version, rotate that project's API key** — git history keeps
  it after the file is changed.

## 0.3.2

### Patch Changes

- 6b9727b: Stop sending credentials to error reporting, and document the reporting.

  The CLI already reported errors to Sentry, and it was sending three things it
  should not have. `scope.setExtra('argv', argv)` shipped the whole parsed argv,
  which contains `--api-key` under both `apiKey` and `api-key` — so every failed
  deploy carried the customer's project credential to a third party. Upload errors
  quote the presigned URL in full, including `X-Amz-Signature`, which is a
  time-limited write credential for the bucket. Stack frames carried absolute paths
  containing usernames and, often, unreleased product names.

  Reporting now uses an allowlist of argv fields rather than the whole object, so a
  newly added option is invisible to telemetry until someone opts it in — the
  reverse, remembering to exclude each new secret, is exactly how the API key got
  through. Messages, exception values and extras are scrubbed for presigned query
  strings, `scry_proj_` keys and bearer tokens, and stack frames are reduced to
  basenames.

  Adds an opt-out. `SCRY_TELEMETRY=0` and the cross-tool `DO_NOT_TRACK=1` are both
  honoured, including in CI. The README now documents what is and is not sent;
  previously nothing disclosed that the CLI reported at all.

  Traces are no longer sampled from customer machines — errors only.

## 0.3.1

### Patch Changes

- 929c228: Retry the deploy upload on transient network failures.

  The presigned-URL request and the R2 upload were both single-shot, so a momentary
  DNS hiccup or connection reset discarded the several minutes of screenshot capture
  that had already succeeded. Six consecutive real deploys failed this way in one
  afternoon, each with `EAI_AGAIN` or `ECONNRESET` at the final step.

  Both calls now retry up to four times with exponential backoff, and only on
  conditions a later attempt can survive (network-level errors, 429, and 5xx) —
  a 4xx still fails immediately rather than delaying the error the user needs to
  see. Each retry re-requests the presigned URL, since those are signed at request
  time and would otherwise expire into a confusing signature error. Retries are
  logged at info level so a recovering deploy is not mistaken for a hung one.

## 0.3.0

### Minor Changes

- ab03139: Stop reporting indexing the deployer cannot confirm.

  Uploading is synchronous; indexing is not. The command printed
  `🎉 Deployment successful! 🎉` immediately after upload, so a build that failed
  in the processing queue seconds later still looked like a success. In one run
  the pipeline died 7s after this message on a revoked credential, and nothing in
  the output said so — the failure only surfaced much later, as an empty search.

  The final message is now `✅ Upload complete.`, followed by an explicit note
  that indexing is queued but unverified and that components are not searchable
  until it finishes. If metadata uploaded but was _not_ queued, that is called out
  as a warning: the Storybook is hosted, but nothing is being indexed.

  Also adds a `warn` level to the logger, which previously had only
  `info`/`success`/`error`/`debug`.

## 0.2.2

### Patch Changes

- a1a8178: Fix TypeError crash when metadata ZIP upload fails (logger.warn → logger.error)

## 0.2.1

### Patch Changes

- 481f52d: Fix: resolve scry-sbcov CLI from installed dependency instead of npx cache

  Prevents CI from using a stale cached version of @scrymore/scry-sbcov that
  doesn't support --screenshots. Falls back to npx if the resolve fails.

## 0.2.0

### Minor Changes

- a671ab2: Enable build processing service integration by default in generated workflows

  - Bump @scrymore/scry-sbcov dependency to ^0.3.0 for screenshot-metadata ZIP support
  - Generated GitHub Actions workflows now include `--with-analysis` flag by default
  - To disable, set env var `STORYBOOK_DEPLOYER_WITH_ANALYSIS=false` or remove the flag from workflow

## 0.1.1

### Patch Changes

- a671ab2: Bump @scrymore/scry-sbcov dependency to ^0.3.0 for screenshot-metadata zip support

## 0.1.0

### Minor Changes

- 87ed4ab: Changed `--coverage-execute` to be enabled by default in workflow templates

  **Breaking Change for Workflow Templates:**

  - Coverage execution is now **enabled by default** in generated GitHub Actions workflows
  - To disable, set repository variable `SCRY_COVERAGE_EXECUTE=false`

  **Upgrade Instructions:**
  Users who have already run `npx @scrymore/scry-deployer init` should run:

  ```bash
  npx @scrymore/scry-deployer update-workflows
  ```

  This will regenerate the workflow files with the new defaults.

## 0.0.7

### Patch Changes

- 0db40eb: Update @scrymore/scry-sbcov dependency to ^0.2.2 minimum

## 0.0.6

### Patch Changes

- Add Sentry integration for error tracking and update @scrymore/scry-sbcov dependency

## 0.0.5

### Patch Changes

- 6505a2c: Update @scrymore/scry-sbcov dependency to ^0.2.1 minimum and remove local linking

## 0.0.4

### Patch Changes

- [#7](https://github.com/epinnock/scry-node/pull/7) [`4e32596`](https://github.com/epinnock/scry-node/commit/4e32596bfe8c34d3d09bc1223fe90edb1ee619f7) Thanks [@epinnock](https://github.com/epinnock)! - fix: update the view link

## 0.0.3

### Patch Changes

- [#4](https://github.com/epinnock/scry-node/pull/4) [`5f124ef`](https://github.com/epinnock/scry-node/commit/5f124ef90d575f9956c2fa32a389bd101a4feb1a) Thanks [@epinnock](https://github.com/epinnock)! - update docs

## 0.0.2

### Patch Changes

- [`734fc67`](https://github.com/epinnock/scry-node/commit/734fc67a69ff70dbf556ba27029a0cf8ce4f882b) Thanks [@epinnock](https://github.com/epinnock)! - Initial release

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- Changesets will automatically update this file when releases are made -->

## [0.0.1] - Initial Release

### Added

- Initial release of `@scrymore/scry-deployer`
- CLI for deploying Storybook static builds
- Support for automated screenshot capture with storycap
- GitHub Actions workflow templates for PR previews and production deployments
- Configuration via environment variables and config files
