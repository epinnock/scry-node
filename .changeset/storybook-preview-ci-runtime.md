---
"@scrymore/scry-deployer": minor
---

**Every deploy now says how much CI time Scry took, warns when story execution is over budget, and records the time with the build** (ISSUES.md #54).

What went wrong before: a 461-story Storybook preview spent 19-21 minutes rendering stories one at a time (40 dialogs waited 15 s each), used 61% of an account's GitHub Actions minutes in a month, and nothing in the run said so. No line gave the execution time, no workflow set `timeout-minutes`, and the build recorded no time at all.

What you see now:

- A duration line after the capture: `Story execution: 461 stories in 3.5 min (4 workers), budget 5.8 min.`
- Over the budget (`120 s + 0.5 s × declared stories`; change it with `SCRY_EXECUTE_BUDGET_BASE_S` / `SCRY_EXECUTE_BUDGET_PER_STORY_S`), a `::warning::` annotation on the run naming the time, the budget and where it went. A warning only: the exit code does not change.
- The build records its CI timings (analyze, execute, archive, upload and deployer total; story counts; time lost per reason; sbcov and deployer versions; runner kind; Actions run id and attempt; budget). Anything that could not be measured is left out, never sent as 0. The first part rides on the existing build request; the final record goes to a new upload-service route. An upload service without that route is told apart from an error: `the upload service does not record CI timings yet; not stored`, once, and the deploy result is unchanged.
- Whole-job time, when the job may read Actions (`permissions: actions: read`) and `GITHUB_TOKEN` is passed: `CI time recorded: deployer 4.4 min, job 6.1 min so far (Actions API).` Otherwise `deployer time only (job start unknown: <reason>)`. This never fails a deploy.
- `SCRY_CONCURRENCY` and `SCRY_RENDER_TIMEOUT_MS` (or `concurrency` / `renderTimeoutMs` in `.storybook-deployer.json`) are forwarded to scry-sbcov 0.6+ as `--concurrency` / `--render-timeout`; with an older scry-sbcov they are not sent and the log says so.
- Generated workflows install `@scrymore/scry-deployer@^0.8.0`, set `timeout-minutes: 20` on the Storybook job and grant `actions: read`. The push workflow had no `permissions` block before; the one it has now lists `contents: read`, `actions: read` and `packages: read`, and every other scope (for example write access your own added steps relied on) is dropped: add what your steps need.
- `timeout-minutes: 20` assumes scry-sbcov 0.6 (four stories at a time, 5 s render limit), which 0.8.0 installs. If you run an older scry-sbcov (`SCRY_SBCOV_CMD`, or your own pin) on a large Storybook, one run can take longer than 20 minutes and be stopped: raise the limit in your workflow.

What you must do:

1. Regenerate your workflows: `npx -y @scrymore/scry-deployer@^0.8.0 update-workflows` (the old `^0.7.0` range does not pick up 0.8.0). If you keep a hand-written workflow, add `timeout-minutes: 20` to the Storybook job, `actions: read` to its `permissions` (a `permissions` block drops every scope it does not list, so keep `contents: read`), and `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` to the deploy step's `env`.
2. Nothing else. Without step 1 the deployer still records its own time and says the job start is unknown.
