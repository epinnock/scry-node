# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js CLI tool called `@jules/storybook-deployer` that automates the deployment of Storybook static builds to cloud storage. The tool is designed for CI/CD pipeline integration, particularly with GitHub Actions.

## Commands

### Running the CLI
```bash
# Install and run with npx
npx storybook-deploy --dir ./storybook-static --api-key YOUR_API_KEY

# With additional options
npx storybook-deploy \
  --dir ./storybook-static \
  --api-key YOUR_API_KEY \
  --commit-sha abc123 \
  --branch main \
  --verbose
```

### Testing
Currently, there are no test scripts configured. The package.json test script outputs an error message.

### Development
```bash
# Install dependencies
npm install

# Run the CLI directly from source
node bin/cli.js --help
```

## Architecture

### Core Components

The application follows a modular architecture with clear separation of concerns:

**Entry Point (`bin/cli.js`):**
- Command-line argument parsing using yargs
- Orchestrates the three-phase deployment process:
  1. Archive creation (zipping the Storybook directory)
  2. API authentication and presigned URL request
  3. File upload to cloud storage
- Comprehensive error handling with user-friendly messages
- Temporary file cleanup

**Library Modules (`lib/`):**

- **`archive.js`**: Handles directory compression using the archiver library with maximum compression (level 9)
- **`apiClient.js`**: Manages HTTP communication with the deployment service API, including authentication, presigned URL requests, and file uploads
- **`logger.js`**: Provides colored console output with different log levels (info, success, error, debug) controlled by verbose mode
- **`errors.js`**: Defines custom error classes for different failure scenarios (AppError, FileSystemError, ApiError, UploadError)

### Configuration

The tool supports configuration through both command-line arguments and environment variables (prefixed with `STORYBOOK_DEPLOYER_`). Command-line arguments take precedence over environment variables.

Required parameters:
- `--dir`: Path to built Storybook directory
- `--api-key`: Authentication key for the deployment service

Optional parameters:
- `--api-url`: Custom API endpoint (defaults to `https://api.default-service.com/v1`)
- `--commit-sha`: Git commit SHA for tracking
- `--branch`: Git branch name for tracking
- `--verbose`: Enable debug logging

### Error Handling

The application implements comprehensive error handling with specific error types:
- **ApiError**: HTTP communication failures with status codes
- **UploadError**: File upload failures to cloud storage
- **FileSystemError**: Local file system operations (zipping)
- **AppError**: Base class for all application errors

Error messages include helpful suggestions for common issues (e.g., 401 authentication failures, 500 server errors).

### CI/CD Integration

The tool is specifically designed for GitHub Actions workflows. The repository includes an example workflow file (`.github/workflows/deploy-example.yml`) that demonstrates:
- Building Storybook
- Deploying using this CLI tool
- Secure handling of API keys through GitHub Secrets

## Dependencies

Key dependencies:
- **yargs**: Command-line argument parsing and validation
- **axios**: HTTP client for API communication and file uploads
- **archiver**: Creating ZIP archives from directories
- **chalk**: Terminal output coloring
- **fs**: File system operations (built-in Node.js module)

## Development Notes

- The codebase uses CommonJS modules (`require`/`module.exports`)
- No TypeScript configuration
- No linting or formatting tools configured
- The tool creates temporary ZIP files in the system temp directory and cleans them up automatically
- Mock error conditions are built into `apiClient.js` for testing specific failure scenarios