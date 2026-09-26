# Storybook deployment and indexing

Use for an existing application's Scry deployment or CI integration. Preserve
its package manager, framework, build command, Node version, and workspace
layout. Deployer 0.6.0 requires Node >=18; use the application's supported Node
version rather than downgrading it to the minimum.

## Prepare locally

1. Locate the package that owns Storybook. Run its existing build command and
   establish the actual output directory. A successful static build should
   include `index.html` and, for component discovery, a usable `index.json`.
2. Resolve the Scry project ID and upload API URL. Prefer working existing
   project settings or the dashboard-provided command. Published `init` defaults
   to `https://storybook-deployment-service.epinnock.workers.dev`; the central
   docs also show `https://upload.scrymore.com`. Do not silently replace a
   working or self-hosted endpoint with a different example.
3. Add `@scrymore/scry-deployer` as a development dependency with the project's
   package manager when repeatable local/CI deployment is wanted. Preserve the
   lockfile and use the installed binary (`scry-deployer`). For one-off use,
   `npx --yes @scrymore/scry-deployer@0.6.0 --help` is a versioned example;
   check the current stable release before choosing a version for a new setup.
4. Merge `.storybook-deployer.json` in the deploy command's working directory.
   It holds nonsecret settings only. The following values are examples to
   replace with the discovered project, endpoint, and build output:

```json
{
  "project": "YOUR_PROJECT_ID",
  "apiUrl": "https://storybook-deployment-service.epinnock.workers.dev",
  "dir": "./storybook-static",
  "version": "latest"
}
```

The package's postinstall creates a default config if absent. Inspect that file:
its generic `api.default-service.com` URL is a placeholder, and its `apiKey`
field should not acquire a real credential. Do not enable `--commit-api-key`.

For deployment, `SCRY_API_KEY`, `SCRY_API_URL`, and `SCRY_PROJECT_ID` supply
credentials and project settings. `SCRY_PROJECT` is also supported and takes
precedence over `SCRY_PROJECT_ID`; `STORYBOOK_DEPLOYER_*` aliases are supported.
The deployer does not automatically load `.env`; use the user's existing
environment loader or a secret supplied to the process.

Use an explicit `--deploy-version` where the output alias matters. GitHub
Actions context takes precedence over environment/config-file version values,
so `version: "latest"` alone can become `main` in CI. `--version` is also a
deployment version flag, not a reliable way to print the package version.

## Prepare GitHub Actions without running init

The installed package exports pure workflow generators from
`@scrymore/scry-deployer/lib/templates.js`:

```js
const { generateMainWorkflow, generatePRWorkflow } =
  require('@scrymore/scry-deployer/lib/templates.js');
// Both return YAML strings; they do not write files or contact GitHub.
const main = generateMainWorkflow(projectId, apiUrl, packageManager, buildScript);
const preview = generatePRWorkflow(projectId, apiUrl, packageManager, buildScript);
```

Use these as starting points, if available in the installed version. Generate
into temporary files, inspect the strings, then merge the relevant portions
into existing workflows. The templates are not a monorepo detector. Adapt:

- Default branch and triggers, package manager version, lockfile install,
  workspace working directory, Storybook script, and output directory.
- The deployment command to use the installed package/version consistently.
- Main deployment to pass `--deploy-version latest`; PR deployment to pass
  `--deploy-version pr-${{ github.event.pull_request.number }}`.
- Same-repository PR deployment to run only where project secrets are available.
  Keep fork PRs out of the secret-bearing deployment job; do not switch to
  `pull_request_target` to execute untrusted PR code with secrets.
- Browser installation for screenshot capture, using a Playwright version that
  matches the installed coverage runner. The supplied template uses the package
  manager's ephemeral runner to install `chromium-headless-shell`; if capture
  reports a missing executable, compare runner/browser versions before retrying.
- `--with-analysis` for searchable components. Keep coverage enabled with this
  path: in 0.6.0 disabling coverage also prevents the metadata ZIP needed for
  indexing. In particular, inspect the PR template's draft-PR `--no-coverage`
  branch before promising searchable draft previews.

CI configuration uses variables `SCRY_PROJECT_ID`, `SCRY_API_URL`, and optionally
`SCRY_VIEW_URL`; the key belongs in the **secret** `SCRY_API_KEY`. Map those into
the deployment step's environment. Templates use `STORYBOOK_DEPLOYER_PROJECT`,
`STORYBOOK_DEPLOYER_API_URL`, and `STORYBOOK_DEPLOYER_API_KEY` for that mapping.
Set remote variables/secrets only within the user's authorized setup scope.
Supply secret values through the available secret interface or stdin, not
literal command text. Never copy a real key into workflow YAML.

## Existing init shortcut

For a user who wants the complete automatic GitHub setup, the documented shape
is:

```bash
npx --yes @scrymore/scry-deployer@0.6.0 init \
  --project-id YOUR_PROJECT_ID \
  --api-key "$SCRY_API_KEY" \
  --api-url https://storybook-deployment-service.epinnock.workers.dev
```

This requires a Git repository, a suitable GitHub remote, and authenticated
`gh` for automatic secret setup. In 0.6.0, init requires credential flags rather
than using deployment's environment resolution. It overwrites the generated
config/workflows, commits, and pushes; it has no prepare-only flag. Its manual
GitHub setup fallback can print the key. Prefer the local preparation path when
output cannot be kept private, workflows already need customization, or the
user only requested local configuration. Check staged changes before any
automatic commit so unrelated staged work is not included.

## Deploy and verify

After the build, and when upload is in scope, run the installed deployer from
the configured package directory. For an npm project:

```bash
npm exec -- scry-deployer --dir ./storybook-static --deploy-version latest --with-analysis
```

Adapt the directory/version/package-manager runner. For hosting alone,
`--with-analysis` is optional. For search, confirm screenshots and a metadata ZIP
were produced and uploaded. A static upload may succeed before analysis fails;
diagnose the reported phase rather than repeatedly uploading the same build.

Check the CLI's actual output URL and the built Storybook's `index.json`. Private
projects require authenticated viewing; do not change visibility to make an
anonymous curl check pass. Check the relevant GitHub Actions run if CI was part
of the task. Then follow [mcp.md](mcp.md) to verify project-filtered search.
Hosting, asynchronous processing, and search readiness are separate checks.

Sources: [deployer source](https://github.com/epinnock/scry-node),
[published package](https://www.npmjs.com/package/@scrymore/scry-deployer),
[Scry CI guide](https://docs.scrymore.com/guide/github-actions).
