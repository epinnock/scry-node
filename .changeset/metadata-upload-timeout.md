---
"@scrymore/scry-deployer": patch
---

**Large metadata ZIPs no longer time out on slow runners, and a failed metadata upload no longer prints success lines.**

What failed before: the metadata ZIP and the coverage report are sent through the Scry upload service with a fixed 60 s timeout and no retry. With scry-sbcov 0.6+ (2× root captures) a 470-story Storybook's metadata ZIP is 28 MB, which a self-hosted runner uploading at 0.4-0.85 MB/s cannot send in 60 s: the deploy ended `NOTHING WILL BE INDEXED`, and the log still printed `✅ Archive uploaded.` and `✅ Upload complete.` around the failure.

What you see now:

- Both uploads get a timeout scaled to their size: max(60 s, size ÷ 100 KB/s), at most 15 minutes (28 MB → about 4.7 min). They are retried up to 3 attempts, with backoff, on a timeout, a 5xx/429 or a network error, and never on another 4xx. Each attempt logs its size and how long it took: `Metadata ZIP: sent 28.0 MB in 71.3 s (attempt 1/3).`
- When the metadata upload still fails, no success line follows it. The deploy ends red with `NOTHING WILL BE INDEXED` and names the build, which is left pending (the upload service cannot mark it failed yet). Re-run the job to index it.
- `SCRY_UPLOAD_TIMEOUT_FLOOR_MS` changes the 60 s floor.

What you must do: nothing.
