/**
 * scanFolder(path, opts): the files in ONE synced folder, each with its kind and size (guarantee G1 for the app:
 * nothing outside the folder is read).
 *
 * Same confinement rules as `scry import` (importScan.js): links are never followed, every file's real path must
 * sit inside the folder's real path, hidden entries and __MACOSX are skipped, the home folder and the disk root
 * are refused. Files that cannot be synced are not dropped silently: they come back in `refused`, each with a
 * failed verdict, so every file in the folder ends with a verdict (guarantee G3).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { confinedRealPath } = require('../importScan.js');
const { FORMATS } = require('./convert.js');
const { failed } = require('./verdicts.js');

const MAX_FILES = 10_000; // the SCF validator's per-bundle capture cap
const MAX_DEPTH = 32;

class ScanError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ScanError';
    }
}

/** kind: `picture` (PNG/JPEG/WebP), `convert` (TIFF, PSD, PSB, HEIC, PDF, AI) or `needs-pdf` (InDesign). */
function kindOf(ext) {
    const format = FORMATS[ext];
    if (!format) return null;
    if (format === 'indd') return 'needs-pdf';
    return ['png', 'jpeg', 'webp'].includes(format) ? 'picture' : 'convert';
}

function refuse(state, rel, ext, code) {
    state.refused.push({ rel, ext, ...failed(FORMATS[ext] || null, code) });
}

function walk(state, dirAbs, relDir, depth) {
    if (depth > MAX_DEPTH) {
        refuse(state, relDir, '', 'too_deep');
        return;
    }
    const entries = fs.readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        const abs = path.join(dirAbs, entry.name);
        const ext = path.extname(entry.name).toLowerCase();
        if (entry.isSymbolicLink()) {
            if (kindOf(ext) || ext === '') refuse(state, rel, ext, 'not_followed');
            else state.ignored += 1;
        } else if (entry.isDirectory()) {
            walk(state, abs, rel, depth + 1);
        } else if (entry.isFile()) {
            collect(state, abs, rel, ext);
        }
    }
}

function collect(state, abs, rel, ext) {
    const kind = kindOf(ext);
    if (!kind) {
        state.ignored += 1;
        return;
    }
    if (!confinedRealPath(abs, state.root)) {
        refuse(state, rel, ext, 'outside_folder');
        return;
    }
    if (state.files.length >= state.maxFiles) {
        throw new ScanError(`This folder has more than ${state.maxFiles} pictures; link a smaller folder.`);
    }
    const stat = fs.statSync(abs);
    state.files.push({ abs, rel, ext, kind, size: stat.size, mtimeMs: stat.mtimeMs });
}

/**
 * @param {string} folder the synced folder
 * @param {{maxFiles?:number}} [opts]
 * @returns {{root:string, files:Array<{abs:string, rel:string, ext:string, kind:string, size:number, mtimeMs:number}>,
 *   refused:Array<{rel:string, ext:string, verdict:'failed', codes:string[], reasons:string[], fix:string}>, ignored:number}}
 *   `rel` always uses `/`. `ignored` counts files that are not pictures or design files (text, video...).
 */
function scanFolder(folder, opts = {}) {
    let root;
    try {
        root = fs.realpathSync(folder);
        if (!fs.statSync(root).isDirectory()) throw new Error('not a directory');
    } catch {
        throw new ScanError('This folder cannot be opened; check it still exists.');
    }
    let home = null;
    try {
        home = fs.realpathSync(os.homedir());
    } catch {
        home = null;
    }
    if (root === path.parse(root).root || root === home) {
        throw new ScanError('That folder is too broad (your home folder or the whole disk); link the folder that holds the designs.');
    }
    const state = { root, files: [], refused: [], ignored: 0, maxFiles: opts.maxFiles || MAX_FILES };
    walk(state, root, '', 0);
    return { root, files: state.files, refused: state.refused, ignored: state.ignored };
}

module.exports = { MAX_FILES, MAX_DEPTH, ScanError, kindOf, scanFolder };
