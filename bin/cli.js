#!/usr/bin/env node

const { initTelemetry, captureCliError, flushTelemetry } = require('../lib/telemetry.js');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { zipDirectory } = require('../lib/archive.js');
const { createMasterZip } = require('../lib/archiveUtils.js');
const { getApiClient, uploadBuild } = require('../lib/apiClient.js');
const { createLogger } = require('../lib/logger.js');
const { AppError, ApiError } = require('../lib/errors.js');
const { loadConfig } = require('../lib/config.js');
const { captureScreenshots } = require('../lib/screencap.js');
const { analyzeStorybook } = require('../lib/analysis.js');
const { runCoverageAnalysis, loadCoverageReport, extractCoverageSummary } = require('../lib/coverage.js');
const { postPRComment } = require('../lib/pr-comment.js');
const { runInit } = require('../lib/init.js');
const { runUpdateWorkflows } = require('../lib/update-workflows.js');
const { runQueueImageUpload } = require('../lib/imageUpload.js');
const { runLocalImageProcessing } = require('../lib/localImageProcessing.js');
const { resolveBuildGitContext } = require('../lib/gitContext.js');
const { countMetadataEntries } = require('../lib/metadataArchive.js');
const { checkForNewerVersion } = require('../lib/versionCheck.js');
const { version: DEPLOYER_VERSION } = require('../package.json');

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

/**
 * Decide whether this deploy runs analysis (screenshots + metadata for search).
 *
 * On by default since 0.7.0: an unset flag used to mean "off", and a workflow
 * that forgot --with-analysis uploaded, printed success and indexed nothing
 * (ISSUES.md #50). Opting out is explicit, and the caller says so in the log.
 *
 * @param {any} argv
 * @returns {{enabled:boolean, optOut:string|null}}
 */
function resolveAnalysis(argv) {
    if (argv.analysis === false) {
        return { enabled: false, optOut: '--no-analysis' };
    }
    if (argv.withAnalysis === false) {
        return { enabled: false, optOut: 'withAnalysis is false in .storybook-deployer.json or SCRY_WITH_ANALYSIS' };
    }
    if (argv.withAnalysis === true || argv.analysis === true) {
        return { enabled: true, optOut: null };
    }
    // Analysis runs inside the coverage tool, so --no-coverage without an
    // explicit analysis flag is an opt-out of both. With --with-analysis it is
    // not, and ends red below (analysis asked for, nothing produced).
    if (argv.coverage === false) {
        return { enabled: false, optOut: '--no-coverage (analysis runs inside coverage)' };
    }
    return { enabled: true, optOut: null };
}

/**
 * Stories the coverage report says exist, and the first capture error, for
 * the "captured 0 of N" line. Both optional: the report shape is sbcov's.
 */
function describeCapture(report) {
    const total = report?.summary?.totalStories ?? report?.execution?.summary?.total ?? null;
    const f = report?.execution?.failures?.[0];
    const firstError = f ? `${f.storyId || f.storyName || 'a story'}: ${String(f.message || f.failureType || '').split('\n')[0]}` : null;
    return { total: typeof total === 'number' ? total : null, firstError };
}

async function runDeployment(argv) {
    const logger = createLogger(argv);
    logger.info('🚀 Starting deployment...');
    logger.debug(`Received arguments: ${JSON.stringify(argv)}`);

    const analysis = resolveAnalysis(argv);
    argv = { ...argv, withAnalysis: analysis.enabled };

    const outPath = path.join(os.tmpdir(), `storybook-deployment-${Date.now()}.zip`);
    let metadataZipPath = null;

    try {
        const coverage = await resolveCoverage(argv, logger);
        const coverageReport = coverage.coverageReport;
        const coverageSummary = coverage.coverageSummary;
        const sbcovFailure = coverage.sbcovFailure || null;
        metadataZipPath = coverage.metadataZipPath;

        if (argv.withAnalysis) {
            logger.info('Running deployment with analysis...');
        }

        // Count what the archive holds before sending it. An archive whose
        // metadata.json is [] is what sbcov writes when every story failed
        // after the browser launched; queuing it produced a build marked
        // `completed` with nothing in it, and a green run (ISSUES.md #50).
        // Hosting still goes ahead (the preview link stays useful); the
        // archive is not sent and the run ends red below.
        let metadataToSend = metadataZipPath;
        let emptyArchive = null;
        if (metadataZipPath) {
            const counted = countMetadataEntries(metadataZipPath);
            if (counted.count === 0) {
                emptyArchive = { ...describeCapture(coverageReport), note: counted.error };
                metadataToSend = null;
            } else if (counted.count === null) {
                // Could not read it. Send it anyway (the service decides) but
                // say so: this is not a count of zero.
                logger.warn(`⚠️  Could not count the stories in the analysis archive (${counted.error}); uploading it anyway.`);
            } else {
                logger.info(`Analysis archive holds ${counted.count} captured ${counted.count === 1 ? 'story' : 'stories'}.`);
            }
        }

        // 1. Archive only the static Storybook files.
        logger.info(`1/3: Zipping directory '${argv.dir}'...`);
        await zipDirectory(argv.dir, outPath);
        logger.success(`✅ Archive created: ${outPath}`);
        logger.debug(`Archive size: ${fs.statSync(outPath).size} bytes`);

        // 2. Upload Storybook ZIP + coverage + metadata ZIP (if present).
        logger.info('2/3: Uploading to deployment service...');
        const apiClient = getApiClient(argv.apiUrl, argv.apiKey);
        // Which commit this build is of. `version` is a PR number, a branch, a
        // tag or a short SHA depending on the CI event, so it identifies a
        // deploy but never a commit — without this a search result cannot say
        // which code it reflects (P13a).
        const gitContext = resolveBuildGitContext();
        if (gitContext.commitSha) {
            logger.debug(`Build provenance: ${gitContext.commitSha}${gitContext.branch ? ` on ${gitContext.branch}` : ''}`);
        } else {
            logger.debug('No git context available; build will record no commit SHA');
        }
        const uploadResult = await uploadBuild(
            apiClient,
            {
                project: argv.project,
                version: argv.version,
            },
            {
                zipPath: outPath,
                coverageReport,
                metadataZipPath: metadataToSend,
                gitContext,
            }
        );
        logger.success('✅ Archive uploaded.');
        logger.debug(`Upload result: ${JSON.stringify(uploadResult)}`);

        await postPRComment(buildDeployResult(argv, coverageSummary, uploadResult), coverageSummary);

        // Report only what actually completed. Uploading is synchronous;
        // indexing is not. A build can fail in the queue seconds after this
        // point — during one run the pipeline died 7s later on a revoked
        // credential — and this command previously printed
        // "Deployment successful" over it, sending people looking for the
        // cause three steps downstream (ISSUES.md #4).
        logger.success('\n✅ Upload complete.');
        logUploadLinks(argv, coverageSummary, uploadResult, logger);

        reportIndexingOutcome({ argv, analysis, uploadResult, emptyArchive, sbcovFailure, logger });

    } finally {
        // 4. Clean up the local archive
        if (fs.existsSync(outPath)) {
            fs.unlinkSync(outPath);
            logger.info(`🧹 Cleaned up temporary file: ${outPath}`);
        }
        if (metadataZipPath && fs.existsSync(metadataZipPath)) {
            fs.unlinkSync(metadataZipPath);
            logger.info(`🧹 Cleaned up temporary file: ${metadataZipPath}`);
        }
    }
}

const HOSTED_NOT_SEARCHABLE =
    '   The Storybook is hosted and browsable, but no component will be\n' +
    '   searchable from this build.';

/**
 * Say what happened to indexing, and set the exit code from it.
 *
 * The rule (ISSUES.md #24, #50): a deploy that was asked to index and will
 * index nothing ends with exit code 1. The Storybook is hosted either way.
 */
function reportIndexingOutcome({ argv, analysis, uploadResult, emptyArchive, sbcovFailure, logger }) {
    const metadataUpload = uploadResult?.metadataUpload || null;

    if (!argv.withAnalysis) {
        logger.info(`\nℹ️  Analysis skipped (${analysis.optOut || 'not requested'}): this build is hosted but NOT searchable.`);
        if (sbcovFailure) {
            // Coverage is optional here; the report is what failed.
            logger.warn(`⚠️  Coverage report not produced: ${sbcovFailure.reason}.`);
        }
        return;
    }

    if (emptyArchive) {
        // Checked first: the archive was not sent, so whatever the upload
        // result says about metadata is not about this build's stories.
        process.exitCode = 1;
        const of = emptyArchive.total !== null ? ` of ${emptyArchive.total}` : '';
        logger.error(
            `\n❌ Analysis captured 0${of} stories, so NOTHING WILL BE INDEXED.\n` +
            (emptyArchive.firstError ? `   First capture error: ${emptyArchive.firstError}\n` : '') +
            (sbcovFailure ? `   ${sbcovFailure.reason}.\n` : '') +
            '   The empty archive was not uploaded and no build was queued.\n' +
            HOSTED_NOT_SEARCHABLE
        );
        return;
    }

    if (metadataUpload && metadataUpload.success === false) {
        // apiClient turns a rejected upload into {success:false}; the old
        // check tested only that the object existed, printed "uploaded but
        // not queued" and exited 0.
        process.exitCode = 1;
        logger.error(
            `\n❌ The metadata upload failed (${metadataUpload.error || 'no reason given'}), so NOTHING WILL BE INDEXED.\n` +
            HOSTED_NOT_SEARCHABLE
        );
        return;
    }

    if (metadataUpload?.queued) {
        logger.info(
            '\n⏳ Indexing has been queued, not finished.\n' +
            '   This command cannot confirm it succeeded. Components will not be\n' +
            '   searchable until processing completes, and a failed build reports\n' +
            '   nothing here. Before relying on search, confirm the build shows\n' +
            "   processingStatus 'completed' rather than 'failed'."
        );
        if (sbcovFailure) {
            // The contract with scry-sbcov (#51): exit 3 = stories were dropped
            // above --max-dropped, and the archive of the ones that captured
            // was written. Those are queued above; the run still ends red.
            process.exitCode = 1;
            logger.error(
                `\n❌ ${sbcovFailure.reason}. The stories that were captured are queued for\n` +
                '   indexing, but this build is incomplete: some components will be\n' +
                '   missing from search. See the scry-sbcov output above.'
            );
        }
        return;
    }

    if (metadataUpload) {
        process.exitCode = 1;
        logger.error(
            '\n❌ Metadata was uploaded but not queued for processing, so NOTHING WILL BE INDEXED.\n' +
            HOSTED_NOT_SEARCHABLE
        );
        return;
    }

    process.exitCode = 1;

    // The gap between the branches above, and the most damaging state:
    // analysis was asked for, produced nothing, and this command used to say
    // "Upload successful" and stop (ISSUES.md #24).
    logger.error(
        '\n❌ Analysis produced no metadata, so NOTHING WILL BE INDEXED.\n' +
        HOSTED_NOT_SEARCHABLE + '\n\n' +
        (sbcovFailure
            ? `   Cause: ${sbcovFailure.reason}. See the scry-sbcov output above.\n\n`
            : '   The cause is in the coverage output above — commonly a missing Playwright\n' +
              "   browser (install it with the deployer's own Playwright; see the README's\n" +
              '   CI setup) or a TypeScript resolution error in the analyzer.\n\n') +
        '   Exiting non-zero deliberately: a green build here would mean search\n' +
        '   silently returns nothing. Pass --no-analysis to host without indexing.'
    );
}

async function handleError(error, argv) {
    const logger = createLogger(argv || {});
    logger.error(`\n❌ Error: ${error.message}`);

    // Report with an allowlisted subset of argv. Sending argv wholesale shipped
    // the customer's --api-key to Sentry on every error.
    captureCliError(error, argv);

    // Ensure the event is sent before the process exits
    await flushTelemetry(2000);

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
    // Error reporting. Opt out with SCRY_TELEMETRY=0 or DO_NOT_TRACK=1.
    // Configuration and scrubbing live in lib/telemetry.js.
    initTelemetry();

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
                    .option('deploy-version', {
                        alias: ['v', 'version'],
                        describe: 'Version identifier for the deployment',
                        type: 'string',
                    })
                    // Coverage options (enabled by default)
                    .option('coverage', {
                        describe: 'Run coverage analysis and upload report',
                        type: 'boolean',
                        default: true,
                    })
                    .option('coverage-report', {
                        describe: 'Path to coverage report JSON file (skip analysis and upload this report)',
                        type: 'string',
                    })
                    .option('coverage-fail-on-threshold', {
                        describe: 'Fail if coverage thresholds are not met',
                        type: 'boolean',
                        default: false,
                    })
                    .option('coverage-base', {
                        describe: 'Base branch for new code analysis',
                        type: 'string',
                        default: 'main',
                    })
                    .option('coverage-execute', {
                        describe: 'Execute stories during coverage analysis',
                        type: 'boolean',
                        default: false,
                    })
                    .option('capture-mode', {
                        describe: 'Screenshot framing forwarded to scry-sbcov: root or viewport (unset: sbcov default)',
                        type: 'string',
                        choices: ['root', 'viewport'],
                    })
                    .option('capture-scale', {
                        describe: 'Screenshot device scale factor forwarded to scry-sbcov, 0 < n <= 4 (unset: sbcov default)',
                        type: 'string',
                    })
                    .option('capture-viewport', {
                        describe: 'Browser viewport WIDTHxHEIGHT forwarded to scry-sbcov (unset: sbcov default)',
                        type: 'string',
                    })
                    .option('with-analysis', {
                        describe: 'Capture screenshots and metadata so components are searchable (the default since 0.7.0)',
                        type: 'boolean',
                    })
                    .option('analysis', {
                        describe: 'Pass --no-analysis to host the Storybook without indexing it (nothing will be searchable)',
                        type: 'boolean',
                    })
                    .option('max-dropped', {
                        describe: 'Forwarded to scry-sbcov: end red when more than this many stories fail to capture (unset: sbcov default)',
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
                const config = loadConfig(argv);

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

                // Advisory, bounded to 2 s, never fails the deploy.
                await checkForNewerVersion({ currentVersion: DEPLOYER_VERSION, logger: createLogger(config) });

                await runDeployment(config);
            })
            .command('analyze', 'Analyze Storybook stories and generate metadata', (yargs) => {
                return yargs
                    .option('project', {
                        describe: 'Project name/identifier',
                        type: 'string',
                        demandOption: true,
                    })
                    .option('deploy-version', {
                        alias: 'v',
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
                const config = loadConfig(argv);

                await runAnalysis(config);
            })
            
            .command('coverage', 'Run only Storybook coverage analysis and write the report to disk', (yargs) => {
                return yargs
                    .option('dir', {
                        describe: 'Path to the built Storybook directory (e.g., storybook-static)',
                        type: 'string',
                        demandOption: true,
                    })
                    .option('coverage-base', {
                        describe: 'Base ref/branch for new code analysis (supports SHAs, origin/main, HEAD~1)',
                        type: 'string',
                        default: 'main',
                        alias: 'coverageBase'
                    })
                    .option('coverage-fail-on-threshold', {
                        describe: 'Fail (exit 1) if coverage thresholds are not met',
                        type: 'boolean',
                        default: false,
                        alias: 'coverageFailOnThreshold'
                    })
                    .option('coverage-execute', {
                        describe: 'Execute stories during coverage analysis (requires playwright in the project)',
                        type: 'boolean',
                        default: false,
                        alias: 'coverageExecute'
                    })
                    .option('capture-mode', {
                        describe: 'Screenshot framing forwarded to scry-sbcov: root or viewport (unset: sbcov default)',
                        type: 'string',
                        choices: ['root', 'viewport'],
                    })
                    .option('capture-scale', {
                        describe: 'Screenshot device scale factor forwarded to scry-sbcov, 0 < n <= 4 (unset: sbcov default)',
                        type: 'string',
                    })
                    .option('capture-viewport', {
                        describe: 'Browser viewport WIDTHxHEIGHT forwarded to scry-sbcov (unset: sbcov default)',
                        type: 'string',
                    })
                    .option('max-dropped', {
                        describe: 'Forwarded to scry-sbcov: fail when more than this many stories fail to capture',
                        type: 'string',
                    })
                    .option('output', {
                        describe: 'Where to write the JSON coverage report',
                        type: 'string',
                        default: './scry-sbcov-report.json'
                    })
                    .option('verbose', {
                        describe: 'Enable verbose logging',
                        type: 'boolean',
                        default: false,
                    });
            }, async (argv) => {
                const logger = createLogger(argv);

                // Capture settings: CLI flag > env > .storybook-deployer.json; unset = sbcov decides.
                const { captureMode, captureScale, captureViewport } = loadConfig(argv);
                const result = await runCoverageAnalysis({
                    storybookDir: argv.dir,
                    baseBranch: argv.coverageBase || 'main',
                    failOnThreshold: Boolean(argv.coverageFailOnThreshold),
                    execute: Boolean(argv.coverageExecute),
                    outputPath: argv.output,
                    keepReport: true,
                    captureMode,
                    captureScale,
                    captureViewport,
                    maxDropped: argv.maxDropped,
                });
                const report = result.report;

                if (result.sbcovFailure) {
                    logger.error(`Coverage: ${result.sbcovFailure.reason}${report ? ` (report written to ${argv.output})` : ''}`);
                    process.exit(1);
                }
                if (!report) {
                    logger.error('Coverage: no report generated (tool failed or returned null)');
                    process.exit(1);
                }

                logger.success(`✅ Coverage report written to ${argv.output}`);
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
                        describe: 'Write the API key into the committed config file (not recommended)',
                        type: 'boolean',
                        // False by default. The description has always said "not
                        // recommended" while the default said otherwise, and the
                        // default won: every `init` wrote a customer's key into a
                        // file it then committed.
                        default: false,
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
            .command('update-workflows', 'Regenerate the Scry GitHub Actions workflows in .github/workflows from this version\'s templates (no API key needed)', (yargs) => {
                return yargs
                    .option('commit', {
                        describe: 'git add and commit the regenerated workflow files',
                        type: 'boolean',
                        default: false,
                    })
                    .option('commit-message', {
                        describe: 'Commit message used with --commit',
                        type: 'string',
                        default: 'chore: update Scry workflows',
                        alias: 'commitMessage',
                    })
                    .option('verbose', {
                        describe: 'Enable verbose logging',
                        type: 'boolean',
                        default: false,
                    });
            }, async (argv) => {
                await runUpdateWorkflows(argv);
            })
            .command('upload-images', 'Upload a folder of images for search indexing', (yargs) => {
                return yargs
                    .option('dir', {
                        describe: 'Path to the image directory',
                        type: 'string',
                        demandOption: true,
                    })
                    .option('project', {
                        describe: 'Project name/identifier',
                        type: 'string',
                        demandOption: true,
                    })
                    .option('local', {
                        describe: 'Process images locally instead of uploading to the queue',
                        type: 'boolean',
                        default: false,
                    })
                    .option('openai-api-key', {
                        describe: 'OpenAI API key (for --local mode)',
                        type: 'string',
                    })
                    .option('jina-api-key', {
                        describe: 'Jina API key (for --local mode)',
                        type: 'string',
                    })
                    .option('milvus-address', {
                        describe: 'Milvus/Zilliz endpoint (for --local mode)',
                        type: 'string',
                    })
                    .option('milvus-token', {
                        describe: 'Milvus/Zilliz auth token (for --local mode)',
                        type: 'string',
                    })
                    .option('milvus-collection', {
                        describe: 'Milvus collection name (for --local mode)',
                        type: 'string',
                    })
                    .option('api-key', {
                        describe: 'API key for the deployment service (queue mode)',
                        type: 'string',
                    })
                    .option('api-url', {
                        describe: 'Base URL for the deployment service API (queue mode)',
                        type: 'string',
                    })
                    .option('verbose', {
                        describe: 'Enable verbose logging',
                        type: 'boolean',
                    });
            }, async (argv) => {
                const config = loadConfig(argv);

                if (!config.dir) {
                    throw new Error('--dir is required. Provide a path to the image directory.');
                }

                if (!fs.existsSync(config.dir)) {
                    throw new Error(`Directory not found: ${config.dir}`);
                }
                if (!fs.lstatSync(config.dir).isDirectory()) {
                    throw new Error(`Path is not a directory: ${config.dir}`);
                }

                if (config.local) {
                    // Local mode: process images directly via LLM + embeddings + Milvus
                    const requiredLocalKeys = {
                        openaiApiKey: { flag: '--openai-api-key', env: 'OPENAI_API_KEY' },
                        jinaApiKey: { flag: '--jina-api-key', env: 'JINA_API_KEY' },
                        milvusAddress: { flag: '--milvus-address', env: 'MILVUS_ADDRESS' },
                        milvusToken: { flag: '--milvus-token', env: 'MILVUS_TOKEN' },
                        milvusCollection: { flag: '--milvus-collection', env: 'MILVUS_COLLECTION' },
                    };

                    const resolved = {};
                    for (const [key, { flag, env }] of Object.entries(requiredLocalKeys)) {
                        resolved[key] = config[key] || process.env[env];
                        if (!resolved[key]) {
                            throw new Error(`${flag} or ${env} env var is required for local mode`);
                        }
                    }

                    await runLocalImageProcessing({
                        dir: config.dir,
                        project: config.project,
                        ...resolved,
                        verbose: config.verbose,
                    });
                } else {
                    await runQueueImageUpload(config);
                }
            })
            .command('debug-sentry', 'Test Sentry integration by throwing an error', () => {}, () => {
                throw new Error('Sentry debug error from scry-node CLI');
            })
            .env('STORYBOOK_DEPLOYER')
            .help()
            .alias('help', 'h')
            .version(false)  // Disable built-in version since we use -v for deploy-version
            .parse();

    } catch (error) {
        await handleError(error, error.config || {});
    }
}

/**
 * Resolve coverage settings into a report and a summary.
 *
 * @param {any} argv
 * @param {{info:Function,debug:Function,success:Function,error:Function}} logger
 */
async function resolveCoverage(argv, logger) {
    const enabled = argv.coverage !== false;
    if (!enabled) {
        logger.info('Coverage: disabled (--no-coverage)');
        return { coverageReport: null, coverageSummary: null, metadataZipPath: null, sbcovFailure: null };
    }

    try {
        let report = null;
        let metadataZipPath = null;
        let sbcovFailure = null;

        if (argv.coverageReport) {
            logger.info(`Coverage: using existing report at ${argv.coverageReport}`);
            report = loadCoverageReport(argv.coverageReport);
        } else {
            const needsScreenshots = Boolean(argv.withAnalysis);
            const outputZipPath = needsScreenshots
                ? path.join(os.tmpdir(), `scry-metadata-${Date.now()}.zip`)
                : null;

            const result = await runCoverageAnalysis({
                storybookDir: argv.dir,
                baseBranch: argv.coverageBase || 'main',
                failOnThreshold: Boolean(argv.coverageFailOnThreshold),
                execute: Boolean(argv.coverageExecute) || needsScreenshots,
                screenshots: needsScreenshots,
                outputZipPath,
                captureMode: argv.captureMode,
                captureScale: argv.captureScale,
                captureViewport: argv.captureViewport,
                maxDropped: argv.maxDropped,
            });
            report = result.report;
            metadataZipPath = result.metadataZipPath;
            sbcovFailure = result.sbcovFailure || null;
        }

        const summary = extractCoverageSummary(report);
        if (summary) {
            logger.success('✅ Coverage report ready');
            logger.debug(`Coverage summary: ${JSON.stringify(summary.summary)}`);
        } else {
            logger.info('Coverage: no report generated (tool failed or report shape unexpected)');
        }

        return { coverageReport: report, coverageSummary: summary, metadataZipPath, sbcovFailure };
    } catch (err) {
        logger.error(`Coverage: failed (${err.message})`);
        throw err;
    }
}

/**
 * Construct public URLs for view and coverage assets.
 *
 * @param {any} argv
 * @param {any|null} coverageSummary
 */
function buildDeployResult(argv, coverageSummary, uploadResult) {
    const project = argv.project || 'main';
    const version = argv.version || 'latest';
    const viewBaseUrl = process.env.SCRY_VIEW_URL || 'https://view.scrymore.com';

    const viewUrl = `${viewBaseUrl.replace(/\/$/, '')}/${project}/${version}/`;

    const coverageUrl = coverageSummary
        ? `${viewBaseUrl.replace(/\/$/, '')}/${project}/${version}/coverage-report.json`
        : null;

    return {
        project,
        version,
        viewUrl,
        coverageUrl,
        coveragePageUrl: coverageUrl,
        visibility: uploadResult?.zipUpload?.visibility,
    };
}

function logUploadLinks(argv, coverageSummary, uploadResult, logger) {
    const deployResult = buildDeployResult(argv, coverageSummary, uploadResult);

    logger.success('\n✅ Storybook hosted.\n');
    logger.info(`📖 Storybook: ${deployResult.viewUrl}`);
    if (deployResult.coverageUrl) {
        logger.info(`📊 Coverage:  ${deployResult.coverageUrl}`);
    }

    if (deployResult.visibility === 'private') {
        logger.info('\n🔒 This project is private. Viewers must be logged in to access.');
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    main,
    runDeployment,
    runAnalysis,
    resolveCoverage,
    resolveAnalysis,
    reportIndexingOutcome,
    buildDeployResult,
    logUploadLinks,
};
