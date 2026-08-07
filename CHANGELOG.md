# Changelog

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
