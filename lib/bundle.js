/**
 * `scry upload <dir|zip>`: stage an SCF bundle, apply the source-text opt-in, validate it with
 * the vendored validator, zip it and send it through the upload service's bundle route.
 *
 * Source text (guarantee G6): Scry never needs the customer's code. Without --include-source,
 * nothing under source/ and no capture.sourceText is ever packed — even when the input bundle
 * carries them. With it, each capture's code.componentFile is read from the repository root,
 * copied under source/, and the CLI says so.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
    validateBundle,
    printValidation,
    sourceKeyOf,
    zipBundleDir,
    listFiles,
} = require('./scf.js');

const SOURCE_TEXT_MAX_BYTES = 1024 * 1024;
const UNZIP_HELPER = path.join(__dirname, 'scf-unzip.mjs');

class BundleRejectedError extends Error {
    constructor(message, result) {
        super(message);
        this.name = 'BundleRejectedError';
        this.result = result;
    }
}

/** Copy the input (dir or zip) into a fresh staging directory. */
function stageInput(input, stageDir) {
    const stat = fs.statSync(input);
    if (stat.isDirectory()) {
        for (const rel of listFiles(input)) {
            const dest = path.join(stageDir, ...rel.split('/'));
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(path.join(input, ...rel.split('/')), dest);
        }
        return;
    }
    if (!/\.zip$/i.test(input)) {
        throw new Error(`Not a bundle directory or .zip: ${input}`);
    }
    const result = spawnSync(process.execPath, [UNZIP_HELPER, input, stageDir], { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`Could not read ${input}: ${(result.stderr || result.stdout || '').trim()}`);
    }
}

function isWithin(child, root) {
    const rel = path.relative(root, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Plain UTF-8 text: no NUL byte and a lossless decode. */
function isUtf8Text(buf) {
    if (buf.includes(0)) return false;
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(buf);
        return true;
    } catch {
        return false;
    }
}

/**
 * Apply the --include-source decision to a staged SCF bundle, in place.
 *
 * @returns {{included:number, stripped:number, skipped:Array<{file:string, reason:string}>}}
 */
function applySourceOptIn(stageDir, manifest, { includeSource, repoRoot }) {
    const captures = Array.isArray(manifest.captures) ? manifest.captures : [];
    const sourceDir = path.join(stageDir, 'source');
    let stripped = 0;

    // Start from nothing either way: text left in the input bundle from another run is never
    // re-uploaded (the spec's re-packaging case), and the opt-in flag is set only by this run.
    for (const capture of captures) {
        if (capture && capture.sourceText) {
            stripped++;
            delete capture.sourceText;
        }
    }
    if (manifest.optIn) {
        delete manifest.optIn.sourceText;
        if (Object.keys(manifest.optIn).length === 0) delete manifest.optIn;
    }
    if (fs.existsSync(sourceDir)) fs.rmSync(sourceDir, { recursive: true, force: true });

    if (!includeSource) return { included: 0, stripped, skipped: [] };

    const root = path.resolve(repoRoot || process.cwd());
    const byFile = new Map(); // componentFile -> bundle path, or null when unusable
    const skipped = [];
    for (const capture of captures) {
        const file = capture && capture.code && capture.code.componentFile;
        if (typeof file !== 'string' || file === '') continue;
        if (!byFile.has(file)) {
            byFile.set(file, copySourceFile(file, root, stageDir, skipped));
        }
        const bundlePath = byFile.get(file);
        if (bundlePath) capture.sourceText = { file: bundlePath, path: file };
    }
    const included = [...byFile.values()].filter(Boolean).length;
    if (included > 0) manifest.optIn = { ...(manifest.optIn || {}), sourceText: true };
    return { included, stripped, skipped };
}

function copySourceFile(file, root, stageDir, skipped) {
    const abs = path.resolve(root, file);
    if (!isWithin(abs, root)) {
        skipped.push({ file, reason: 'outside the repository root' });
        return null;
    }
    let buf;
    try {
        const stat = fs.lstatSync(abs);
        if (!stat.isFile()) {
            skipped.push({ file, reason: 'not a regular file' });
            return null;
        }
        if (stat.size > SOURCE_TEXT_MAX_BYTES) {
            skipped.push({ file, reason: 'over 1 MB' });
            return null;
        }
        buf = fs.readFileSync(abs);
    } catch {
        skipped.push({ file, reason: 'not found' });
        return null;
    }
    if (!isUtf8Text(buf)) {
        skipped.push({ file, reason: 'not UTF-8 text' });
        return null;
    }
    const posix = path.relative(root, abs).split(path.sep).join('/');
    const bundlePath = `source/${posix}.src.txt`;
    const dest = path.join(stageDir, ...bundlePath.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return bundlePath;
}

/**
 * Stage, opt-in, validate and zip a bundle. Throws BundleRejectedError (after printing every
 * problem) when the validator rejects it.
 *
 * @param {string} input bundle dir or .zip
 * @param {{includeSource?:boolean, repoRoot?:string, source?:string, logger:object, workDir?:string}} opts
 * @returns {Promise<{zipPath:string, stageDir:string, sourceKey:string, manifest:object, legacy:boolean, validation:object, sourceText:{included:number, stripped:number}}>}
 */
async function prepareBundle(input, opts) {
    const { logger } = opts;
    const workDir = opts.workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'scry-bundle-'));
    const stageDir = path.join(workDir, 'bundle');
    fs.mkdirSync(stageDir, { recursive: true });
    stageInput(input, stageDir);

    const scfPath = path.join(stageDir, 'scf.json');
    const legacy = !fs.existsSync(scfPath) && fs.existsSync(path.join(stageDir, 'metadata.json'));
    let sourceText = { included: 0, stripped: 0 };
    let manifest = null;

    if (fs.existsSync(scfPath)) {
        try {
            manifest = JSON.parse(fs.readFileSync(scfPath, 'utf8'));
        } catch {
            manifest = null; // the validator reports SCF_JSON_INVALID below
        }
        if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
            const res = applySourceOptIn(stageDir, manifest, opts);
            sourceText = res;
            fs.writeFileSync(scfPath, JSON.stringify(manifest, null, 2) + '\n');
            for (const s of res.skipped) {
                logger.warn(`Source text not included for ${s.file}: ${s.reason}.`);
            }
            if (opts.includeSource) {
                logger.info(`Uploading source text for ${res.included} components (--include-source)`);
            } else if (res.stripped > 0) {
                logger.info(`Not uploading source text for ${res.stripped} captures that carried it (pass --include-source to include it).`);
            }
        }
    } else if (legacy) {
        // A legacy sbcov archive (metadata.json + sbcov-manifest.json) has no source text to add.
        const sourceDir = path.join(stageDir, 'source');
        if (fs.existsSync(sourceDir)) fs.rmSync(sourceDir, { recursive: true, force: true });
        if (opts.includeSource) {
            logger.warn('--include-source is ignored for a legacy sbcov archive (metadata.json); it carries no source text.');
        }
    }

    const validation = validateBundle(stageDir);
    if (!validation.ok) {
        logger.error(`\n❌ The bundle was rejected by the Scry Capture Format validator. Nothing was uploaded.`);
        printValidation(validation, logger);
        throw new BundleRejectedError(`Bundle rejected: ${validation.errors.length} error(s)`, validation);
    }
    if ((validation.warnings || []).length > 0) printValidation(validation, logger);

    const effective = validation.manifest || manifest || {};
    const sourceKey = opts.source || sourceKeyOf(effective);
    const zipPath = path.join(workDir, 'bundle.zip');
    await zipBundleDir(stageDir, zipPath);
    return { zipPath, stageDir, workDir, sourceKey, manifest: effective, legacy, validation, sourceText };
}

module.exports = {
    prepareBundle,
    applySourceOptIn,
    BundleRejectedError,
    SOURCE_TEXT_MAX_BYTES,
};
