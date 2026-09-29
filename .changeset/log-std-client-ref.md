---
"@scrymore/scry-deployer": patch
---

A failed API call now ends with `Ref: <id>` (the server's `x-scry-request-id`) and the deployer sends `x-scry-client: scry-deployer/<version>` on every API request. Failure output prints the HTTP status and the server's `error` field only, never the whole response body. Sentry `environment` no longer falls back to `production` when `NODE_ENV` is unset (it is `development`), and the request id is attached to the event as a tag.
