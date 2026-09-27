/**
 * Generate GitHub Actions workflow templates
 */

/**
 * Get package manager setup action
 */
function getPackageManagerSetup(packageManager) {
    switch (packageManager) {
        case 'pnpm':
            return `      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8
`;
        case 'yarn':
            return ''; // Yarn is supported by default in setup-node
        case 'bun':
            return `      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
`;
        default:
            return '';
    }
}

/**
 * Get install command for package manager
 * All commands handle missing lockfiles gracefully
 */
function getInstallCommand(packageManager) {
    switch (packageManager) {
        case 'npm':
            // Use npm install which works with or without package-lock.json
            return 'npm install';
        case 'pnpm':
            // Just use pnpm install - it works with or without lockfile
            // We set CI=false to prevent pnpm from auto-enabling frozen-lockfile
            return 'CI=false pnpm install';
        case 'yarn':
            return 'yarn install';
        case 'bun':
            return 'bun install';
        default:
            return 'npm install';
    }
}

/**
 * Get cache value for package manager
 */
function getCacheValue(packageManager) {
    if (packageManager === 'npm') {
        return '';
    }
    return `          cache: '${packageManager}'`;
}

/**
 * The deployer version range every generated workflow installs.
 *
 * A floor, not a pin and not @latest: every 0.x fix, never a version without
 * the "nothing will be indexed" guards (0.7.0), never a surprise major. The
 * repo's own package.json cannot lower it, because the deployer is installed
 * into its own folder (ISSUES.md #50: a repo pinned to 0.2.2 ran it for seven
 * weeks through a bare `npx @scrymore/scry-deployer`).
 */
const DEPLOYER_RANGE = '^0.7.0';

/**
 * Where the deployer is installed on the runner: outside the checkout, so
 * `npm i` never touches a pnpm or yarn node_modules and the repo's lockfile
 * or pin cannot choose the version. Shell form for `run:`, expression form
 * for `working-directory:`.
 */
const TOOLS_DIR_SHELL = '"$RUNNER_TEMP/scry"';
const TOOLS_DIR_EXPR = '${{ runner.temp }}/scry';
const DEPLOYER_BIN = '"$RUNNER_TEMP/scry/node_modules/.bin/scry-deployer"';

/**
 * Steps that install the deployer, then the browser its analyzer drives.
 *
 * Order matters. The browser is installed by the Playwright inside the
 * deployer's own dependency tree (the one scry-sbcov loads), after the
 * deployer exists. A floating `npx playwright install` before it resolved
 * whatever Playwright was newest (or the repo's own) and could fetch a
 * browser build the analyzer does not look for; every story then failed, no
 * metadata was written and nothing was indexed (scry-link #44).
 *
 * Package-manager independent on purpose: npm ships with setup-node, and the
 * install goes to a separate prefix, so pnpm, yarn and bun repos get the same
 * steps.
 */
function getDeployerSetupSteps() {
    return `      - name: Install the Scry deployer
        id: scry
        # Its own folder and a floor of ${DEPLOYER_RANGE}: the repo's own pin cannot pick an older deployer.
        # --ignore-scripts: nothing in its tree needs an install script, and none runs next to the checkout's token.
        run: |
          set -o pipefail
          mkdir -p ${TOOLS_DIR_SHELL}
          npm i --no-save --no-audit --no-fund --ignore-scripts --prefix ${TOOLS_DIR_SHELL} @scrymore/scry-deployer@${DEPLOYER_RANGE}
          cd ${TOOLS_DIR_SHELL}
          echo "version=$(node -p "require('@scrymore/scry-deployer/package.json').version")" >> "$GITHUB_OUTPUT"
          PW="$(npx --no-install playwright --version | awk '{print $2}')"
          [ -n "$PW" ] || { echo "::error::the deployer's Playwright was not found in $RUNNER_TEMP/scry"; exit 1; }
          echo "playwright=$PW" >> "$GITHUB_OUTPUT"

      - name: Cache the deployer's Playwright browser
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: scry-pw-\${{ runner.os }}-\${{ steps.scry.outputs.playwright }}

      - name: Install the deployer's Playwright browser
        # The deployer's own Playwright, so the browser build is the one its
        # analyzer launches. Without it every story fails and nothing is indexed.
        working-directory: ${TOOLS_DIR_EXPR}
        run: npx --no-install playwright install --with-deps chromium-headless-shell
`;
}

/** Deployer flags shared by both workflows. */
const COMMON_FLAGS = `            \${{ vars.SCRY_COVERAGE_ENABLED == 'false' && '--no-coverage' || '' }} \\
            \${{ vars.SCRY_COVERAGE_FAIL_ON_THRESHOLD == 'true' && '--coverage-fail-on-threshold' || '' }} \\
            \${{ vars.SCRY_COVERAGE_EXECUTE == 'false' && '' || '--coverage-execute' }} \\
            --with-analysis \\`;

/**
 * Generate main deployment workflow
 */
function generateMainWorkflow(projectId, apiUrl, packageManager, buildCmd) {
    const pmSetup = getPackageManagerSetup(packageManager);
    const installCmd = getInstallCommand(packageManager);
    const cache = getCacheValue(packageManager);
    const runCmd = packageManager === 'npm' ? `npm run ${buildCmd}` : `${packageManager} run ${buildCmd}`;

    return `# Auto-generated by Scry Storybook Deployer
# Deploy Storybook to production on push to main branch
# Regenerate with: npx -y @scrymore/scry-deployer@${DEPLOYER_RANGE} update-workflows

name: Deploy Storybook

on:
  push:
    branches: [main, master]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required for coverage new-code analysis

${pmSetup}      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
${cache}

      - name: Install dependencies
        run: ${installCmd}

      - name: Build Storybook
        run: ${runCmd}

${getDeployerSetupSteps()}
      - name: Deploy to Scry
        # Exits 1 when the build was asked to index and nothing will be indexed.
        run: |
          ${DEPLOYER_BIN} \\
            --dir ./storybook-static \\
${COMMON_FLAGS}
            --coverage-base \${{ vars.SCRY_COVERAGE_BASE || github.event.before }}
        env:
          STORYBOOK_DEPLOYER_API_URL: \${{ vars.SCRY_API_URL }}
          STORYBOOK_DEPLOYER_PROJECT: \${{ vars.SCRY_PROJECT_ID }}
          STORYBOOK_DEPLOYER_API_KEY: \${{ secrets.SCRY_API_KEY }}
          # Optional: stories allowed to fail capture before the deploy ends red (default 0).
          SCRY_MAX_DROPPED: \${{ vars.SCRY_MAX_DROPPED }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
}

/**
 * Generate PR preview workflow
 */
function generatePRWorkflow(projectId, apiUrl, packageManager, buildCmd) {
    const pmSetup = getPackageManagerSetup(packageManager);
    const installCmd = getInstallCommand(packageManager);
    const cache = getCacheValue(packageManager);
    const runCmd = packageManager === 'npm' ? `npm run ${buildCmd}` : `${packageManager} run ${buildCmd}`;

    return `# Auto-generated by Scry Storybook Deployer
# Deploy Storybook preview for pull requests
# Regenerate with: npx -y @scrymore/scry-deployer@${DEPLOYER_RANGE} update-workflows

name: Deploy Storybook PR Preview

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

# One preview per PR: a new push cancels the run it replaces.
concurrency:
  group: storybook-pr-\${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  deploy-preview:
    # Drafts are skipped; marking the PR ready for review deploys it.
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest

    permissions:
      contents: read
      pull-requests: write

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required for coverage new-code analysis

${pmSetup}      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
${cache}

      - name: Install dependencies
        run: ${installCmd}

      - name: Build Storybook
        run: ${runCmd}

${getDeployerSetupSteps()}
      - name: Deploy Preview
        id: deploy
        # Exits 1 when the build was asked to index and nothing will be indexed.
        run: |
          ${DEPLOYER_BIN} \\
            --dir ./storybook-static \\
            --version pr-\${{ github.event.pull_request.number }} \\
${COMMON_FLAGS}
            --coverage-base \${{ vars.SCRY_COVERAGE_BASE || format('origin/{0}', github.base_ref) }}

          # Construct deployment URL using VIEW_URL (where users access the deployed Storybook)
          # Defaults to https://view.scrymore.com if SCRY_VIEW_URL is not set
          PROJECT_ID="\${{ vars.SCRY_PROJECT_ID }}"
          VIEW_URL="\${{ vars.SCRY_VIEW_URL || 'https://view.scrymore.com' }}"
          DEPLOY_URL="\${VIEW_URL}/\${PROJECT_ID}/pr-\${{ github.event.pull_request.number }}/"
          echo "deployment_url=\$DEPLOY_URL" >> $GITHUB_OUTPUT
        env:
          STORYBOOK_DEPLOYER_API_URL: \${{ vars.SCRY_API_URL }}
          STORYBOOK_DEPLOYER_PROJECT: \${{ vars.SCRY_PROJECT_ID }}
          STORYBOOK_DEPLOYER_API_KEY: \${{ secrets.SCRY_API_KEY }}
          # Optional: stories allowed to fail capture before the deploy ends red (default 0).
          SCRY_MAX_DROPPED: \${{ vars.SCRY_MAX_DROPPED }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
}

module.exports = {
    generateMainWorkflow,
    generatePRWorkflow,
    DEPLOYER_RANGE,
};
