---
"@scrymore/scry-deployer": patch
---

Generated workflows (`init`, `update-workflows`) now install `@scrymore/scry-deployer@^0.12.1` instead of `^0.9.0`. On 0.x a caret range on 0.9.0 stops below 0.10, so customer CI never got the deployer that carries Storybook tags (scry-sbcov ^0.8.0). Native capture workflow samples pin 0.12.1.
