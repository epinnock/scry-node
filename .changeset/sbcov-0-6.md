---
"@scrymore/scry-deployer": minor
---

Bump `@scrymore/scry-sbcov` to ^0.6.0: `--with-analysis` now captures each story at 2× and crops it to the component (`[data-scry-root]`, else `#storybook-root > :first-child`) by default, and each story's metadata.json `capture` block records `scale`, `root_found` and `sbcov_version`. Projects that set `captureMode` / `captureScale` themselves (sbcov config, `.storybook-deployer.json`, `SCRY_CAPTURE_*` or `--capture-*`) keep their values; set `captureMode: 'viewport', captureScale: 1` to keep the old whole-window 1× screenshots.
