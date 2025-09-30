# Storybook Deployer CLI

A client-side Command-Line Interface (CLI) tool to automate the deployment of Storybook static builds.

This tool is designed for execution within a CI/CD pipeline (such as GitHub Actions). The core workflow involves:
1.  Archiving a specified Storybook build directory.
2.  Authenticating with a secure backend service.
3.  Requesting a presigned URL for upload.
4.  Uploading the archive directly to cloud storage.

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
1. **Presigned URL**: `POST /presigned-url/{project}/{version}/storybook.zip`
2. **Direct Upload**: `PUT` to the presigned URL returned from step 1

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

### Options

The CLI is configured through a combination of command-line options and environment variables. Command-line options always take precedence.

| Option         | Environment Variable                  | Description                                                  | Required | Default                              |
|----------------|---------------------------------------|--------------------------------------------------------------|----------|--------------------------------------|
| `--dir`        | `STORYBOOK_DEPLOYER_DIR`              | Path to the built Storybook directory (e.g., `storybook-static`). | Yes      | -                                    |
| `--api-key`    | `STORYBOOK_DEPLOYER_API_KEY`          | The API key for the deployment service.                        | No       | -                                    |
| `--api-url`    | `STORYBOOK_DEPLOYER_API_URL`          | Base URL for the deployment service API.                       | No       | `https://api.default-service.com/v1`  |
| `--project`    | `STORYBOOK_DEPLOYER_PROJECT`          | The project name/identifier.                                   | No       | `main`                               |
| `--version`    | `STORYBOOK_DEPLOYER_VERSION`          | The version identifier for the deployment.                     | No       | `latest`                             |
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

### Usage Examples

**Basic usage with config file:**
```bash
# Set project and version in .storybook-deployer.json, then run:
npx storybook-deploy --dir ./storybook-static
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

## Example CI/CD Integration (GitHub Actions)

This tool is ideal for use in a GitHub Actions workflow. The API key should be stored as a [GitHub Secret](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions).

**Example workflow:**
```yaml
- name: Deploy Storybook
  env:
    STORYBOOK_DEPLOYER_API_URL: https://storybook-deployment-service.epinnock.workers.dev
    STORYBOOK_DEPLOYER_PROJECT: ${{ github.event.repository.name }}
    STORYBOOK_DEPLOYER_VERSION: ${{ github.sha }}
  run: npx storybook-deploy --dir ./storybook-static
```

See the example workflow file: `.github/workflows/deploy-example.yml`
