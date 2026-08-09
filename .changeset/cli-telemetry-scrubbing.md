---
"@scrymore/scry-deployer": patch
---

Stop sending credentials to error reporting, and document the reporting.

The CLI already reported errors to Sentry, and it was sending three things it
should not have. `scope.setExtra('argv', argv)` shipped the whole parsed argv,
which contains `--api-key` under both `apiKey` and `api-key` — so every failed
deploy carried the customer's project credential to a third party. Upload errors
quote the presigned URL in full, including `X-Amz-Signature`, which is a
time-limited write credential for the bucket. Stack frames carried absolute paths
containing usernames and, often, unreleased product names.

Reporting now uses an allowlist of argv fields rather than the whole object, so a
newly added option is invisible to telemetry until someone opts it in — the
reverse, remembering to exclude each new secret, is exactly how the API key got
through. Messages, exception values and extras are scrubbed for presigned query
strings, `scry_proj_` keys and bearer tokens, and stack frames are reduced to
basenames.

Adds an opt-out. `SCRY_TELEMETRY=0` and the cross-tool `DO_NOT_TRACK=1` are both
honoured, including in CI. The README now documents what is and is not sent;
previously nothing disclosed that the CLI reported at all.

Traces are no longer sampled from customer machines — errors only.
