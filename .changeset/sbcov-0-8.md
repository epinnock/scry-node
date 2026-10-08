---
"@scrymore/scry-deployer": patch
---

**Storybook tags now reach Scry.** The deployer installs `@scrymore/scry-sbcov` 0.8 (it was held at 0.7 by the `^0.7.0` range, which excludes 0.8 on 0.x semver). CI runs that use the deployer now capture `parameters.scry.tags` and `x-scry-fields` in the metadata ZIP. No flags or settings changed.
