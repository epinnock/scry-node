---
"@scrymore/scry-deployer": patch
---

Fix: resolve scry-sbcov CLI from installed dependency instead of npx cache

Prevents CI from using a stale cached version of @scrymore/scry-sbcov that
doesn't support --screenshots. Falls back to npx if the resolve fails.
