---
"@scrymore/scry-deployer": minor
---

Forward screenshot capture settings to scry-sbcov: `captureMode`, `captureScale` and `captureViewport` from `.storybook-deployer.json`, `SCRY_CAPTURE_MODE` / `SCRY_CAPTURE_SCALE` / `SCRY_CAPTURE_VIEWPORT`, or `--capture-mode` / `--capture-scale` / `--capture-viewport` (deploy and `coverage` commands). Values are validated (enum, number in (0, 4], `WxH`) and only settings you set are passed, so sbcov's own defaults and config file still apply otherwise.
