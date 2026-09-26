const { createLogger } = require('./logger');
const { generateMainWorkflow, generatePRWorkflow } = require('./templates');
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

/**
 * Upgrade-only workflow generator.
 *
 * Goal: allow users to refresh .github/workflows/* to the latest templates
 * WITHOUT needing the Scry API key.
 *
 * This intentionally does NOT:
 * - validate credentials
 * - touch .storybook-deployer.json
 * - set GitHub variables/secrets
 */
async function runUpdateWorkflows(argv) {
  const logger = createLogger({ verbose: Boolean(argv.verbose) });

  logger.info('🛠️  Updating Scry GitHub Actions workflows...');

  const envInfo = await checkEnvironment();
  if (!envInfo.isGit) {
    throw new Error('Not a git repository. Please run this from a git repo.');
  }

  const workflowsDir = '.github/workflows';
  fs.mkdirSync(workflowsDir, { recursive: true });

  const buildCmd = envInfo.storybookBuildCmd || 'build-storybook';

  const mainWorkflow = generateMainWorkflow('', '', envInfo.packageManager, buildCmd);
  const prWorkflow = generatePRWorkflow('', '', envInfo.packageManager, buildCmd);

  const mainWorkflowPath = path.join(workflowsDir, 'deploy-storybook.yml');
  const prWorkflowPath = path.join(workflowsDir, 'deploy-pr-preview.yml');

  fs.writeFileSync(mainWorkflowPath, mainWorkflow, 'utf8');
  fs.writeFileSync(prWorkflowPath, prWorkflow, 'utf8');

  logger.success(`✅ Updated ${mainWorkflowPath}`);
  logger.success(`✅ Updated ${prWorkflowPath}`);
  logger.info(`   Package manager: ${envInfo.packageManager}; Storybook build script: ${buildCmd}${envInfo.storybookBuildCmd ? '' : ' (not found in package.json; the default name was used, check it)'}`);
  logger.info('   The deployer is installed at @scrymore/scry-deployer@^0.7.0 in its own folder with its own Playwright browser.');

  if (argv.commit) {
    gitAdd([mainWorkflowPath, prWorkflowPath], logger);
    gitCommit(argv.commitMessage || 'chore: update Scry workflows', logger);
  }

  logger.success('✅ Workflow update complete');
}

async function checkEnvironment() {
  const envInfo = {
    isGit: false,
    packageManager: 'npm',
    storybookBuildCmd: null,
  };

  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    envInfo.isGit = true;
  } catch {
    envInfo.isGit = false;
  }

  if (fs.existsSync('pnpm-lock.yaml')) {
    envInfo.packageManager = 'pnpm';
  } else if (fs.existsSync('yarn.lock')) {
    envInfo.packageManager = 'yarn';
  } else if (fs.existsSync('bun.lockb')) {
    envInfo.packageManager = 'bun';
  }

  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (pkg.scripts) {
      if (pkg.scripts['build-storybook']) envInfo.storybookBuildCmd = 'build-storybook';
      else if (pkg.scripts['storybook:build']) envInfo.storybookBuildCmd = 'storybook:build';
      else if (pkg.scripts['build:storybook']) envInfo.storybookBuildCmd = 'build:storybook';
    }
  } catch {
    // ignore
  }

  return envInfo;
}

function gitAdd(files, logger) {
  for (const file of files) {
    if (fs.existsSync(file)) {
      execFileSync('git', ['add', '--', file], { stdio: 'pipe' });
      logger.debug(`   ✓ Added ${file}`);
    }
  }
}

function gitCommit(message, logger) {
  const status = execSync('git status --porcelain', { encoding: 'utf8' });
  if (!status.trim()) {
    logger.info('No changes to commit.');
    return;
  }

  // execFile, not a shell string: the message is user input.
  execFileSync('git', ['commit', '-m', String(message)], { stdio: 'pipe' });
  const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  logger.success(`✅ Committed workflow update: ${sha}`);
}

module.exports = { runUpdateWorkflows, checkEnvironment };
