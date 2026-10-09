---
"@scrymore/scry-deployer": patch
---

The Creative Cloud item link survives the converter: `cleanAdobeLink` now lets a `:` through in exactly one place, the `urn:aaid:sc:<REGION>:<uuid>` library segment of `https://www.adobe.com/files/libraries/<urn>[/<item uuid>]`, so Scry Sync can send a link that opens the picture itself. Every other colon, and every other rule (https only, no credentials, query and fragment stripped), is unchanged.
