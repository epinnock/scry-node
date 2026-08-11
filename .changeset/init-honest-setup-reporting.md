---
"@scrymore/scry-deployer": patch
---

`scry init` no longer reports success for steps that failed.

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
  leaving the repository with no variables *and* no secret. There is now a capability
  check and a `gh api` fallback.
- **The closing summary reports what happened**, including a distinct message for
  "not attempted" when GitHub setup was skipped.
