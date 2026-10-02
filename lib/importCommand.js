/**
 * `scry import <folder>`: import a folder exported from Adobe Bridge.
 *
 * Reads only the folder it is given (no scanning, no sync), converts PSD/TIFF/HEIC/PDF/AI to
 * PNG/JPEG on this machine, keeps an allow-list of XMP fields (title, description, keywords,
 * rating, label) and nothing else, writes an SCF bundle, shows what will be sent and asks for
 * consent, then hands the bundle to the existing `scry upload` path.
 *
 * Text that comes from files (names, XMP values) is printed with `print` (straight to stdout, which
 * Sentry's console integration does not record) and never through the logger, whose lines also become
 * Sentry breadcrumbs. Counts are logged. Anything that is thrown is stripped of folder paths first.
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
const { resolveBuildGitContext } = require('./gitContext.js');

const MAX_LISTED = 20;

function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// C0/C1 controls (including ESC), DEL, line/paragraph separators, bidi overrides and isolates.
function isControlOrBidi(code) {
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
        || code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

/** A file name that is safe to print on a terminal: no escape sequences, no control or bidi characters. */
function printable(name) {
    let out = '';
    for (const ch of String(name)) out += isControlOrBidi(ch.codePointAt(0)) ? '?' : ch;
    return out;
}

/** The one-line description of the git context that the upload attaches, or null when there is none. */
function describeGit(git) {
    if (!git || (!git.commitSha && !git.branch)) return null;
    const parts = [];
    if (git.commitSha) parts.push(`commit ${printable(git.commitSha).slice(0, 12)}`);
    if (git.branch) parts.push(`branch ${printable(git.branch)}`);
    return parts.join(' on ');
}

function currentGitContext(deps) {
    try {
        return (deps.gitContext || resolveBuildGitContext)();
    } catch {
        return null;
    }
}

/** The pre-upload summary: counts, what is skipped and why, and who the images go to (decision D3). */
function summarize({ scan, stats, project, version, git, dryRun }) {
    const lines = [];
    const skippedCount = stats.skipped.length;
    lines.push(`Adobe Bridge import: ${plural(stats.captured, 'image')} ready (${stats.asIs} used as they are, ${stats.converted} converted), ${skippedCount} skipped.`);
    if (scan.ignored > 0) lines.push(`${plural(scan.ignored, 'other file')} in the folder ignored (not an image).`);
    lines.push(`Bridge metadata (title, description, keywords, rating, label) found for ${plural(stats.withMetadata, 'image')}. Location, camera and device data and embedded EXIF/XMP/IPTC are never read or sent, and file names and folder paths are not uploaded (text you wrote in the title, description or keywords is sent as written).`);
    for (const s of stats.skipped.slice(0, MAX_LISTED)) lines.push(`  skipped ${printable(s.rel)}: ${s.detail}`);
    if (skippedCount > MAX_LISTED) lines.push(`  ... and ${skippedCount - MAX_LISTED} more skipped.`);
    if (stats.sidecarsRefused > 0) lines.push(`${plural(stats.sidecarsRefused, 'sidecar .xmp file')} not read (a link, or outside the folder).`);
    if (!dryRun) {
        const versionNote = version ? ` (version ${printable(version)})` : '';
        lines.push(`These ${plural(stats.captured, 'image')} will be uploaded to project ${project}${versionNote} and sent to OpenAI, Google Gemini and Jina for AI captioning and embeddings.`);
        lines.push('OpenAI writes a short description of each picture and sees only the picture. Google Gemini and Jina turn each picture, and its title, description and keywords, into search data. Rating and label stay in Scry.');
        lines.push('What is sent: the image files (metadata removed), each image\'s size, and the title, description, keywords, rating and label found for it.');
        const gitLine = describeGit(git);
        if (gitLine) lines.push(`Also sent with the upload: the git ${gitLine} of the repository in the current directory.`);
    }
    return lines;
}

/** Ask on the terminal; anything but y/yes is a no, and so is Ctrl-D / Ctrl-C / a closed input (no answer). */
function askYesNo(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        let settled = false;
        const settle = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        rl.on('close', () => settle(false));
        rl.question(question, (answer) => {
            settle(/^y(es)?$/i.test(answer.trim()));
            rl.close();
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
    const yes = await deps.confirm(`Send ${plural(stats.captured, 'image')} for AI processing? [y/N] `);
    if (!yes) logger.error('Nothing was uploaded: the send was not confirmed.');
    return yes;
}

/**
 * The thrown error with every folder, file path and file name this run knows replaced, so nothing
 * path-shaped reaches Sentry. `replacements` is [[text, placeholder]] (longest text first).
 */
function withoutPaths(error, replacements) {
    const err = error instanceof Error ? error : new Error(String(error));
    const ordered = replacements.filter(([text]) => text).sort((a, b) => b[0].length - a[0].length);
    const wipe = (text) => ordered.reduce((acc, [from, to]) => acc.split(from).join(to), String(text ?? ''));
    err.message = wipe(err.message);
    if (typeof err.stack === 'string') err.stack = wipe(err.stack);
    return err;
}

function pathReplacements(argv, scan, workDir) {
    const names = scan ? [...scan.files.map((f) => [f.rel, '<file>']), ...scan.files.map((f) => [f.abs, '<file>'])] : [];
    return [[scan?.root, '<folder>'], [path.resolve(argv.folder), '<folder>'], [workDir, '<folder>'], [os.tmpdir(), '<folder>'], [os.homedir(), '<home>'], ...names];
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
    const print = ctx.print || ((line) => process.stdout.write(`${line}\n`));
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
        if (!(error instanceof ImportInputError)) throw withoutPaths(error, pathReplacements(argv, null, null));
        logger.error(`❌ ${error.message}`);
        return { exitCode: 1 };
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scry-import-'));
    let keep = false;
    try {
        const bundleDir = path.join(workDir, 'bundle');
        logger.info(`Reading ${plural(scan.files.length, 'candidate file')} ...`);
        const { stats } = await buildBundle(scan, bundleDir, { convert: deps.convert, tools: deps.tools });
        for (const line of summarize({ scan, stats, project: argv.project, version: argv.version, git: argv.dryRun ? null : currentGitContext(deps), dryRun: argv.dryRun })) print(line);

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
    } catch (error) {
        throw withoutPaths(error, pathReplacements(argv, scan, workDir));
    } finally {
        if (!keep) fs.rmSync(workDir, { recursive: true, force: true });
    }
}

module.exports = { runImport };
