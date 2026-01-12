# scry-node (scry-deployer) Implementation Spec

## Overview

Update the scry-deployer CLI to:
- Run coverage analysis as part of deployment (optional, default on)
- Upload coverage reports to R2 storage
- Include coverage data in build creation API calls
- Post coverage summary as PR comments

**Key Decision:** `@scrymore/scry-sbcov` will be a direct dependency of scry-node, not a peer dependency. Users don't need to install it separately.

---

## 1. CLI Flag Updates

### File: `bin/cli.js`

Add new CLI options for coverage:

```javascript
const { program } = require('commander');

program
  .option('-d, --dir <path>', 'Path to storybook-static directory')
  .option('-v, --version-id <version>', 'Version identifier for this build')
  // NEW: Coverage options
  .option('--coverage-report <path>', 'Path to coverage report JSON file')
  .option('--no-coverage', 'Skip coverage analysis')
  .option('--coverage-fail-on-threshold', 'Fail if coverage thresholds not met')
  .option('--coverage-base <branch>', 'Base branch for new code analysis', 'main')
  .parse(process.argv);
```

---

## 2. Coverage Analysis Integration

### File: `lib/coverage.js` (NEW)

New module for running coverage analysis:

```javascript
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

async function runCoverageAnalysis(options) {
  const { storybookDir, baseBranch, failOnThreshold } = options;
  
  console.log(chalk.blue('Running Storybook coverage analysis...'));
  
  const outputPath = path.join(process.cwd(), '.scry-coverage-report.json');
  
  const args = [
    '@scrymore/scry-sbcov',
    '--storybook-static', storybookDir,
    '--output', outputPath,
    '--base', `origin/${baseBranch}`,
  ];
  
  if (failOnThreshold) {
    args.push('--ci');
  }
  
  try {
    execSync(`npx ${args.join(' ')}`, { stdio: 'inherit' });
    const report = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    fs.unlinkSync(outputPath);
    return report;
  } catch (error) {
    if (failOnThreshold) throw error;
    return null;
  }
}

function extractCoverageSummary(report) {
  if (!report) return null;
  
  return {
    reportUrl: null,
    summary: {
      componentCoverage: report.summary.metrics.componentCoverage,
      propCoverage: report.summary.metrics.propCoverage,
      variantCoverage: report.summary.metrics.variantCoverage,
      passRate: report.summary.health.passRate,
      totalComponents: report.summary.totalComponents,
      componentsWithStories: report.summary.componentsWithStories,
      failingStories: report.summary.health.failingStories,
    },
    qualityGate: report.qualityGate,
    generatedAt: report.generatedAt,
  };
}

module.exports = { runCoverageAnalysis, extractCoverageSummary };
```

---

## 3. API Client Updates

### File: `lib/apiClient.js`

Update to handle coverage upload:

```javascript
async uploadBuild(options) {
  const { zipPath, versionId, coverageReport } = options;
  
  // Upload storybook zip
  const storybookUrl = await this.uploadFile(zipPath, `${versionId}/storybook.zip`);
  
  // Upload coverage report if provided
  let coverageUrl = null;
  if (coverageReport) {
    const coveragePath = await this.writeTempCoverageFile(coverageReport);
    coverageUrl = await this.uploadFile(coveragePath, `${versionId}/coverage-report.json`);
    fs.unlinkSync(coveragePath);
  }
  
  // Create build with coverage data
  const buildData = { versionId, zipUrl: storybookUrl };
  
  if (coverageReport && coverageUrl) {
    const coverageSummary = extractCoverageSummary(coverageReport);
    coverageSummary.reportUrl = coverageUrl;
    buildData.coverage = coverageSummary;
  }
  
  const build = await this.createBuild(buildData);
  
  return {
    build,
    storybookUrl,
    coverageUrl,
    viewUrl: `https://view.scrymore.com/${this.projectId}/${versionId}/`,
    coveragePageUrl: coverageUrl 
      ? `https://dashboard.scrymore.com/projects/${this.projectId}/builds/${build.id}/coverage`
      : null,
  };
}
```

---

## 4. PR Comment Integration

### File: `lib/pr-comment.js` (NEW)

```javascript
const { Octokit } = require('@octokit/rest');

async function postPRComment(deployResult, coverageReport) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;
  
  const event = require(process.env.GITHUB_EVENT_PATH);
  const prNumber = event.pull_request?.number;
  if (!prNumber) return;
  
  const octokit = new Octokit({ auth: token });
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  
  const body = formatPRComment(deployResult, coverageReport);
  
  await octokit.rest.issues.createComment({
    owner, repo,
    issue_number: prNumber,
    body,
  });
}

function formatPRComment(deployResult, coverageReport) {
  const { build, viewUrl, coveragePageUrl } = deployResult;
  
  let body = `<!-- scry-deployer -->
## Storybook Deployed

**Build #${build.buildNumber}** deployed successfully!

[View Storybook](${viewUrl})`;

  if (coverageReport) {
    const { summary, qualityGate } = coverageReport;
    const { metrics, health } = summary;
    const statusIcon = qualityGate.passed ? '✅' : '❌';
    
    body += `

---

## Coverage Report

| Metric | Value | Status |
|--------|-------|--------|
| Component Coverage | ${metrics.componentCoverage.toFixed(1)}% | ${qualityGate.passed ? '✅' : '❌'} |
| Prop Coverage | ${metrics.propCoverage.toFixed(1)}% | ✅ |
| Pass Rate | ${health.passRate.toFixed(1)}% | ✅ |

**Quality Gate:** ${statusIcon} ${qualityGate.passed ? 'PASSED' : 'FAILED'}

[View Coverage Report](${coveragePageUrl})`;
  }

  return body;
}

module.exports = { postPRComment };
```

---

## 5. Workflow Template Updates

### File: `templates/workflows/deploy-storybook.yml`

```yaml
name: Deploy Storybook

on:
  push:
    branches: [main, master]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v2
        with:
          version: 8
          
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: CI=false pnpm install
      - run: pnpm run build-storybook

      - name: Deploy to Scry
        run: |
          npx @scrymore/scry-deployer \
            --dir ./storybook-static \
            ${{ vars.SCRY_COVERAGE_ENABLED == 'false' && '--no-coverage' || '' }} \
            ${{ vars.SCRY_COVERAGE_FAIL_ON_THRESHOLD == 'true' && '--coverage-fail-on-threshold' || '' }}
        env:
          STORYBOOK_DEPLOYER_API_URL: ${{ vars.SCRY_API_URL }}
          STORYBOOK_DEPLOYER_PROJECT: ${{ vars.SCRY_PROJECT_ID }}
          STORYBOOK_DEPLOYER_API_KEY: ${{ secrets.SCRY_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 6. Package.json Updates

```json
{
  "dependencies": {
    "@octokit/rest": "^20.0.0",
    "@scrymore/scry-sbcov": "^0.1.0"
  }
}
```

**Note:** `@scrymore/scry-sbcov` is a direct dependency, not a peer dependency. This means:
- Users don't need to install it separately
- It's bundled with scry-deployer
- Version is managed by scry-deployer maintainers

---

## 7. Git fetch-depth Requirement

### Why fetch-depth: 0 is Required

The `scry-sbcov` tool uses git history to determine which components are "new" vs "modified" for the new-code analysis feature. This requires access to the full git history.

**Default GitHub Actions behavior:** Shallow clone with only the latest commit (`fetch-depth: 1`)

**What happens without full history:**
- New-code analysis cannot determine which files changed
- All components are treated as "existing" code
- New code coverage metrics will be inaccurate

**Solution:** Always use `fetch-depth: 0` in workflow templates.

**Risk Assessment:** No risk - `fetch-depth: 0` is a standard practice for tools that need git history. The only downside is slightly longer checkout time (typically 1-5 seconds for most repos).

### Implementation

All workflow templates will include:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0  # Required for coverage new-code analysis
```

---

## 8. CI Time Optimization

To minimize the impact of coverage analysis on CI time, implement these optimizations:

### 8.1 Parallel Execution

Run coverage analysis in parallel with other non-dependent steps where possible:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: pnpm install
      - run: pnpm run build-storybook
      
      # Upload artifact for parallel job
      - uses: actions/upload-artifact@v4
        with:
          name: storybook-static
          path: storybook-static

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - run: npx @scrymore/scry-deployer --dir ./storybook-static
```

### 8.2 Node Modules Caching

Ensure node_modules is cached to speed up scry-sbcov installation:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'pnpm'  # or 'npm' or 'yarn'
```

### 8.3 Skip Coverage for Draft PRs

Add option to skip coverage for draft PRs to speed up iteration:

```yaml
- name: Deploy to Scry
  run: |
    npx @scrymore/scry-deployer \
      --dir ./storybook-static \
      ${{ github.event.pull_request.draft == true && '--no-coverage' || '' }}
```

### 8.4 Coverage Report Caching

Cache the coverage report between runs if source hasn't changed:

```yaml
- name: Cache coverage report
  uses: actions/cache@v4
  with:
    path: .scry-coverage-report.json
    key: coverage-${{ hashFiles('src/**/*.tsx', 'src/**/*.stories.tsx') }}
```

---

## 9. File Summary

| File | Action | Description |
|------|--------|-------------|
| `bin/cli.js` | Modify | Add coverage CLI options |
| `lib/coverage.js` | Create | Coverage analysis module |
| `lib/apiClient.js` | Modify | Handle coverage upload |
| `lib/pr-comment.js` | Create | PR comment posting |
| `templates/workflows/deploy-storybook.yml` | Modify | Add coverage support |
| `templates/workflows/deploy-pr-preview.yml` | Modify | Add coverage support |
| `package.json` | Modify | Add dependencies |

---

## 8. Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STORYBOOK_DEPLOYER_API_URL` | Yes | - | Scry API endpoint |
| `STORYBOOK_DEPLOYER_PROJECT` | Yes | - | Project ID |
| `STORYBOOK_DEPLOYER_API_KEY` | Yes | - | API key |
| `GITHUB_TOKEN` | No | - | For PR comments |
| `SCRY_COVERAGE_ENABLED` | No | `true` | Enable coverage |
| `SCRY_COVERAGE_FAIL_ON_THRESHOLD` | No | `false` | Fail on threshold |
