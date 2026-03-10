# Scry Storybook Deployer

Deploy your Storybook to the cloud with one command. ⚡

## 🎯 Quick Start (5 seconds)

### 1. Get your credentials
Visit the [Scry Dashboard](https://dashboard.scrymore.com) and:
- 🔐 Login with your account (Firebase)
- 📦 Create a new project
- 📋 Copy your **Project ID** and **API Key**

### 2. Run the setup command

```bash
npx @scrymore/scry-deployer init --projectId YOUR_PROJECT_ID --apiKey YOUR_API_KEY
```

**That's it!** 🎉

The `init` command automatically:
- ✅ Creates configuration file (`.storybook-deployer.json`)
- ✅ Generates GitHub Actions workflows
- ✅ Sets up repository variables and secrets
- ✅ Commits and pushes everything to GitHub
- ✅ Triggers automatic deployment

### What happens next?

Your Storybook now deploys automatically:
- 🚀 **Push to main** → Deploys to production (`/latest`)
- 🔍 **Open a PR** → Deploys preview (`/pr-123`)
- 🔄 **Update PR** → Updates preview automatically

No additional configuration needed!

---

## 📚 About

A client-side Command-Line Interface (CLI) tool to automate the deployment of Storybook static builds.

This tool is designed for execution within a CI/CD pipeline (such as GitHub Actions). The core workflow involves:
1.  Archiving a specified Storybook build directory.
2.  Authenticating with a secure backend service.
3.  Uploading the archive directly to cloud storage.

**Features:**
- 🚀 Simple Storybook static build deployment
- 🔍 Auto-detection of `.stories.*` files
- 📊 Story metadata extraction and analysis
- 📸 Automated screenshot capture with storycap
- 🧪 Storybook coverage analysis + PR summary comments (see `docs/COVERAGE.md`)
- 📦 Organized master ZIP packaging (staticsite, images, metadata)
- ⚙️ Flexible configuration (CLI, env vars, config file)
- 🔒 Secure presigned URL uploads

---

## 🚀 Manual Deployment (Testing)

Want to test a deployment before setting up automation? Run:

```bash
npx @scrymore/scry-deployer --dir ./storybook-static --project YOUR_PROJECT_ID --api-key YOUR_API_KEY
```

This deploys your Storybook immediately without setting up GitHub Actions.

---

## 📦 Installation (Optional)

**You don't need to install anything!** Just use `npx` to run the init command:

```bash
# From npm (recommended)
npx @scrymore/scry-deployer init --projectId xxx --apiKey yyy

# From GitHub (latest from main branch)
npx github:epinnock/scry-node init --projectId xxx --apiKey yyy
```

### Installing as a Dependency

If you prefer to install it as a development dependency:

```bash
# From npm (when published)
npm install @scrymore/scry-deployer --save-dev

# From GitHub
npm install github:epinnock/scry-node --save-dev
# or
pnpm add github:epinnock/scry-node -D
# or
yarn add github:epinnock/scry-node --dev
```

After installation, you can run commands using:

```bash
# Using the storybook-deployer binary
npx storybook-deployer init --projectId xxx --apiKey yyy

# Using the scry alias
npx scry init --projectId xxx --apiKey yyy

# Using the storybook-deploy alias (for deploy commands)
npx storybook-deploy --dir ./storybook-static
```

**Note:** The `init` command handles all configuration automatically, so manual installation is only needed if you want the package in your `node_modules` for local development.

## Configuration for Your API

To use this package with the Storybook deployment API at `https://storybook-deployment-service.epinnock.workers.dev`, configure your `.storybook-deployer.json` file:

```json
{
  "apiUrl": "https://storybook-deployment-service.epinnock.workers.dev",
  "dir": "./storybook-static",
  "project": "my-project",
  "version": "v1.0.0",
  "verbose": false
}
```

**API Endpoints Used:**
1. **Direct Upload**: `POST /upload/{project}/{version}` with binary zip data

**Example Usage:**

```bash
# Deploy to project "my-storybook" with version "v1.0.0"
npx storybook-deploy \
  --dir ./storybook-static \
  --project my-storybook \
  --version v1.0.0

# Using environment variables
export STORYBOOK_DEPLOYER_API_URL=https://storybook-deployment-service.epinnock.workers.dev
export STORYBOOK_DEPLOYER_PROJECT=my-project
export STORYBOOK_DEPLOYER_VERSION=v1.0.0

npx storybook-deploy --dir ./storybook-static
```

**Note:** If `--project` or `--version` are not provided, they default to `main` and `latest` respectively.

## Usage

The CLI provides a single command to handle the deployment. It can be run using `npx` from within your project's directory.

```bash
npx storybook-deploy [options]
```
The CLI provides two commands: `deploy` (default) and `analyze`.

### Deploy Command (Default)

Deploy your Storybook static build, optionally with analysis.

```bash
npx storybook-deploy [options]
```

### Analyze Command

Analyze Storybook stories, capture screenshots, and generate metadata without deploying the static site.

```bash
npx storybook-deploy analyze [options]
```

### Options

The CLI is configured through a combination of command-line options and environment variables. Command-line options always take precedence.

| Option         | Environment Variable                  | Description                                                  | Required | Default                              |
|----------------|---------------------------------------|--------------------------------------------------------------|----------|--------------------------------------|
| `--dir`        | `STORYBOOK_DEPLOYER_DIR`              | Path to the built Storybook directory (e.g., `storybook-static`). | Yes      | -                                    |
| `--api-key`    | `STORYBOOK_DEPLOYER_API_KEY`          | The API key for the deployment service.                        | No       | -                                    |
| `--api-url`    | `STORYBOOK_DEPLOYER_API_URL`          | Base URL for the deployment service API.                       | No       | `https://api.default-service.com/v1`  |
| `--project`    | `STORYBOOK_DEPLOYER_PROJECT`          | The project name/identifier.                                   | No       | `main`                               |
| `--version`    | `STORYBOOK_DEPLOYER_VERSION`          | The version identifier for the deployment.                     | No       | `latest`                             |
| `--with-analysis` | `STORYBOOK_DEPLOYER_WITH_ANALYSIS` | Enable Storybook analysis (story crawling + screenshots). Enabled by default in generated workflows. | No       | `false`                              |
| `--stories-dir` | `STORYBOOK_DEPLOYER_STORIES_DIR`     | Path to stories directory (optional, auto-detects .stories.* files). | No | Auto-detect                          |
| `--screenshots-dir` | `STORYBOOK_DEPLOYER_SCREENSHOTS_DIR` | Directory for captured screenshots.                        | No       | `./screenshots`                      |
| `--storybook-url` | `STORYBOOK_DEPLOYER_STORYBOOK_URL` | URL of running Storybook server for screenshot capture.        | No       | `http://localhost:6006`              |
| `--verbose`    | `STORYBOOK_DEPLOYER_VERBOSE`          | Enable verbose logging for debugging purposes.                 | No       | `false`                              |
| `--help`, `-h` | -                                     | Show the help message.                                       | -        | -                                    |
| `--version`, `-v`| -                                     | Show the version number.                                     | -        | -                                    |

### Story File Auto-Detection

The analysis feature now automatically detects `.stories.*` files anywhere in your project! You no longer need to specify a stories directory - the system intelligently searches for story files with these features:

**Supported File Patterns:**
- `.stories.ts`, `.stories.tsx`
- `.stories.js`, `.stories.jsx`
- `.stories.mjs`, `.stories.cjs`

**Auto-Detection Benefits:**
- **Automatic Discovery**: Finds story files anywhere in your project
- **Intelligent Exclusions**: Skips common directories (`node_modules`, `dist`, `build`, `.git`, etc.)
- **Flexible Structure**: Works with any project organization
- **Performance Optimized**: Searches up to 5 levels deep by default

You can still specify a custom directory with `--stories-dir` if needed.

### Configuration Hierarchy

The configuration is resolved in the following order of precedence:
1.  **Command-Line Arguments**: Highest precedence (e.g., `--api-key=some_key`).
2.  **Environment Variables**: Sourced from the execution environment (e.g., `STORYBOOK_DEPLOYER_API_KEY=some_key`).
3.  **Configuration File**: Values from `.storybook-deployer.json` in your project directory (automatically created during installation).
4.  **Programmatic Defaults**: Lowest precedence (e.g., for `--api-url`).

## Private Projects

If your project is set to **private** in the Scry dashboard, uploaded Storybook
and coverage reports will only be accessible to logged-in project members.

### How it works

1. Upload works the same way (using your API key)
2. The generated links work for anyone who is:
   - Logged into the Scry dashboard
   - A member of your project

### Sharing with team members

To give someone access to a private project:

1. Go to your project in the [Scry Dashboard](https://dashboard.scrymore.com)
2. Navigate to **Settings** → **Members**
3. Add their email address

They'll need to log in once, then all project links will work automatically.

### Configuration File

The configuration file (`.storybook-deployer.json`) is automatically created in your project directory when you install the package. You can edit this file to set default values for common options:

```json
{
  "apiUrl": "https://api.your-service.com/v1",
  "dir": "./storybook-static",
  "project": "my-project",
  "version": "v1.0.0",
  "verbose": false
}
```

**Property Reference:**
- `apiKey` → `--api-key` CLI option
- `apiUrl` → `--api-url` CLI option
- `dir` → `--dir` CLI option
- `project` → `--project` CLI option
- `version` → `--version` CLI option
- `verbose` → `--verbose` CLI option

**See [`.storybook-deployer.example.json`](.storybook-deployer.example.json) for a complete configuration file with all available options and their default values.**

### Usage Examples

**Basic deployment with config file:**
```bash
# Set project and version in .storybook-deployer.json, then run:
npx storybook-deploy --dir ./storybook-static
```

**Deploy with Storybook analysis:**
```bash
# Deploy with story metadata and screenshots (auto-detects story files)
npx storybook-deploy \
  --dir ./storybook-static \
  --with-analysis \
  --storybook-url http://localhost:6006

# Or specify a custom stories directory
npx storybook-deploy \
  --dir ./storybook-static \
  --with-analysis \
  --stories-dir ./src/components \
  --storybook-url http://localhost:6006
```

**Standalone analysis (no deployment):**
```bash
# Analyze stories and capture screenshots (auto-detects story files)
npx storybook-deploy analyze \
  --project my-project \
  --version v1.0.0 \
  --storybook-url http://localhost:6006

# Or with custom stories directory
npx storybook-deploy analyze \
  --project my-project \
  --version v1.0.0 \
  --stories-dir ./src \
  --storybook-url http://localhost:6006
```

**Override specific options:**
```bash
# Use config file defaults but override API URL:
npx storybook-deploy --api-url https://staging-api.service.com/v1
```

**Full command-line configuration:**
```bash
npx storybook-deploy \
  --dir ./storybook-static \
  --api-url https://storybook-deployment-service.epinnock.workers.dev \
  --project my-storybook \
  --version v1.0.0 \
  --verbose
```

### Master ZIP Structure

When analysis is enabled (`--with-analysis`), the tool creates a master ZIP file named `{project}-{version}.zip` with the following CDN-compliant structure:

```
my-project-v1.0.0.zip
├── index.html           # Storybook static build at root (CDN-compliant)
├── iframe.html
├── static/
│   └── ...
├── images/              # Captured screenshots
│   ├── story1.png
│   ├── story2.png
│   └── ...
└── metadata.json        # Story metadata and mappings
```

**metadata.json** contains:
- Story metadata (file paths, component names, story names)
- Screenshot mappings (which image corresponds to which story)
- Analysis timestamp and configuration

**Important:** The static site files (`index.html`, etc.) are placed at the **root of the ZIP** to ensure CDN compatibility. This allows the CDN to find `index.html` at the root level as expected.

Without analysis, only the static site is zipped and uploaded as `{project}-{version}.zip` with files at root.

## Example CI/CD Integration (GitHub Actions)

This tool is ideal for use in a GitHub Actions workflow. The API key should be stored as a [GitHub Secret](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions).

**Basic deployment workflow:**
```yaml
- name: Deploy Storybook
  env:
    STORYBOOK_DEPLOYER_API_URL: https://storybook-deployment-service.epinnock.workers.dev
    STORYBOOK_DEPLOYER_PROJECT: ${{ github.event.repository.name }}
    STORYBOOK_DEPLOYER_VERSION: ${{ github.sha }}
  run: npx storybook-deploy --dir ./storybook-static
```

**Deployment with analysis:**
```yaml
- name: Start Storybook server
  run: npm run storybook &
  
- name: Wait for Storybook
  run: npx wait-on http://localhost:6006

- name: Deploy Storybook with Analysis
  env:
    STORYBOOK_DEPLOYER_API_URL: https://storybook-deployment-service.epinnock.workers.dev
    STORYBOOK_DEPLOYER_PROJECT: ${{ github.event.repository.name }}
    STORYBOOK_DEPLOYER_VERSION: ${{ github.sha }}
  run: |
    npx storybook-deploy \
      --dir ./storybook-static \
      --with-analysis \
      --storybook-url http://localhost:6006
  # Note: --stories-dir is optional; story files are auto-detected
```

See the example workflow file: `.github/workflows/deploy-example.yml`

### PR Preview Deployments

Automatically deploy Storybook previews for every pull request to get instant visual feedback on UI changes. The PR preview workflow is included in this repository at [`.github/workflows/deploy-pr-preview.yml`](.github/workflows/deploy-pr-preview.yml).

**Features:**
- 🚀 Automatic deployment on PR creation and updates
- 💬 PR comment with deployment URL and metadata
- 🔄 Auto-updates the same comment on new commits
- ⚡ Fast builds (static site only, no analysis)
- 🏷️ Unique URLs per PR: `https://your-cdn.com/{project}/pr-{number}/`

#### Prerequisites

Before setting up PR preview deployments, ensure you have:

1. **A Storybook project** with a build command (e.g., `npm run build-storybook`)
2. **Access to repository settings** to configure GitHub Actions variables and secrets
3. **Backend deployment service** running and accessible (e.g., `https://storybook-deployment-service.epinnock.workers.dev`)
4. **Project identifier** for your Storybook deployment

#### Step-by-Step Setup

**Step 1: Copy the workflow file to your project**

If you're using this as a template, copy the workflow file to your repository:

```bash
mkdir -p .github/workflows
cp .github/workflows/deploy-pr-preview.yml YOUR_PROJECT/.github/workflows/
```

If you're installing from GitHub, the workflow file is already included.

**Step 2: Configure GitHub Actions Variables**

1. Navigate to your GitHub repository
2. Go to **Settings** → **Secrets and variables** → **Actions**
3. Click on the **Variables** tab
4. Click **New repository variable**
5. Add the following variables:

| Variable Name | Value | Example |
|--------------|-------|---------|
| `SCRY_PROJECT_ID` | Your project identifier | `my-storybook` or `company-design-system` |
| `SCRY_API_URL` | Backend API endpoint for uploads | `https://api.scrymore.com` |
| `SCRY_VIEW_URL` | Base URL where users view deployed Storybooks | `https://view.scrymore.com` |

**Note:** The `SCRY_VIEW_URL` is where users will access your deployed Storybook (e.g., `https://view.scrymore.com/{project}/pr-{number}/`). This is separate from `SCRY_API_URL`, which is the backend API endpoint used for uploads.

**Note:** Generated workflows include `--with-analysis` by default for build processing service integration. To disable, add `STORYBOOK_DEPLOYER_WITH_ANALYSIS` as a repository variable set to `false`.

**Step 3: Configure GitHub Actions Secrets (Optional)**

If your backend requires authentication:

1. In the same **Settings** → **Secrets and variables** → **Actions** page
2. Click on the **Secrets** tab  
3. Click **New repository secret**
4. Add the following secret:

| Secret Name | Value | Description |
|------------|-------|-------------|
| `SCRY_API_KEY` | Your API authentication key | Only needed if backend requires authentication |

**Step 4: Verify Your Storybook Build Command**

The workflow assumes your package.json has a `build-storybook` script. Verify this command exists:

```json
{
  "scripts": {
    "build-storybook": "storybook build"
  }
}
```

If your build command is different, update line 29 in `.github/workflows/deploy-pr-preview.yml`:

```yaml
- name: Build Storybook
  run: npm run build-storybook  # Change this if your command differs
```

**Step 5: Configure View URL (Where Users Access Storybooks)**

The workflow constructs deployment URLs using the `SCRY_VIEW_URL` variable:
```
{SCRY_VIEW_URL}/{PROJECT_ID}/pr-{PR_NUMBER}/
```

**Default:** If `SCRY_VIEW_URL` is not set, it defaults to `https://view.scrymore.com`

**Example URLs:**
- With default: `https://view.scrymore.com/my-project/pr-123/`
- With custom domain: `https://storybooks.mycompany.com/my-project/pr-123/`

To use a custom domain, add `SCRY_VIEW_URL` as a repository variable (see Step 2).

**Step 6: Test with a Pull Request**

1. Create a new branch in your repository:
   ```bash
   git checkout -b test-pr-preview
   ```

2. Make a small change (e.g., update README or add a comment)

3. Push the branch and create a pull request:
   ```bash
   git add .
   git commit -m "Test PR preview deployment"
   git push origin test-pr-preview
   ```

4. Open a PR on GitHub and watch the Actions tab for the workflow execution

5. Once complete, check for a comment on the PR with your deployment URL

#### Environment Variables Reference

The PR preview workflow uses these environment variables (configured via GitHub Variables and Secrets):

| Environment Variable | Source | Required | Description |
|---------------------|--------|----------|-------------|
| `SCRY_PROJECT_ID` | GitHub Variable | **Yes** | Project identifier for deployments |
| `SCRY_API_URL` | GitHub Variable | **Yes** | Backend API endpoint for uploads |
| `SCRY_VIEW_URL` | GitHub Variable | No | Base URL where users view Storybooks (default: `https://view.scrymore.com`) |
| `SCRY_API_KEY` | GitHub Secret | No | API authentication key (if required) |
| `STORYBOOK_DEPLOYER_WITH_ANALYSIS` | GitHub Variable | No | Set to `false` to disable build processing service integration (enabled by default in generated workflows) |

**Important:** `SCRY_API_URL` (where files are uploaded) and `SCRY_VIEW_URL` (where users view the deployed Storybook) are two different URLs:
- **API URL**: Backend service endpoint (e.g., `https://api.scrymore.com`)
- **View URL**: Public-facing CDN or viewer URL (e.g., `https://view.scrymore.com`)

The CLI also supports these environment variables for backward compatibility:
- `STORYBOOK_DEPLOYER_*` (legacy prefix)
- `SCRY_*` prefix takes precedence

**How it works:**

1. When a PR is opened or updated, the workflow:
   - Builds the Storybook static site
   - Deploys to `{project}/pr-{number}` version
   - Posts a comment with the preview URL

2. The comment includes:
   - Direct link to the deployed preview
   - Commit SHA and branch name
   - Deployment timestamp

3. On subsequent commits to the PR:
   - The workflow redeploys to the same PR version
   - Updates the existing comment with new deployment details

**Example PR Comment:**

```markdown
## 🚀 Storybook Preview Deployed

**Preview URL:** https://view.scrymore.com/my-project/pr-123/

📌 **Details:**
- **Commit:** `abc1234`
- **Branch:** `feature/new-component`
- **Deployed at:** Wed, 13 Nov 2024 05:00:00 GMT

> This preview will be updated automatically on each commit to this PR.
```

#### Troubleshooting

**Problem: Workflow fails with "SCRY_PROJECT_ID not found"**
- Solution: Ensure you've added `SCRY_PROJECT_ID` as a repository variable (not secret)
- Variables and Secrets are different - make sure you're in the Variables tab

**Problem: Deployment succeeds but no comment is posted**
- Solution: Check that the workflow has `pull-requests: write` permission
- This is already configured in the workflow file but may be restricted by organization settings

**Problem: Comment is posted multiple times instead of updating**
- Solution: This is expected if the bot user changes. The workflow looks for existing comments from the same bot

**Problem: Build fails with "command not found: build-storybook"**
- Solution: Update your package.json to include the build-storybook script, or modify the workflow to use your build command

**Problem: Deployment URL returns 404**
- Solution: Verify your backend deployment service is running and the URL pattern matches your backend's routing

#### Workflow File Reference

See the complete workflow configuration: [`.github/workflows/deploy-pr-preview.yml`](.github/workflows/deploy-pr-preview.yml)

Key workflow features:
- **Triggers**: `pull_request` with types `[opened, synchronize, reopened]`
- **Permissions**: `contents: read`, `pull-requests: write`
- **Node version**: 18 (configurable in workflow)
- **Comment management**: Smart update/create logic to avoid duplicate comments

#### Cleanup

PR preview deployments remain available after the PR is closed. To implement automatic cleanup when PRs are closed, consider adding a cleanup workflow that posts a comment notifying users that the preview is no longer maintained.

A cleanup workflow template will be added in a future update.

---

## 📢 Notifications (Slack & Microsoft Teams)

Want to get notified when Storybook previews are deployed? You can add Slack and/or Microsoft Teams notifications to your workflows.

### Overview

Notifications are added as extra steps in your GitHub Actions workflow. This approach gives you full control over the message format and when notifications are sent.

```
┌────────────────────────────────────────────────────────────────┐
│  GitHub Actions Workflow                                       │
│  ─────────────────────────────────────────────────────────────  │
│  1. Build Storybook                                            │
│  2. Deploy to Scry           ─────► deployment_url             │
│  3. Comment on PR (existing)                                   │
│  4. Notify Slack (optional)  ◄───── uses deployment_url        │
│  5. Notify Teams (optional)  ◄───── uses deployment_url        │
└────────────────────────────────────────────────────────────────┘
```

### Step 1: Create Webhooks

#### Slack Webhook Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name your app (e.g., "Scry Storybook") and select your workspace
3. Go to **Incoming Webhooks** (left sidebar) → Toggle **Activate Incoming Webhooks** to ON
4. Click **Add New Webhook to Workspace** → Select the channel for notifications
5. Copy the webhook URL (starts with `https://hooks.slack.com/services/...`)

#### Microsoft Teams Webhook Setup

1. In Microsoft Teams, go to your channel
2. Click the **⋯** (more options) → **Connectors** (or **Workflows** in new Teams)
3. Search for **Incoming Webhook** → **Configure**
4. Name it (e.g., "Scry Storybook"), optionally upload an icon
5. Copy the webhook URL (starts with `https://outlook.office.com/webhook/...`)

### Step 2: Add Secrets to GitHub

Add your webhook URLs as GitHub Secrets:

```bash
# Using GitHub CLI
gh secret set SLACK_WEBHOOK_URL --body "https://hooks.slack.com/services/..."
gh secret set TEAMS_WEBHOOK_URL --body "https://outlook.office.com/webhook/..."
```

**Or via GitHub UI:**
1. Go to your repository → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Add `SLACK_WEBHOOK_URL` and/or `TEAMS_WEBHOOK_URL`

### Step 3: Add Notification Steps to Workflow

Add these steps to your `.github/workflows/deploy-pr-preview.yml` file, **after** the "Deploy Preview" step:

#### Slack Notification

```yaml
      # Add this after the "Deploy Preview" step
      - name: Notify Slack
        if: success()
        uses: slackapi/slack-github-action@v1.26.0
        with:
          payload: |
            {
              "text": "🚀 Storybook Preview Ready",
              "blocks": [
                {
                  "type": "header",
                  "text": {
                    "type": "plain_text",
                    "text": "🚀 Storybook Preview Deployed"
                  }
                },
                {
                  "type": "section",
                  "fields": [
                    {
                      "type": "mrkdwn",
                      "text": "*PR:*\n<${{ github.event.pull_request.html_url }}|#${{ github.event.pull_request.number }}>"
                    },
                    {
                      "type": "mrkdwn",
                      "text": "*Author:*\n${{ github.event.pull_request.user.login }}"
                    },
                    {
                      "type": "mrkdwn",
                      "text": "*Branch:*\n`${{ github.head_ref }}`"
                    },
                    {
                      "type": "mrkdwn",
                      "text": "*Commit:*\n`${{ github.sha }}`"
                    }
                  ]
                },
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*Title:* ${{ github.event.pull_request.title }}"
                  }
                },
                {
                  "type": "actions",
                  "elements": [
                    {
                      "type": "button",
                      "text": {
                        "type": "plain_text",
                        "text": "📖 View Storybook"
                      },
                      "url": "${{ steps.deploy.outputs.deployment_url }}",
                      "style": "primary"
                    },
                    {
                      "type": "button",
                      "text": {
                        "type": "plain_text",
                        "text": "View PR"
                      },
                      "url": "${{ github.event.pull_request.html_url }}"
                    }
                  ]
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

#### Microsoft Teams Notification

```yaml
      # Add this after the "Deploy Preview" step
      - name: Notify Teams
        if: success()
        run: |
          curl -H "Content-Type: application/json" -d '{
            "@type": "MessageCard",
            "@context": "http://schema.org/extensions",
            "themeColor": "0076D7",
            "summary": "Storybook Preview Deployed",
            "sections": [{
              "activityTitle": "🚀 Storybook Preview Deployed",
              "activitySubtitle": "PR #${{ github.event.pull_request.number }} by ${{ github.event.pull_request.user.login }}",
              "facts": [{
                "name": "Branch",
                "value": "${{ github.head_ref }}"
              }, {
                "name": "Commit",
                "value": "${{ github.sha }}"
              }, {
                "name": "Title",
                "value": "${{ github.event.pull_request.title }}"
              }],
              "markdown": true
            }],
            "potentialAction": [{
              "@type": "OpenUri",
              "name": "View Storybook",
              "targets": [{
                "os": "default",
                "uri": "${{ steps.deploy.outputs.deployment_url }}"
              }]
            }, {
              "@type": "OpenUri",
              "name": "View PR",
              "targets": [{
                "os": "default",
                "uri": "${{ github.event.pull_request.html_url }}"
              }]
            }]
          }' "${{ secrets.TEAMS_WEBHOOK_URL }}"
```

### Optional: Toggle Notifications with Variables

Use GitHub Variables to enable/disable notifications without editing the workflow:

```bash
# Enable notifications
gh variable set ENABLE_SLACK_NOTIFICATIONS --body "true"
gh variable set ENABLE_TEAMS_NOTIFICATIONS --body "true"
```

Then update the `if` condition in the notification steps:

```yaml
      - name: Notify Slack
        if: success() && vars.ENABLE_SLACK_NOTIFICATIONS == 'true'
        # ... rest of step
```

### Notification Variables Reference

| Name | Type | Description |
|------|------|-------------|
| `SLACK_WEBHOOK_URL` | Secret | Your Slack incoming webhook URL |
| `TEAMS_WEBHOOK_URL` | Secret | Your Microsoft Teams incoming webhook URL |
| `ENABLE_SLACK_NOTIFICATIONS` | Variable (optional) | Set to `true` to enable Slack notifications |
| `ENABLE_TEAMS_NOTIFICATIONS` | Variable (optional) | Set to `true` to enable Teams notifications |

### What the Notifications Look Like

**Slack:**
```
┌───────────────────────────────────────────────┐
│ 🚀 Storybook Preview Deployed                 │
├───────────────────────────────────────────────┤
│ PR:     #42           Author: @developer      │
│ Branch: feature/new   Commit: abc1234         │
├───────────────────────────────────────────────┤
│ Title: Add new button component               │
│                                               │
│ [📖 View Storybook]  [View PR]                │
└───────────────────────────────────────────────┘
```

**Teams:**
```
┌───────────────────────────────────────────────┐
│ 🚀 Storybook Preview Deployed                 │
│ PR #42 by developer                           │
├───────────────────────────────────────────────┤
│ Branch: feature/new-button                    │
│ Commit: abc1234                               │
│ Title:  Add new button component              │
├───────────────────────────────────────────────┤
│ [View Storybook]  [View PR]                   │
└───────────────────────────────────────────────┘
```

### Troubleshooting Notifications

**Problem: Slack notification fails with "channel_not_found"**
- Solution: Regenerate the webhook URL and ensure the Slack app is still installed in your workspace

**Problem: Teams notification shows as plain text**
- Solution: Ensure the webhook is an "Incoming Webhook" connector, not a Power Automate flow

**Problem: Notification doesn't include buttons**
- Solution: Some webhook configurations may not support interactive elements. The links will still appear as text.

---

## 🔧 Troubleshooting the Init Command

### Command fails with "Not a git repository"

**Solution:** Initialize git first:
```bash
git init
git remote add origin https://github.com/your-username/your-repo.git
```

### GitHub CLI setup fails

**Solution:** Install GitHub CLI and authenticate:
```bash
# macOS
brew install gh

# Linux
sudo apt install gh  # Ubuntu/Debian
sudo dnf install gh  # Fedora

# Windows
winget install --id GitHub.cli

# Then authenticate
gh auth login
```

Or skip GitHub CLI setup and set variables manually:
```bash
npx @scrymore/scry-deployer init --projectId xxx --apiKey yyy --skip-gh-setup
```

Then manually add variables in GitHub Settings → Secrets and variables → Actions.

### Git push fails with "Authentication failed"

**Solution:** Configure Git credentials:
```bash
# For HTTPS
gh auth setup-git

# Or use SSH
git remote set-url origin git@github.com:your-username/your-repo.git
```

### "No build command found" warning

**Solution:** Add a build script to your `package.json`:
```json
{
  "scripts": {
    "build-storybook": "storybook build"
  }
}
```

### Want to customize the generated workflows?

After running `init`, you can edit:
- `.github/workflows/deploy-storybook.yml` - Main deployment
- `.github/workflows/deploy-pr-preview.yml` - PR previews

Then commit and push your changes:
```bash
git add .github/
git commit -m "Customize Storybook workflows"
git push
```

---

## 👩‍💻 Contributing & Development

We use [Changesets](https://github.com/changesets/changesets) for version management and releases.

### Development Workflow

```bash
# 1. Create a feature branch
git checkout main && git pull
git checkout -b feature/my-new-feature

# 2. Make your changes
# ... edit files ...

# 3. Create a changeset (if your changes should be released)
pnpm changeset
# Select @scrymore/scry-deployer
# Choose: patch (bug fix), minor (feature), major (breaking)
# Write a description of your changes

# 4. Commit everything
git add .
git commit -m "feat: add new feature"

# 5. Push and create a PR
git push -u origin HEAD
```

### When to Create a Changeset

| Change Type | Changeset? | Version Bump |
|-------------|------------|--------------|
| Bug fix | ✅ Yes | `patch` (0.0.1 → 0.0.2) |
| New feature | ✅ Yes | `minor` (0.0.2 → 0.1.0) |
| Breaking change | ✅ Yes | `major` (0.1.0 → 1.0.0) |
| Documentation only | ❌ No | - |
| CI/workflow changes | ❌ No | - |

### Release Process

1. **Merge PR to main** → Release workflow runs
2. **Changesets bot creates "Version Packages" PR** → Updates version + CHANGELOG
3. **Merge Version PR** → Publishes to npm automatically

### Installing Development Versions

```bash
# Stable release (recommended)
npm install @scrymore/scry-deployer

# Nightly release (latest from main, published daily)
npm install @scrymore/scry-deployer@nightly
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed contribution guidelines.

---

## 🆘 Support

Need help?
- 📖 [Documentation](https://github.com/epinnock/scry-node)
- 🐛 [Report an issue](https://github.com/epinnock/scry-node/issues)
- 💬 [Discussions](https://github.com/epinnock/scry-node/discussions)
