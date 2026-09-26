---
"@scrymore/scry-deployer": minor
---

**A deploy that was asked to index but indexes nothing now exits 1** (ISSUES.md #50).

What failed silently before: a rejected metadata upload, an upload that was not queued, an analysis archive with zero stories (it was queued, and the build showed `completed` with nothing in it), a non-zero exit from scry-sbcov, and a workflow that simply forgot `--with-analysis` all printed success and ended green, so nothing was searchable and nobody was told. A repository that pinned an old deployer and ran it with a bare `npx @scrymore/scry-deployer` could not see any of the earlier fixes either.

What you see now:

- `❌ … so NOTHING WILL BE INDEXED.` with the reason, and exit code 1. The Storybook is still uploaded and hosted, so preview links keep working; an empty archive is not uploaded and no build is queued.
- Analysis is **on by default**. `--no-analysis` hosts without indexing and says `this build is hosted but NOT searchable` (exit 0).
- scry-sbcov's exit code is no longer swallowed. If it wrote an archive (exit 3: more stories dropped than `--max-dropped`), the captured stories are queued first and the run still ends red naming the reason; with no archive (exit 2: broken capture config) the run ends red with that cause. **Any story that fails to capture now ends the deploy red** (after the stories that did capture are uploaded and queued): the deployer passes `--max-dropped 0` to scry-sbcov (0.5.2+) and also checks the `sbcov-manifest.json` in the archive. Allow some with `--max-dropped <n>` / `SCRY_MAX_DROPPED` / `maxDropped` in `.storybook-deployer.json`. scry-sbcov exit codes: 0 ok, 2 broken capture config (no archive), 3 more stories dropped than `--max-dropped` (archive of the rest written). With a scry-sbcov older than 0.5.2 the flag is not passed and the log says dropped stories cannot be counted.
- One warning line when the running deployer is older than npm `latest` (2 s limit, never fails the deploy; `SCRY_NO_UPDATE_CHECK=1` turns it off).
- New `update-workflows` command.

What you must do:

1. Regenerate your workflows: `npx -y @scrymore/scry-deployer@^0.7.0 update-workflows` (or copy the steps in the README's "Example CI/CD Integration"). The new workflow installs `@scrymore/scry-deployer@^0.7.0` into its own folder, installs the Playwright browser with that deployer's own Playwright, and runs that deployer, so your repository's pin can no longer pick an old one. The PR workflow now skips drafts and cancels superseded runs.
2. If a workflow had no browser step it will now go red instead of silently indexing nothing: add the browser step (step 1 does it).
3. If you deploy a Storybook you do not want searchable, add `--no-analysis`.
4. If some of your stories are known not to capture and you accept that, set `--max-dropped <n>` (or the `SCRY_MAX_DROPPED` repository variable); otherwise the first dropped story turns the run red.
