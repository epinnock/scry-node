#!/usr/bin/env node

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const path = require('path');
const os =require('os');
const { zipDirectory } = require('../lib/archive.js');
const { getApiClient, requestPresignedUrl, uploadFile } = require('../lib/apiClient.js');
const { createLogger } = require('../lib/logger.js');
const { AppError, ApiError } = require('../lib/errors.js');
const { loadConfig } = require('../lib/config.js');

async function runDeployment(argv) {
    const logger = createLogger(argv);
    logger.info('🚀 Starting deployment...');
    logger.debug(`Received arguments: ${JSON.stringify(argv)}`);

    const outPath = path.join(os.tmpdir(), `storybook-deployment-${Date.now()}.zip`);

    try {
        // 1. Archive the directory
        logger.info(`1/3: Zipping directory '${argv.dir}'...`);
        await zipDirectory(argv.dir, outPath);
        logger.success(`✅ Archive created: ${outPath}`);
        logger.debug(`Archive size: ${fs.statSync(outPath).size} bytes`);

        // 2. Authenticate and get presigned URL
        logger.info('2/3: Requesting upload URL...');
        const apiClient = getApiClient(argv.apiUrl, argv.apiKey);
        const uploadUrl = await requestPresignedUrl(apiClient, {
            project: argv.project,
            version: argv.version,
        });
        logger.debug(`Received upload URL: ${uploadUrl.substring(0, 40)}...`);

        // 3. Upload the archive
        logger.info('3/3: Uploading archive...');
        await uploadFile(uploadUrl, outPath);
        logger.success('✅ Archive uploaded.');

        logger.success('\n🎉 Deployment successful! 🎉');

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
        // First parse CLI args to get raw user input
        const cliArgs = await yargs(hideBin(process.argv))
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
            .option('verbose', {
                describe: 'Enable verbose logging',
                type: 'boolean',
            })
            .env('STORYBOOK_DEPLOYER')
            .help()
            .alias('help', 'h')
            .version()
            .alias('version', 'v')
            .parse();

        // Load and merge configuration from CLI args, config file, and defaults
        config = loadConfig(cliArgs);

        // Validate required fields after merging all sources
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

    } catch (error) {
        handleError(error, config);
    }
}

main();
