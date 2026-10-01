/**
 * `scry import <folder>`: import a folder exported from Adobe Bridge.
 *
 * Reads only the folder it is given (no scanning, no sync), converts PSD/TIFF/HEIC/PDF/AI to
 * PNG/JPEG on this machine, keeps an allow-list of XMP fields (title, description, keywords,
 * rating, label) and nothing else, writes an SCF bundle, shows what will be sent and asks for
 * consent, then hands the bundle to the existing `scry upload` path.
 *
 * Text that comes from files (names, XMP values) is printed with `print` (plain console output)
 * and never through the logger, whose lines also become Sentry breadcrumbs. Counts are logged.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { runUploadBundle } = require('./uploadCommand.js');
const { createLogger } = require('./logger.js');
const { scanFolder, ImportInputError } = require('./importScan.js');
const { buildBundle } = require('./importBundle.js');
const { detectTools } = require('./importConvert.js');

const MAX_LISTED = 20;

function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The pre-upload summary: counts, what is skipped and why, and who the images go to (decision D3). */
function summarize({ scan, stats, project, dryRun }) {
    const lines = [];
    const skippedCount = stats.skipped.length;
    lines.push(`Adobe Bridge import: ${plural(stats.captured, 'image')} ready (${stats.asIs} used as they are, ${stats.converted} converted), ${skippedCount} skipped.`);
    if (scan.ignored > 0) lines.push(`${plural(scan.ignored, 'other file')} in the folder ignored (not an image).`);
    lines.push(`Bridge metadata (title, description, keywords, rating, label) found for ${plural(stats.withMetadata, 'image')}. Location, camera and file-path data is never read or sent.`);
    for (const s of stats.skipped.slice(0, MAX_LISTED)) lines.push(`  skipped ${s.rel}: ${s.detail}`);
    if (skippedCount > MAX_LISTED) lines.push(`  ... and ${skippedCount - MAX_LISTED} more skipped.`);
    if (stats.sidecarsRefused > 0) lines.push(`${plural(stats.sidecarsRefused, 'sidecar .xmp file')} not read (a link, or outside the folder).`);
    if (!dryRun) {
        lines.push(`These ${plural(stats.captured, 'image')} will be uploaded to project ${project} and sent to Google Gemini and Jina for AI captioning and embeddings.`);
    }
    return lines;
}

/** Ask on the terminal; anything but y/yes is a no. */
function askYesNo(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
            rl.close();
            resolve(/^y(es)?$/i.test(answer.trim()));
        });
    });
}

/** Consent: `--yes`, or an interactive yes. A non-interactive run without `--yes` sends nothing. */
async function confirmSend(argv, stats, deps, logger) {
    if (argv.yes) return true;
    if (!deps.isInteractive()) {
        logger.error('❌ Nothing was uploaded: this shell is not interactive. Re-run with --yes to confirm that these images may be sent for AI processing.');
        return false;
    }
    return deps.confirm(`Send ${plural(stats.captured, 'image')} for AI processing? [y/N] `);
}

function validateInput(argv, logger) {
    if (!argv.folder) {
        logger.error('❌ Pass the folder you exported from Adobe Bridge: scry import <folder> --project <id>.');
        return false;
    }
    if (!argv.dryRun && !argv.project) {
        logger.error('❌ --project is required to upload (or use --dry-run to build the bundle without sending it).');
        return false;
    }
    return true;
}

/**
 * @param {object} argv {folder, project, version, apiUrl, apiKey, yes?, dryRun?, verbose?}
 * @param {{logger?:object, print?:Function, deps?:object}} [ctx]
 * @returns {Promise<{exitCode:number, upload?:object, stats?:object}>}
 */
async function runImport(argv, ctx = {}) {
    const logger = ctx.logger || createLogger(argv);
    const print = ctx.print || ((line) => console.log(line));
    const deps = {
        upload: runUploadBundle,
        confirm: askYesNo,
        isInteractive: () => Boolean(process.stdin.isTTY),
        tools: detectTools(),
        ...(ctx.deps || {}),
    };
    if (!validateInput(argv, logger)) return { exitCode: 1 };

    let scan;
    try {
        scan = scanFolder(argv.folder);
    } catch (error) {
        if (!(error instanceof ImportInputError)) throw error;
        logger.error(`❌ ${error.message}`);
        return { exitCode: 1 };
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scry-import-'));
    let keep = false;
    try {
        const bundleDir = path.join(workDir, 'bundle');
        logger.info(`Reading ${plural(scan.files.length, 'candidate file')} ...`);
        const { stats } = await buildBundle(scan, bundleDir, { convert: deps.convert, tools: deps.tools });
        for (const line of summarize({ scan, stats, project: argv.project, dryRun: argv.dryRun })) print(line);

        if (stats.captured === 0) {
            logger.error('❌ No supported images found, so nothing was uploaded. Supported: PNG, JPEG, WebP, and PSD, TIFF, HEIC, PDF, AI when a converter is installed.');
            return { exitCode: 1, stats };
        }
        if (argv.dryRun) {
            keep = true;
            logger.info(`Dry run: bundle written to ${bundleDir}. Nothing was sent.`);
            const outcome = await deps.upload({ ...argv, path: bundleDir, dryRun: true }, { logger });
            return { exitCode: outcome.exitCode, stats };
        }
        if (!(await confirmSend(argv, stats, deps, logger))) return { exitCode: 1, stats };

        const outcome = await deps.upload({ ...argv, path: bundleDir, includeSource: false, dryRun: false }, { logger });
        return { exitCode: outcome.exitCode, upload: outcome.upload, stats };
    } finally {
        if (!keep) fs.rmSync(workDir, { recursive: true, force: true });
    }
}

module.exports = { runImport };
