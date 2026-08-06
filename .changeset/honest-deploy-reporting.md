---
"@scrymore/scry-deployer": minor
---

Stop reporting indexing the deployer cannot confirm.

Uploading is synchronous; indexing is not. The command printed
`🎉 Deployment successful! 🎉` immediately after upload, so a build that failed
in the processing queue seconds later still looked like a success. In one run
the pipeline died 7s after this message on a revoked credential, and nothing in
the output said so — the failure only surfaced much later, as an empty search.

The final message is now `✅ Upload complete.`, followed by an explicit note
that indexing is queued but unverified and that components are not searchable
until it finishes. If metadata uploaded but was *not* queued, that is called out
as a warning: the Storybook is hosted, but nothing is being indexed.

Also adds a `warn` level to the logger, which previously had only
`info`/`success`/`error`/`debug`.
