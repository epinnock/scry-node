# Workflow Templates

These are GitHub Actions workflow templates for projects that use `@scrymore/scry-deployer`.

**These files are NOT active workflows** - they are templates to be copied into your project's `.github/workflows/` directory.

## Available Templates

### deploy-storybook.yml
Deploys Storybook to Scry on push to main/master branch.

### deploy-pr-preview.yml
Creates preview deployments for pull requests with automatic PR comments.

### deploy-example.yml
A basic example workflow that can be manually triggered.

## Usage

1. Copy the desired workflow file to your project's `.github/workflows/` directory
2. Configure the required secrets and variables in your repository settings:
   - `SCRY_API_KEY` (secret) - Your Scry API key
   - `SCRY_API_URL` (variable) - The Scry API URL
   - `SCRY_PROJECT_ID` (variable) - Your project ID
3. Adjust the workflow as needed for your project (e.g., package manager, build commands)
