---
"@scrymore/scry-deployer": minor
---

New `upload <dir|zip>` command for Scry Capture Format bundles (local validation with the vendored `@scrymore/scf`, every problem printed, exit 1 on reject; source text only with `--include-source`) and `capture rn` (React Native Storybook on an iOS Simulator or Android emulator → SCF bundle with crops, honest counts and rn-fiber trees). `scry analyze` now uploads an SCF bundle through the bundle route, so its builds are indexed.
