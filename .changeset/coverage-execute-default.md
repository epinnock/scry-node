---
"@scrymore/scry-deployer": minor
---

Changed `--coverage-execute` to be enabled by default in workflow templates

**Breaking Change for Workflow Templates:**
- Coverage execution is now **enabled by default** in generated GitHub Actions workflows
- To disable, set repository variable `SCRY_COVERAGE_EXECUTE=false`

**Upgrade Instructions:**
Users who have already run `npx @scrymore/scry-deployer init` should run:
```bash
npx @scrymore/scry-deployer update-workflows
```
This will regenerate the workflow files with the new defaults.
