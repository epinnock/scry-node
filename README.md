# Scry Storybook Deployer

Deploy your Storybook to the cloud with one command. ⚡

## 🎯 Quick Start (5 seconds)

### 1. Get your credentials
Visit the [Scry Dashboard](https://dashboard.scry.com) and:
- 🔐 Login with your account (Firebase)
- 📦 Create a new project
- 📋 Copy your **Project ID** and **API Key**

### 2. Run the setup command

```bash
npx @scry/storybook-deployer init --projectId YOUR_PROJECT_ID --apiKey YOUR_API_KEY
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
- 📦 Organized master ZIP packaging (staticsite, images, metadata)
- ⚙️ Flexible configuration (CLI, env vars, config file)
- 🔒 Secure presigned URL uploads

---

## 🚀 Manual Deployment (Testing)

Want to test a deployment before setting up automation? Run:

```bash
npx @scry/storybook-deployer --dir ./storybook-static --project YOUR_PROJECT_ID --api-key YOUR_API_KEY
```

This deploys your Storybook immediately without setting up GitHub Actions.

---

## 📦 Installation (Optional)

**You don't need to install anything!** Just use `npx` to run the init command:

```bash
npx @scry/storybook-deployer init --projectId xxx --apiKey yyy
```

However, if you prefer to install it as a development dependency:

```bash
# From npm (when published)
npm install @scry/storybook-deployer --save-dev

# From GitHub
npm install github:epinnock/scry-node --save-dev
# or
pnpm add github:epinnock/scry-node -D
# or
yarn add github:epinnock/scry-node --dev
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
| `--with-analysis` | `STORYBOOK_DEPLOYER_WITH_ANALYSIS` | Enable Storybook analysis (story crawling + screenshots).      | No       | `false`                              |
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
5. Add the following variable:

| Variable Name | Value | Example |
|--------------|-------|---------|
| `SCRY_PROJECT_ID` | Your project identifier | `my-storybook` or `company-design-system` |

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

**Step 5: Verify Deployment URL Pattern**

The workflow constructs deployment URLs using this pattern:
```
https://storybook-deployment-service.epinnock.workers.dev/{PROJECT_ID}/pr-{PR_NUMBER}
```

If your backend uses a different URL pattern, update line 41 in the workflow:

```yaml
DEPLOY_URL="https://your-backend.com/${PROJECT_ID}/pr-${{ github.event.pull_request.number }}"
```

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
| `SCRY_API_URL` | Hardcoded in workflow | **Yes** | Backend API endpoint URL |
| `SCRY_API_KEY` | GitHub Secret | No | API authentication key (if required) |

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

**Preview URL:** https://storybook-deployment-service.epinnock.workers.dev/my-project/pr-123

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
npx @scry/storybook-deployer init --projectId xxx --apiKey yyy --skip-gh-setup
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

## 🆘 Support

Need help?
- 📖 [Documentation](https://github.com/epinnock/scry-node)
- 🐛 [Report an issue](https://github.com/epinnock/scry-node/issues)
- 💬 [Discussions](https://github.com/epinnock/scry-node/discussions)
