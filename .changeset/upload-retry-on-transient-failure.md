---
"@scrymore/scry-deployer": patch
---

Retry the deploy upload on transient network failures.

The presigned-URL request and the R2 upload were both single-shot, so a momentary
DNS hiccup or connection reset discarded the several minutes of screenshot capture
that had already succeeded. Six consecutive real deploys failed this way in one
afternoon, each with `EAI_AGAIN` or `ECONNRESET` at the final step.

Both calls now retry up to four times with exponential backoff, and only on
conditions a later attempt can survive (network-level errors, 429, and 5xx) —
a 4xx still fails immediately rather than delaying the error the user needs to
see. Each retry re-requests the presigned URL, since those are signed at request
time and would otherwise expire into a confusing signature error. Retries are
logged at info level so a recovering deploy is not mistaken for a hung one.
