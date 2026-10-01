/**
 * `scry import`: list the files in the ONE folder the user pointed at (guarantee G3).
 *
 * Nothing outside that folder is ever read: symbolic links are not followed (not for files, not for
 * folders, not for sidecars), each file's real path is checked to sit inside the folder's real path,
 * hidden entries are skipped, and there is no scanning of a library or of the user's home. The
 * command is one-shot: it reads what is there now and exits.
 */
const fs = require('fs');
const path = require('path');
const { NATIVE_EXTENSIONS, CONVERTIBLE_EXTENSIONS } = require('./importConvert.js');
const { extractXmpPacket } = require('./importXmp.js');

const MAX_FILES = 10_000; // the SCF validator's own per-bundle capture cap
const MAX_DEPTH = 32;
const MAX_SIDECAR_BYTES = 1024 * 1024;

class ImportInputError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ImportInputError';
    }
}

function isInside(child, root) {
    const rel = path.relative(root, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Real path of `abs` when it sits inside `realRoot`, else null (escape, dangling, or missing). */
function confinedRealPath(abs, realRoot) {
    try {
        const real = fs.realpathSync(abs);
        return isInside(real, realRoot) ? real : null;
    } catch {
        return null;
    }
}

function classify(ext) {
    if (NATIVE_EXTENSIONS.has(ext)) return 'native';
    if (CONVERTIBLE_EXTENSIONS.has(ext)) return 'convert';
    return null;
}

function walk(state, dirAbs, relDir, depth) {
    if (depth > MAX_DEPTH) {
        state.skipped.push({ rel: relDir || '.', reason: 'filtered', detail: 'folder nested too deeply' });
        return;
    }
    const entries = fs.readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        const abs = path.join(dirAbs, entry.name);
        if (entry.isSymbolicLink()) {
            noteSymlink(state, abs, rel);
        } else if (entry.isDirectory()) {
            walk(state, abs, rel, depth + 1);
        } else if (entry.isFile()) {
            collectFile(state, abs, rel);
        }
    }
}

/** A link is never followed. Links that could have been an image or a folder are reported; others are just ignored. */
function noteSymlink(state, abs, rel) {
    const ext = path.extname(abs).toLowerCase();
    if (ext === '' || classify(ext)) state.skipped.push({ rel, reason: 'filtered', detail: 'symbolic link not followed' });
    else state.ignored += 1;
}

function collectFile(state, abs, rel) {
    const ext = path.extname(abs).toLowerCase();
    const kind = classify(ext);
    if (!kind) {
        state.ignored += 1;
        return;
    }
    if (!confinedRealPath(abs, state.root)) {
        state.skipped.push({ rel, reason: 'filtered', detail: 'resolves outside the folder' });
        return;
    }
    if (state.files.length >= MAX_FILES) {
        throw new ImportInputError(`More than ${MAX_FILES} image files in the folder: split it and import each part.`);
    }
    state.files.push({ abs, rel, ext, kind });
}

/**
 * @param {string} folder the folder given on the command line
 * @returns {{root:string, files:Array<{abs:string, rel:string, ext:string, kind:'native'|'convert'}>, skipped:Array<{rel:string, reason:string, detail:string}>, ignored:number}}
 */
function scanFolder(folder) {
    let root;
    try {
        root = fs.realpathSync(folder);
        if (!fs.statSync(root).isDirectory()) throw new Error('not a directory');
    } catch {
        throw new ImportInputError(`Not a folder: ${folder}. Pass the folder you exported from Adobe Bridge.`);
    }
    const state = { root, files: [], skipped: [], ignored: 0 };
    walk(state, root, '', 0);
    return { root, files: state.files, skipped: state.skipped, ignored: state.ignored };
}

/**
 * The sidecar `.xmp` next to an image (`IMG_1.xmp` or `IMG_1.jpg.xmp`), as an XMP packet.
 * A sidecar that is a symbolic link, resolves outside the folder, or is not a plain small file is
 * refused, never read.
 *
 * @returns {{packet:string|null, refused:boolean}}
 */
function readSidecarPacket(imageAbs, root) {
    const stem = imageAbs.slice(0, imageAbs.length - path.extname(imageAbs).length);
    for (const candidate of [`${stem}.xmp`, `${imageAbs}.xmp`, `${stem}.XMP`, `${imageAbs}.XMP`]) {
        let stat;
        try {
            stat = fs.lstatSync(candidate);
        } catch {
            continue;
        }
        if (!stat.isFile() || stat.size > MAX_SIDECAR_BYTES || !confinedRealPath(candidate, root)) {
            return { packet: null, refused: true };
        }
        return { packet: extractXmpPacket(fs.readFileSync(candidate)), refused: false };
    }
    return { packet: null, refused: false };
}

module.exports = { MAX_FILES, ImportInputError, scanFolder, readSidecarPacket, confinedRealPath };
