---
"@scrymore/scry-deployer": minor
---

A deploy that was asked for `--with-analysis` now fails when analysis produces
nothing.

Previously it printed `✅ Upload successful!` and exited 0. No metadata archive
meant nothing was queued, so no component ever became searchable — and because
the indexing notice only prints when metadata *was* sent, there was no output at
all to distinguish it from a healthy run. CI stayed green. The first sign of
trouble was search returning nothing, days later.

**This is a behaviour change:** the command now exits non-zero in that state. The
Storybook is still uploaded and hosted, so "failure" overstates it slightly — but
the job asked for was to make components searchable, and a green build there means
search silently returns nothing.

Common causes, both seen in practice: a missing Playwright browser (fixed for
generated workflows in 0.4.1), and a TypeScript resolution error in the analyzer
on a plain `npm install` tree.
