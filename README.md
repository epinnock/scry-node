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
npm install @jules/storybook-deployer --save-dev
```

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
3.  **Programmatic Defaults**: Lowest precedence (e.g., for `--api-url`).

## Example CI/CD Integration (GitHub Actions)

This tool is ideal for use in a GitHub Actions workflow. The API key should be stored as a [GitHub Secret](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions).

See the example workflow file: `.github/workflows/deploy-example.yml`
