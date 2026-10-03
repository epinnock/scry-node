---
"@scrymore/scry-deployer": minor
---

Requires Node.js 20.9 or newer (was 18; Node 18 is past end of life) and updates `sharp` from 0.34.5 to 0.35.5, which closes two libvips advisories (GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c) in the image conversion used by `scry import` and the scry-sync converter. Node 18 users stay on 0.11.x. CI now tests Node 20 and 22.
