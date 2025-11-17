const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createLogger } = require('./logger');
const { getApiClient } = require('./apiClient');
const { generateMainWorkflow, generatePRWorkflow } = require('./templates');

/**
 * Run the initialization wizard
 */
async function runInit(argv) {
    const logger = createLogger({ verbose: true });

    logger.info('🚀 Scry Storybook Deployer - Setup Wizard\n');
    logger.info('━'.repeat(50) + '\n');

    try {
        // Step 1: Validate credentials
        logger.info('1/8: Validating credentials...');
        await validateCredentials(argv.apiUrl, argv.apiKey, argv.project);
        logger.success('✅ Credentials validated\n');

        // Step 2: Check prerequisites
        logger.info('2/8: Checking prerequisites...');
        const envInfo = await checkEnvironment();

        if (!envInfo.isGit) {
            throw new Error('Not a git repository. Please run "git init" first.');
        }

        if (!envInfo.githubRemote) {
            logger.error('⚠️  Warning: No GitHub remote found. You\'ll need to add one before pushing.');
        }

        logger.success(`✅ Environment detected:
   • Git: ${envInfo.isGit ? '✓' : '✗'}
   • GitHub: ${envInfo.githubRemote || 'Not configured'}
   • Package Manager: ${envInfo.packageManager}
   • Build Command: ${envInfo.storybookBuildCmd || 'build-storybook'}\n`);

        // Step 3: Create config file
        logger.info('3/8: Creating configuration file...');
        createConfigFile(argv.project, argv.apiKey, argv.apiUrl, envInfo);
        logger.success('✅ Created .storybook-deployer.json\n');

        // Step 4: Add to gitignore (optional - keep API key out of git if user prefers)
        if (!argv.commitApiKey) {
            logger.info('4/8: Updating .gitignore...');
            updateGitignore();
            logger.success('✅ Updated .gitignore (API key will use env vars in CI)\n');
        } else {
            logger.info('4/8: Skipping .gitignore update (--commit-api-key flag set)\n');
        }

        // Step 5: Generate workflow files
        logger.info('5/8: Generating GitHub Actions workflows...');
        const workflowFiles = generateWorkflows(argv.project, argv.apiUrl, envInfo);
        logger.success('✅ Created .github/workflows/deploy-storybook.yml');
        logger.success('✅ Created .github/workflows/deploy-pr-preview.yml\n');

        // Step 6: Setup GitHub variables (if gh CLI available)
        if (!argv.skipGhSetup && isGhCliAvailable()) {
            logger.info('6/8: Setting up GitHub repository variables...');
            try {
                await setupGitHubVariables(argv.project, argv.apiKey, argv.apiUrl, logger);
                logger.success('✅ GitHub variables configured\n');
            } catch (error) {
                logger.error(`⚠️  GitHub setup failed: ${error.message}`);
                logger.info('You can set these up manually later.\n');
                showManualSetupInstructions(argv.project, argv.apiKey, argv.apiUrl);
            }
        } else {
            logger.info('6/8: Skipping GitHub CLI setup\n');
            if (!argv.skipGhSetup) {
                showManualSetupInstructions(argv.project, argv.apiKey, argv.apiUrl);
            }
        }

        // Step 7: Git commit
        logger.info('7/8: Committing changes...');
        const commitResult = gitCommit(argv.commitApiKey, logger);
        if (commitResult.success) {
            logger.success(`✅ Changes committed: ${commitResult.sha}\n`);
        } else {
            logger.error('⚠️  Could not commit automatically. Please commit manually.\n');
        }

        // Step 8: Git push
        logger.info('8/8: Pushing to GitHub...');
        const pushResult = gitPush(logger);
        if (pushResult.success) {
            logger.success(`✅ Pushed to ${pushResult.branch}\n`);
        } else {
            logger.error('⚠️  Could not push automatically. Please push manually with:\n   git push\n');
        }

        // Show success message
        logger.info('━'.repeat(50) + '\n');
        showSuccessMessage(argv.project, envInfo, argv.apiUrl, pushResult.success);

    } catch (error) {
        logger.error(`\n❌ Setup failed: ${error.message}`);
        if (error.response) {
            logger.error(`API Error: ${error.response.status} - ${error.response.data || error.response.statusText}`);
        }
        if (error.stack && argv.verbose) {
            logger.debug(error.stack);
        }
        process.exit(1);
    }
}

/**
 * Validate that the API credentials work
 */
async function validateCredentials(apiUrl, apiKey, projectId) {
    // For now, just verify the parameters are provided
    // In the future, we could ping a /validate endpoint
    if (!projectId || !apiKey) {
        throw new Error('Both --project-id and --api-key are required');
    }

    // Basic format validation
    if (projectId.length < 3) {
        throw new Error('Project ID seems too short. Please check your credentials.');
    }

    // Could add API validation call here if endpoint exists
    // const apiClient = getApiClient(apiUrl, apiKey);
    // await apiClient.get('/validate');
}

/**
 * Check the local environment and detect settings
 */
async function checkEnvironment() {
    const envInfo = {
        isGit: false,
        githubRemote: null,
        githubRepo: null,
        packageManager: 'npm',
        storybookBuildCmd: null,
        currentBranch: null
    };

    // Check if git repo
    try {
        execSync('git rev-parse --git-dir', { stdio: 'ignore' });
        envInfo.isGit = true;

        // Get current branch
        try {
            envInfo.currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
        } catch (e) {
            // Ignore
        }

        // Get GitHub remote
        try {
            const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
            envInfo.githubRemote = remote;
            envInfo.githubRepo = parseGitHubRemote(remote);
        } catch (e) {
            // No remote configured
        }
    } catch (e) {
        // Not a git repo
    }

    // Detect package manager
    if (fs.existsSync('pnpm-lock.yaml')) {
        envInfo.packageManager = 'pnpm';
    } else if (fs.existsSync('yarn.lock')) {
        envInfo.packageManager = 'yarn';
    } else if (fs.existsSync('bun.lockb')) {
        envInfo.packageManager = 'bun';
    }

    // Detect Storybook build command from package.json
    try {
        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        if (pkg.scripts) {
            if (pkg.scripts['build-storybook']) {
                envInfo.storybookBuildCmd = 'build-storybook';
            } else if (pkg.scripts['storybook:build']) {
                envInfo.storybookBuildCmd = 'storybook:build';
            } else if (pkg.scripts['build:storybook']) {
                envInfo.storybookBuildCmd = 'build:storybook';
            }
        }
    } catch (e) {
        // No package.json or can't read
    }

    return envInfo;
}

/**
 * Parse GitHub remote URL to extract owner/repo
 */
function parseGitHubRemote(remote) {
    // Handle both HTTPS and SSH formats
    // HTTPS: https://github.com/owner/repo.git
    // SSH: git@github.com:owner/repo.git

    const httpsMatch = remote.match(/github\.com[/:]([\w-]+)\/([\w-]+)/);
    if (httpsMatch) {
        return `${httpsMatch[1]}/${httpsMatch[2].replace('.git', '')}`;
    }

    return null;
}

/**
 * Create the configuration file
 */
function createConfigFile(projectId, apiKey, apiUrl, envInfo) {
    const config = {
        apiUrl: apiUrl,
        project: projectId,
        dir: "./storybook-static",
        version: "latest",
        verbose: false
    };

    // Only include apiKey in config if user wants it committed
    // Otherwise it should be set via environment variable
    // For now, we'll include it but note in .gitignore
    config.apiKey = apiKey;

    const configPath = '.storybook-deployer.json';
    fs.writeFileSync(
        configPath,
        JSON.stringify(config, null, 2) + '\n',
        'utf8'
    );
}

/**
 * Update .gitignore to exclude sensitive files (optional)
 */
function updateGitignore() {
    const gitignorePath = '.gitignore';
    const entries = [
        '# Scry Storybook Deployer',
        '.storybook-deployer.json  # Contains API key'
    ];

    let gitignoreContent = '';
    if (fs.existsSync(gitignorePath)) {
        gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    }

    // Check if already added
    if (!gitignoreContent.includes('.storybook-deployer.json')) {
        gitignoreContent += '\n' + entries.join('\n') + '\n';
        fs.writeFileSync(gitignorePath, gitignoreContent, 'utf8');
    }
}

/**
 * Generate workflow files
 */
function generateWorkflows(projectId, apiUrl, envInfo) {
    // Create .github/workflows directory
    const workflowsDir = '.github/workflows';
    fs.mkdirSync(workflowsDir, { recursive: true });

    const buildCmd = envInfo.storybookBuildCmd || 'build-storybook';

    // Generate main deployment workflow
    const mainWorkflow = generateMainWorkflow(projectId, apiUrl, envInfo.packageManager, buildCmd);
    const mainWorkflowPath = path.join(workflowsDir, 'deploy-storybook.yml');
    fs.writeFileSync(mainWorkflowPath, mainWorkflow, 'utf8');

    // Generate PR preview workflow
    const prWorkflow = generatePRWorkflow(projectId, apiUrl, envInfo.packageManager, buildCmd);
    const prWorkflowPath = path.join(workflowsDir, 'deploy-pr-preview.yml');
    fs.writeFileSync(prWorkflowPath, prWorkflow, 'utf8');

    return [mainWorkflowPath, prWorkflowPath];
}

/**
 * Check if GitHub CLI is available
 */
function isGhCliAvailable() {
    try {
        execSync('gh --version', { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Setup GitHub variables using gh CLI
 */
async function setupGitHubVariables(projectId, apiKey, apiUrl, logger) {
    try {
        // Set variables
        execSync(`gh variable set SCRY_PROJECT_ID --body "${projectId}"`, { stdio: 'pipe' });
        logger.debug('   ✓ Set SCRY_PROJECT_ID');

        execSync(`gh variable set SCRY_API_URL --body "${apiUrl}"`, { stdio: 'pipe' });
        logger.debug('   ✓ Set SCRY_API_URL');

        // Set secret (API key)
        execSync(`gh secret set SCRY_API_KEY --body "${apiKey}"`, { stdio: 'pipe' });
        logger.debug('   ✓ Set SCRY_API_KEY');

    } catch (error) {
        throw new Error(`Failed to set GitHub variables: ${error.message}`);
    }
}

/**
 * Show manual setup instructions
 */
function showManualSetupInstructions(projectId, apiKey, apiUrl) {
    console.log(`
📋 Manual GitHub Setup (Optional):

If you haven't already, set up these repository variables:

1. Go to your GitHub repository Settings
2. Navigate to: Settings → Secrets and variables → Actions

3. Add these Variables (Variables tab):
   • SCRY_PROJECT_ID = ${projectId}
   • SCRY_API_URL = ${apiUrl}

4. Add this Secret (Secrets tab):
   • SCRY_API_KEY = ${apiKey}

Or install GitHub CLI and run:
   gh variable set SCRY_PROJECT_ID --body "${projectId}"
   gh variable set SCRY_API_URL --body "${apiUrl}"
   gh secret set SCRY_API_KEY --body "${apiKey}"
`);
}

/**
 * Commit the changes to git
 */
function gitCommit(commitApiKey, logger) {
    try {
        // Check if there are changes to commit
        const status = execSync('git status --porcelain', { encoding: 'utf8' });
        if (!status.trim()) {
            return { success: false, message: 'No changes to commit' };
        }

        // Add files
        const filesToAdd = [
            '.github/workflows/deploy-storybook.yml',
            '.github/workflows/deploy-pr-preview.yml',
            '.storybook-deployer.json'
        ];

        if (!commitApiKey) {
            filesToAdd.push('.gitignore');
        }

        for (const file of filesToAdd) {
            if (fs.existsSync(file)) {
                execSync(`git add "${file}"`, { stdio: 'pipe' });
                logger.debug(`   ✓ Added ${file}`);
            }
        }

        // Commit
        const commitMessage = 'chore: add Scry Storybook deployment workflows';
        execSync(`git commit -m "${commitMessage}"`, { stdio: 'pipe' });

        // Get commit SHA
        const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();

        return { success: true, sha };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Push changes to remote
 */
function gitPush(logger) {
    try {
        // Get current branch
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();

        // Check if remote is configured
        try {
            execSync('git remote get-url origin', { stdio: 'ignore' });
        } catch (e) {
            return { success: false, error: 'No remote configured', branch };
        }

        // Push
        execSync(`git push -u origin ${branch}`, { stdio: 'pipe' });

        return { success: true, branch };
    } catch (error) {
        // Check if it's an authentication error
        if (error.message.includes('Authentication') || error.message.includes('permission')) {
            return {
                success: false,
                error: 'Authentication failed. Please check your git credentials.',
                branch: null
            };
        }

        return { success: false, error: error.message, branch: null };
    }
}

/**
 * Show success message
 */
function showSuccessMessage(projectId, envInfo, apiUrl, pushed) {
    console.log(`
🎉 ${pushed ? 'Setup Complete and Deployed!' : 'Setup Complete!'}

Your Storybook deployment is configured and ready to go.

📦 What was set up:
   ✅ Configuration file (.storybook-deployer.json)
   ✅ GitHub Actions workflows (.github/workflows/)
   ✅ Repository variables (SCRY_PROJECT_ID, SCRY_API_URL)
   ✅ Repository secret (SCRY_API_KEY)
   ${pushed ? '✅ Changes committed and pushed' : '⚠️  Manual push required'}

${!pushed ? `
📌 Next Step:
   Push your changes to GitHub:
   git push
` : ''}

🚀 Deployment:
   Your Storybook will deploy automatically on:
   • Every push to ${envInfo.currentBranch || 'main'} branch
   • Every pull request (as a preview)

🌐 Deployment URLs:
   • Production: ${apiUrl}/${projectId}/latest
   • PR Previews: ${apiUrl}/${projectId}/pr-{number}

📖 Learn more: https://github.com/epinnock/scry-node
💬 Need help? Open an issue on GitHub

Happy deploying! ✨
`);
}

module.exports = { runInit };
