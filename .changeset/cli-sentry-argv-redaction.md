---
"@scrymore/scry-deployer": patch
---

Stop the API key reaching error reports: the verbose "Received arguments" log line masks credential fields, every Sentry breadcrumb is scrubbed like the event itself, and events carry the deployer version as `release`.
