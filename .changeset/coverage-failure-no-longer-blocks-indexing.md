---
"@scrymore/scry-deployer": patch
---

A failed coverage upload no longer prevents your components being indexed.

The coverage retry was unguarded, so when the second attempt also failed it threw
out of `uploadBuild` and the metadata upload after it never ran. Coverage is a
report; the metadata archive is what makes components searchable — so a failure in
the optional artifact silently took down the essential one.

Seen on a real 467-story design system: every story captured, the archive built,
and nothing indexed — twice in a row.

The retry is now guarded and prints a warning that says plainly which part failed
and that indexing is unaffected.
