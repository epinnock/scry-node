#!/usr/bin/env node

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { zipDirectory } = require('../lib/archive.js');
const { createMasterZip } = require('../lib/archiveUtils.js');
const { getApiClient, uploadFileDirectly } = require('../lib/apiClient.js');
const { createLogger } = require('../lib/logger.js');
const { AppError, ApiError } = require('../lib/errors.js');
const { loadConfig } = require('../lib/config.js');
const { captureScreenshots } = require('../lib/screencap.js');
const { analyzeStorybook } = require('../lib/analysis.js');
const { runInit } = require('../lib/init.js');

async function runAnalysis(argv) {
    const logger = createLogger(argv);
    logger.info('📊 Starting Storybook analysis...');
    logger.debug(`Received arguments: ${JSON.stringify(argv)}`);

    const outPath = path.join(os.tmpdir(), `storybook-analysis-${Date.now()}.zip`);

    try {
        // 1. Capture screenshots if storybook URL provided
        if (argv.storybookUrl) {
            logger.info(`1/4: Capturing screenshots from '${argv.storybookUrl}'...`);
            await captureScreenshots(argv.storybookUrl, argv.storycapOptions || {});
            logger.success('✅ Screenshots captured');
        } else {
            logger.info('1/4: Skipping screenshot capture (no Storybook URL provided)');
        }

        // 2. Analyze stories and map screenshots
        logger.info('2/4: Analyzing stories and mapping screenshots...');
        const analysisResults = analyzeStorybook({
            storiesDir: argv.storiesDir,
            screenshotsDir: argv.screenshotsDir,
            project: argv.project,
            version: argv.version
        });
        logger.success(`✅ Found ${analysisResults.summary.totalStories} stories (${analysisResults.summary.withScreenshots} with screenshots)`);
        logger.debug(`Analysis complete: ${JSON.stringify(analysisResults.summary)}`);

        // 3. Create master ZIP
        logger.info('3/4: Creating master archive...');
        await createMasterZip({
            outPath: outPath,
            staticsiteDir: null, // No static site for analyze-only
            screenshotsDir: argv.screenshotsDir,
            metadata: analysisResults
        });
        logger.success(`✅ Master archive created: ${outPath}`);
        logger.debug(`Archive size: ${fs.statSync(outPath).size} bytes`);

        // 4. Upload archive
        logger.info('4/4: Uploading to deployment service...');
        const apiClient = getApiClient(argv.apiUrl, argv.apiKey);
        const uploadResult = await uploadFileDirectly(apiClient, {
            project: argv.project,
            version: argv.version,
        }, outPath);
        logger.success('✅ Archive uploaded.');
        logger.debug(`Upload result: ${JSON.stringify(uploadResult)}`);

        logger.success('\n🎉 Analysis complete! 🎉');

    } finally {
        // Clean up the local archive
        if (fs.existsSync(outPath)) {
            fs.unlinkSync(outPath);
            logger.info(`🧹 Cleaned up temporary file: ${outPath}`);
        }
    }
}

async function runDeployment(argv) {
    const logger = createLogger(argv);
    logger.info('🚀 Starting deployment...');
    logger.debug(`Received arguments: ${JSON.stringify(argv)}`);

    const outPath = path.join(os.tmpdir(), `storybook-deployment-${Date.now()}.zip`);

    try {
        if (argv.withAnalysis) {
            // Full deployment with analysis
            logger.info('Running deployment with analysis...');

            // 1. Capture screenshots if storybook URL provided
            if (argv.storybookUrl) {
                logger.info(`1/5: Capturing screenshots from '${argv.storybookUrl}'...`);
                await captureScreenshots(argv.storybookUrl, argv.storycapOptions || {});
                logger.success('✅ Screenshots captured');
            } else {
                logger.info('1/5: Skipping screenshot capture (no Storybook URL provided)');
            }

            // 2. Analyze stories and map screenshots
            logger.info('2/5: Analyzing stories and mapping screenshots...');
            const analysisResults = analyzeStorybook({
                storiesDir: argv.storiesDir,
                screenshotsDir: argv.screenshotsDir,
                project: argv.project,
                version: argv.version
            });
            logger.success(`✅ Found ${analysisResults.summary.totalStories} stories (${analysisResults.summary.withScreenshots} with screenshots)`);

            // 3. Create master ZIP with staticsite, images, and metadata
            logger.info('3/5: Creating master archive with static site, images, and metadata...');
            await createMasterZip({
                outPath: outPath,
                staticsiteDir: argv.dir,
                screenshotsDir: argv.screenshotsDir,
                metadata: analysisResults
            });
            logger.success(`✅ Master archive created: ${outPath}`);
            logger.debug(`Archive size: ${fs.statSync(outPath).size} bytes`);

            // 4. Upload archive
            logger.info('4/5: Uploading to deployment service...');
            const apiClient = getApiClient(argv.apiUrl, argv.apiKey);
            const uploadResult = await uploadFileDirectly(apiClient, {
                project: argv.project,
                version: argv.version,
            }, outPath);
            logger.success('✅ Archive uploaded.');
            logger.debug(`Upload result: ${JSON.stringify(uploadResult)}`);

            logger.success('\n🎉 Deployment with analysis successful! 🎉');

        } else {
            // Simple deployment without analysis
            // 1. Archive the directory
            logger.info(`1/3: Zipping directory '${argv.dir}'...`);
            await zipDirectory(argv.dir, outPath);
            logger.success(`✅ Archive created: ${outPath}`);
            logger.debug(`Archive size: ${fs.statSync(outPath).size} bytes`);

            // 2. Authenticate and upload directly
            logger.info('2/3: Uploading to deployment service...');
            const apiClient = getApiClient(argv.apiUrl, argv.apiKey);
            const uploadResult = await uploadFileDirectly(apiClient, {
                project: argv.project,
                version: argv.version,
            }, outPath);
            logger.success('✅ Archive uploaded.');
            logger.debug(`Upload result: ${JSON.stringify(uploadResult)}`);

            logger.success('\n🎉 Deployment successful! 🎉');
        }

    } finally {
        // 4. Clean up the local archive
        if (fs.existsSync(outPath)) {
            fs.unlinkSync(outPath);
            logger.info(`🧹 Cleaned up temporary file: ${outPath}`);
        }
    }
}

function handleError(error, argv) {
    const logger = createLogger(argv || {});
    logger.error(`\n❌ Error: ${error.message}`);

    if (error instanceof ApiError) {
        if (error.statusCode === 401) {
            logger.error('Suggestion: Check that your API key is correct and has not expired.');
        } else if (error.statusCode >= 500) {
            logger.error('Suggestion: This seems to be a server-side issue. Please try again later or contact support.');
        }
    }

    if (argv && argv.verbose && error.stack) {
        logger.debug(error.stack);
    }

    process.exit(1);
}

async function main() {
    let config;
    try {
        const args = await yargs(hideBin(process.argv))
            .command('$0', 'Deploy Storybook static build', (yargs) => {
                return yargs
                    .option('dir', {
                        describe: 'Path to the built Storybook directory (e.g., storybook-static)',
                        type: 'string',
                    })
                    .option('api-key', {
                        describe: 'API key for the deployment service',
                        type: 'string',
                    })
                    .option('api-url', {
                        describe: 'Base URL for the deployment service API',
                        type: 'string',
                    })
                    .option('project', {
                        describe: 'Project name/identifier',
                        type: 'string',
                    })
                    .option('version', {
                        describe: 'Version identifier for the deployment',
                        type: 'string',
                    })
                    .option('with-analysis', {
                        describe: 'Include Storybook analysis (screenshots, metadata)',
                        type: 'boolean',
                    })
                    .option('storybook-url', {
                        describe: 'URL of the Storybook for screenshot capture',
                        type: 'string',
                    })
                    .option('stories-dir', {
                        describe: 'Directory containing story files',
                        type: 'string',
                    })
                    .option('screenshots-dir', {
                        describe: 'Directory for screenshots',
                        type: 'string',
                    })
                    .option('verbose', {
                        describe: 'Enable verbose logging',
                        type: 'boolean',
                    });
            }, async (argv) => {
                // Load and merge configuration
                config = loadConfig(argv);

                // Validate required fields
                if (!config.dir) {
                    throw new Error('--dir is required. You can provide it via CLI arguments, config file, or environment variables.');
                }

                // Validate directory exists and is valid
                if (!fs.existsSync(config.dir)) {
                    throw new Error(`Directory not found at path: ${config.dir}`);
                }
                if (!fs.lstatSync(config.dir).isDirectory()) {
                    throw new Error(`Path is not a directory: ${config.dir}`);
                }

                await runDeployment(config);
            })
            .command('analyze', 'Analyze Storybook stories and generate metadata', (yargs) => {
                return yargs
                    .option('project', {
                        describe: 'Project name/identifier',
                        type: 'string',
                        demandOption: true,
                    })
                    .option('version', {
                        describe: 'Version identifier',
                        type: 'string',
                        demandOption: true,
                    })
                    .option('api-key', {
                        describe: 'API key for the deployment service',
                        type: 'string',
                    })
                    .option('api-url', {
                        describe: 'Base URL for the deployment service API',
                        type: 'string',
                    })
                    .option('storybook-url', {
                        describe: 'URL of the Storybook for screenshot capture',
                        type: 'string',
                    })
                    .option('stories-dir', {
                        describe: 'Directory containing story files',
                        type: 'string',
                    })
                    .option('screenshots-dir', {
                        describe: 'Directory for screenshots',
                        type: 'string',
                    })
                    .option('verbose', {
                        describe: 'Enable verbose logging',
                        type: 'boolean',
                    });
            }, async (argv) => {
                // Load and merge configuration
                config = loadConfig(argv);

                await runAnalysis(config);
            })
            .command('init', 'Setup GitHub Actions workflows for automatic deployment', (yargs) => {
                return yargs
                    .option('project-id', {
                        describe: 'Project ID from Scry dashboard',
                        type: 'string',
                        demandOption: true,
                        alias: 'projectId'
                    })
                    .option('api-key', {
                        describe: 'API key from Scry dashboard',
                        type: 'string',
                        demandOption: true,
                        alias: 'apiKey'
                    })
                    .option('api-url', {
                        describe: 'Scry API URL',
                        type: 'string',
                        default: 'https://storybook-deployment-service.epinnock.workers.dev',
                        alias: 'apiUrl'
                    })
                    .option('skip-gh-setup', {
                        describe: 'Skip GitHub CLI variable setup',
                        type: 'boolean',
                        default: false,
                        alias: 'skipGhSetup'
                    })
                    .option('commit-api-key', {
                        describe: 'Commit API key in config file (not recommended)',
                        type: 'boolean',
                        default: true,
                        alias: 'commitApiKey'
                    })
                    .option('verbose', {
                        describe: 'Enable verbose logging',
                        type: 'boolean',
                        default: false
                    });
            }, async (argv) => {
                // Map projectId/apiKey to project/apiKey for consistency
                const initConfig = {
                    project: argv.projectId,
                    apiKey: argv.apiKey,
                    apiUrl: argv.apiUrl,
                    skipGhSetup: argv.skipGhSetup,
                    commitApiKey: argv.commitApiKey,
                    verbose: argv.verbose
                };

                await runInit(initConfig);
            })
            .env('STORYBOOK_DEPLOYER')
            .help()
            .alias('help', 'h')
            .version()
            .alias('version', 'v')
            .parse();

    } catch (error) {
        handleError(error, config);
    }
}

main();
