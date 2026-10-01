---
"@scrymore/scry-deployer": patch
---

`scry import`: hold every converted picture to 2048 px and 4 MiB (PDF and AI pages are rendered at that size directly), re-encode PNG/JPEG files over 4096 px or 4 MiB, and check each output decodes before it is uploaded. A file that cannot be made valid is skipped with a named reason. Fixes PDF and AI files being converted to 16384 px and refused by the AI services.
