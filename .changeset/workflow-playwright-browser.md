---
"@scrymore/scry-deployer": patch
---

The GitHub Actions workflow `scry init` generates now installs a browser.

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
