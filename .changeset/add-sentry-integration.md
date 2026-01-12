---
"@scrymore/scry-deployer": minor
---

Add Sentry integration for error tracking

- Integrate @sentry/node for automatic error reporting
- Add breadcrumbs to logger for detailed error context
- Include release tracking with package version
- Add debug-sentry command for testing integration
- Capture OS and Node.js version as tags
- Ensure events are flushed before process exit
