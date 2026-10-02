/**
 * scanFolder(path, opts): the files in ONE synced folder, each with its kind and size (guarantee G1 for the app:
 * nothing outside the folder is read).
 *
 * Same confinement rules as `scry import` (importScan.js): links are never followed, every file's real path must
 * sit inside the folder's real path, and the home folder, the disk root, the folders that hold users' homes
 * (`/home`, `/Users`, `C:\Users`) and system folders are refused as the folder to scan.
 *
 * Nothing is skipped silently (guarantee G3). Files and folders that cannot be synced come back in `refused`, each
 * with a failed verdict (this includes a subfolder that cannot be opened and a file name with a backslash).
 * Entries that are not synced by rule are COUNTED in `ignored`, with the split in `ignoredBy`:
 *   - `hidden`   any entry whose name starts with `.` (a hidden folder is counted once, not entered);
 *   - `macosx`   the `__MACOSX` folder that zip tools add (counted once, not entered);
 *   - `other`    files that are not pictures or design files (text, video...).
 * `hiddenDesigns` lists the relative paths of hidden entries that look like a picture or design file (for
 * example `.x.psd`), so the app can tell the user they were not synced; macOS's `._name.png` companion files are
 * counted but not listed.
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

const MAX_HIDDEN_LISTED = 200;

function refuse(state, rel, ext, code) {
    state.refused.push({ rel, ext, ...failed(FORMATS[ext] || null, code) });
}

function ignore(state, why, rel, ext) {
    state.ignored += 1;
    state.ignoredBy[why] += 1;
    if (why === 'hidden' && kindOf(ext) && !path.basename(rel).startsWith('._') && state.hiddenDesigns.length < MAX_HIDDEN_LISTED) {
        state.hiddenDesigns.push(rel);
    }
}

function walk(state, dirAbs, relDir, depth) {
    if (depth > MAX_DEPTH) {
        refuse(state, relDir, '', 'too_deep');
        return;
    }
    let entries;
    try {
        entries = fs.readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    } catch {
        // Never the raw system error: it carries the absolute path. The folder gets a plain failed verdict.
        if (depth === 0) throw new ScanError('This folder cannot be opened; check it still exists and that this app may read it.');
        refuse(state, relDir, '', 'folder_unreadable');
        return;
    }
    for (const entry of entries) visit(state, entry, dirAbs, relDir, depth);
}

function visit(state, entry, dirAbs, relDir, depth) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    const abs = path.join(dirAbs, entry.name);
    const ext = path.extname(entry.name).toLowerCase();
    if (entry.name === '__MACOSX') {
        ignore(state, 'macosx', rel, ext);
    } else if (entry.name.startsWith('.')) {
        ignore(state, 'hidden', rel, ext);
    } else if (entry.isSymbolicLink()) {
        if (kindOf(ext) || ext === '') refuse(state, rel, ext, 'not_followed');
        else ignore(state, 'other', rel, ext);
    } else if (entry.isDirectory()) {
        walk(state, abs, rel, depth + 1);
    } else if (entry.isFile()) {
        collect(state, abs, rel, ext);
    }
}

function collect(state, abs, rel, ext) {
    const kind = kindOf(ext);
    if (!kind) {
        ignore(state, 'other', rel, ext);
        return;
    }
    if (rel.includes('\\')) {
        refuse(state, rel, ext, 'odd_name');
        return;
    }
    if (!confinedRealPath(abs, state.root)) {
        refuse(state, rel, ext, 'outside_folder');
        return;
    }
    if (state.files.length >= state.maxFiles) {
        throw new ScanError(`This folder has more than ${state.maxFiles} pictures; link a smaller folder.`);
    }
    let stat;
    try {
        stat = fs.statSync(abs);
    } catch {
        refuse(state, rel, ext, 'unreadable');
        return;
    }
    state.files.push({ abs, rel, ext, kind, size: stat.size, mtimeMs: stat.mtimeMs });
}

/** Folders that are never a design folder: they hold users' homes or the system itself (compared case-insensitively, `\` as `/`). */
const SYSTEM_FOLDERS = new Set([
    '/', '/home', '/users', '/root', '/volumes', '/mnt', '/media', '/tmp', '/var', '/var/tmp', '/private', '/private/var', '/private/tmp',
    '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/opt', '/srv', '/boot', '/dev', '/proc', '/sys', '/run',
    '/system', '/library', '/applications', '/network', '/cores',
    'c:/users', 'c:/windows', 'c:/program files', 'c:/program files (x86)', 'c:/programdata', 'c:/documents and settings',
]);
const HOMES_PARENTS = new Set(['/home', '/users', 'c:/users', 'c:/documents and settings']);

function flat(p) {
    let out = String(p).normalize('NFC').replace(/\\/g, '/').toLowerCase();
    while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
    return out || '/';
}

/**
 * True for a folder that is too broad to scan: a disk root (`/`, `C:\`), the home folder or any folder that
 * contains it, the folder that holds the users' homes (`/home`, `/Users`, `C:\Users`) or a user's home folder, and
 * the well-known system folders. `home` is the real path of the current user's home.
 * @param {string} root real path of the folder
 * @param {string|null} [home]
 */
function isTooBroad(root, home = null) {
    const r = flat(root);
    if (SYSTEM_FOLDERS.has(r) || /^[a-z]:$/.test(r) || r === flat(path.parse(String(root)).root)) return true;
    const parent = r.slice(0, Math.max(r.lastIndexOf('/'), 0)) || '/';
    if (HOMES_PARENTS.has(parent)) return true;
    if (home) {
        const h = flat(home);
        if (r === h || h.startsWith(`${r}/`)) return true;
    }
    return false;
}

/**
 * @param {string} folder the synced folder
 * @param {{maxFiles?:number}} [opts]
 * @returns {{root:string, files:Array<{abs:string, rel:string, ext:string, kind:string, size:number, mtimeMs:number}>,
 *   refused:Array<{rel:string, ext:string, verdict:'failed', codes:string[], reasons:string[], fix:string}>, ignored:number,
 *   ignoredBy:{hidden:number, macosx:number, other:number}, hiddenDesigns:string[]}}
 *   `rel` always uses `/`. `ignored` = hidden + macosx + other (see the rules in the header).
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
    if (isTooBroad(root, home)) {
        throw new ScanError('That folder is too broad (your home folder, the whole disk or a system folder); link the folder that holds the designs.');
    }
    const state = { root, files: [], refused: [], ignored: 0, ignoredBy: { hidden: 0, macosx: 0, other: 0 }, hiddenDesigns: [], maxFiles: opts.maxFiles || MAX_FILES };
    walk(state, root, '', 0);
    return { root, files: state.files, refused: state.refused, ignored: state.ignored, ignoredBy: state.ignoredBy, hiddenDesigns: state.hiddenDesigns };
}

module.exports = { MAX_FILES, MAX_DEPTH, ScanError, kindOf, isTooBroad, scanFolder };
