# Storybook Deployer CLI

A client-side Command-Line Interface (CLI) tool to automate the deployment of Storybook static builds.

This tool is designed for execution within a CI/CD pipeline (such as GitHub Actions). The core workflow involves:
1.  Archiving a specified Storybook build directory.
2.  Authenticating with a secure backend service.
3.  Requesting a presigned URL for upload.
4.  Uploading the archive directly to cloud storage.

**NEW**: Now includes Storybook analysis capabilities for extracting story metadata and capturing screenshots!

## Features

- 🚀 Simple Storybook static build deployment
- 📊 Story metadata extraction and analysis
- 📸 Automated screenshot capture with storycap
- 📦 Organized master ZIP packaging (staticsite, images, metadata)
- ⚙️ Flexible configuration (CLI, env vars, config file)
- 🔒 Secure presigned URL uploads

## Installation

Assuming the package is published to npm, you can install it as a development dependency in your project:

```bash
npm install @scry/storybook-deployer --save-dev
```

**Install from GitHub:**

You can also install directly from the GitHub repository:

```bash
# Using npm
npm install github:epinnock/scry-node --save-dev

# Or with the full URL
npm install https://github.com/epinnock/scry-node --save-dev

# Using pnpm
pnpm add github:epinnock/scry-node -D

# Using yarn
yarn add https://github.com/epinnock/scry-node --dev
```

> **Note:** Some package managers (like pnpm) may limit postinstall scripts. If the configuration file is not automatically created, manually run the setup:
>
> ```bash
> npx storybook-deploy-setup
> ```
>
> Or manually create the config file at `.storybook-deployer.json` in your project directory with your preferred defaults (see [Configuration File](#configuration-file) section below).

**Automatic Configuration**: Upon installation, a configuration file (`.storybook-deployer.json`) is automatically created in your project directory. This allows you to set default values and reduce the need for repetitive command-line arguments.

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
| `--stories-dir` | `STORYBOOK_DEPLOYER_STORIES_DIR`     | Path to stories directory for analysis.                        | No       | `./src`                              |
| `--screenshots-dir` | `STORYBOOK_DEPLOYER_SCREENSHOTS_DIR` | Directory for captured screenshots.                        | No       | `./screenshots`                      |
| `--storybook-url` | `STORYBOOK_DEPLOYER_STORYBOOK_URL` | URL of running Storybook server for screenshot capture.        | No       | `http://localhost:6006`              |
| `--verbose`    | `STORYBOOK_DEPLOYER_VERBOSE`          | Enable verbose logging for debugging purposes.                 | No       | `false`                              |
| `--help`, `-h` | -                                     | Show the help message.                                       | -        | -                                    |
| `--version`, `-v`| -                                     | Show the version number.                                     | -        | -                                    |

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
# Deploy with story metadata and screenshots
npx storybook-deploy \
  --dir ./storybook-static \
  --with-analysis \
  --stories-dir ./src \
  --storybook-url http://localhost:6006
```

**Standalone analysis (no deployment):**
```bash
# Analyze stories and capture screenshots only
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

When analysis is enabled (`--with-analysis`), the tool creates a master ZIP file named `{project}-{version}.zip` with the following structure:

```
my-project-v1.0.0.zip
├── staticsite/          # Your Storybook static build
│   ├── index.html
│   ├── iframe.html
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

Without analysis, only the static site is zipped and uploaded as `{project}-{version}.zip`.

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
      --stories-dir ./src \
      --storybook-url http://localhost:6006
```

See the example workflow file: `.github/workflows/deploy-example.yml`
