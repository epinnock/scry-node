---
"@scrymore/scry-deployer": minor
---

`scry init` no longer writes your API key into the committed config file.

`--commit-api-key` described itself as "not recommended" and defaulted to true, so
every `init` wrote the key into `.storybook-deployer.json` and committed it. The
copy was never load-bearing: `init` already stores the key as the `SCRY_API_KEY`
GitHub secret and the workflow it generates reads it from there.

Passing `--no-commit-api-key` did not help either — the key was written regardless,
and the `.gitignore` entry it added never matched, because `#` only starts a comment
at the beginning of a line in `.gitignore`.

The default is now false and the escape hatch still exists behind an explicit
`--commit-api-key`. For local runs, export `SCRY_API_KEY` instead.

**If you ran an earlier version, rotate that project's API key** — git history keeps
it after the file is changed.
