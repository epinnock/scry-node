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
> ```bash
> npx storybook-deploy-setup
> ```
> Or manually create the config file at `~/.storybook-deployer.json` with your preferred defaults (see [Configuration File](#configuration-file) section below).

**Automatic Configuration**: Upon installation, a configuration file (`~/.storybook-deployer.json`) is automatically created in your home directory. This allows you to set default values and reduce the need for repetitive command-line arguments.

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
| `--api-key`    | `STORYBOOK_DEPLOYER_API_KEY`          | The API key for the deployment service.                        | Yes      | -                                    |
| `--api-url`    | `STORYBOOK_DEPLOYER_API_URL`          | Base URL for the deployment service API.                       | No       | `https://api.default-service.com/v1`  |
| `--commit-sha` | `STORYBOOK_DEPLOYER_COMMIT_SHA`       | The Git commit SHA that triggered the deployment.              | No       | -                                    |
| `--branch`     | `STORYBOOK_DEPLOYER_BRANCH`           | The Git branch from which the deployment was initiated.        | No       | -                                    |
| `--verbose`    | `STORYBOOK_DEPLOYER_VERBOSE`          | Enable verbose logging for debugging purposes.                 | No       | `false`                              |
| `--help`, `-h` | -                                     | Show the help message.                                       | -        | -                                    |
| `--version`, `-v`| -                                     | Show the version number.                                     | -        | -                                    |

### Configuration Hierarchy

The configuration is resolved in the following order of precedence:
1.  **Command-Line Arguments**: Highest precedence (e.g., `--api-key=some_key`).
2.  **Environment Variables**: Sourced from the execution environment (e.g., `STORYBOOK_DEPLOYER_API_KEY=some_key`).
3.  **Configuration File**: Values from `~/.storybook-deployer.json` (automatically created during installation).
4.  **Programmatic Defaults**: Lowest precedence (e.g., for `--api-url`).

### Configuration File

The configuration file (`~/.storybook-deployer.json`) is automatically created in your home directory when you install the package. You can edit this file to set default values for common options:

```json
{
  "apiKey": "your-api-key-here",
  "apiUrl": "https://api.your-service.com/v1",
  "dir": "./storybook-static",
  "verbose": false
}
```

**Property Reference:**
- `apiKey` → `--api-key` CLI option
- `apiUrl` → `--api-url` CLI option
- `dir` → `--dir` CLI option
- `commitSha` → `--commit-sha` CLI option
- `branch` → `--branch` CLI option
- `verbose` → `--verbose` CLI option

### Usage Examples

**Basic usage with config file:**
```bash
# Set apiKey in ~/.storybook-deployer.json, then run:
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
  --api-key $API_KEY \
  --commit-sha $GITHUB_SHA \
  --branch $GITHUB_REF_NAME \
  --verbose
```

## Example CI/CD Integration (GitHub Actions)

This tool is ideal for use in a GitHub Actions workflow. The API key should be stored as a [GitHub Secret](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions).

See the example workflow file: `.github/workflows/deploy-example.yml`
