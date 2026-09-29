---
"@scrymore/scry-deployer": patch
---

`scry upload` validates against the current SCF validator: manifests with an off-schema `capture.method`, `capture.crop`, `kind`, `source.platform` or `structure.origin` are now rejected locally (ENUM_VALUE_INVALID), matching the published schema and the server.
