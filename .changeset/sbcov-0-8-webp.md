---
"@scrymore/scry-deployer": minor
---

The deployer now bundles scry-sbcov 0.8.0, which stores screenshots as lossless WebP by default (about 60% smaller metadata ZIPs; a capture over 6,000,000 pixels stays PNG). The ZIP goes to storage unchanged: nothing in the deployer opens or re-encodes the images. **The first build after upgrading re-indexes every story once**, because the image files and their bytes change. To keep PNG screenshots, run sbcov with `--capture-format png`. Node 20.9 or newer is required (sbcov's encoder); the deployer already required it.
