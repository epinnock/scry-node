---
"@scrymore/scry-deployer": minor
---

Uploads now carry the build's commit sha and branch, alongside the per-story ids scry-sbcov writes into metadata.json, so hosted search can report freshness — which commit a component came from and whether it is from the current build. The commit and branch are resolved from `SCRY_COMMIT_SHA`/`SCRY_BRANCH`, then the GitHub Actions environment, then the working copy, and either is omitted rather than defaulted when it cannot be determined, so an unknown commit reads as unknown instead of as one that cannot be looked up. Requires `@scrymore/scry-sbcov` 0.5.0, which is what emits the per-story fields.
