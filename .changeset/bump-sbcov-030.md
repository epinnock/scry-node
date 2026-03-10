---
"@scrymore/scry-deployer": minor
---

Enable build processing service integration by default in generated workflows

- Bump @scrymore/scry-sbcov dependency to ^0.3.0 for screenshot-metadata ZIP support
- Generated GitHub Actions workflows now include `--with-analysis` flag by default
- To disable, set env var `STORYBOOK_DEPLOYER_WITH_ANALYSIS=false` or remove the flag from workflow
