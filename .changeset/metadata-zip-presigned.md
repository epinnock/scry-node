---
"@scrymore/scry-deployer": minor
---

**Metadata ZIPs over 100 MiB now upload.** Before, a large library's metadata ZIP failed with `maxContentLength size of 104857600 exceeded` (the dashboard's reached 101.5 MiB), nothing was indexed, and the build stayed "pending" for ever. The ZIP now goes straight to storage on a presigned URL (presign, PUT, complete) instead of through the upload service, up to 2 GiB. If the PUT or the complete step fails, the build is marked failed with a reason on the upload service, the run prints that it did, and the command exits 1. Against an upload service that predates this change (no presign route) the old route is used for a ZIP of up to 100 MiB, with a warning in the log; a larger ZIP stops with `upload service too old for a ZIP this size`. No flags or settings changed.
