/**
 * The structural rule for text that comes from a file or a folder (guarantee G2: no paths, no user name leave the
 * computer). It replaces the old "find the path in the text and cut it out" heuristic, which leaked the tail of any
 * path that contained a space.
 *
 * A free-text value (an XMP title, description, keyword or label, the folder label, a failure detail) is either
 *   (a) DROPPED ENTIRELY when it contains any sign of a location: a path separator (`/` or `\`, which also covers
 *       `\\server\share`, `~/` and `file:///`), a drive prefix (`C:`), `file:`, the synced folder's absolute root
 *       (case-insensitive, either separator style, either Unicode form) or the OS user name (or the home folder's
 *       name) as a whole word; or
 *   (b) passed through UNCHANGED.
 * Nothing in between: a value is never edited, so there is no remainder to leak. The dropped text is never echoed.
 *
 * Whole word: the name is not touched on either side by a letter or a digit (any script), so `annsmith` is found in
 * "by annsmith" and "annsmith-brand" but not in "joannsmithers". A user name with a space ("Ann Smith") is matched
 * as that whole phrase.
 */
const os = require('os');

const SEPARATOR_RE = /[\\/]/;
/** `C:` after a non-alphanumeric (or at the start) and followed by something: a drive letter, with or without a slash. */
const DRIVE_RE = /(?:^|[^\p{L}\p{N}])[A-Za-z]:(?=\S)/u;
const FILE_URL_RE = /(?:^|[^\p{L}\p{N}])file:/iu;
const MIN_NAME_LENGTH = 2;

function nfc(text) {
    return String(text).normalize('NFC');
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeUserName() {
    try {
        return os.userInfo().username;
    } catch {
        return null;
    }
}

function homeFolderName() {
    try {
        const parts = os.homedir().split(/[\\/]+/).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : null;
    } catch {
        return null;
    }
}

/** The root in both separator styles, lower-cased, NFC: the strings searched for inside a value. */
function rootForms(root) {
    if (typeof root !== 'string' || root.length < 2) return [];
    let trimmed = nfc(root).toLowerCase();
    while (trimmed.endsWith('/') || trimmed.endsWith('\\')) trimmed = trimmed.slice(0, -1);
    if (!trimmed) return [];
    return [...new Set([trimmed, trimmed.replace(/\\/g, '/'), trimmed.replace(/\//g, '\\')])];
}

/**
 * @param {{root?: string, names?: string[]}} args `root`: the synced folder's absolute path; `names`: more words that
 *   must not leave (tests). The OS user name and the home folder's name are always included.
 * @returns {(text: any) => boolean} true when the text must be dropped
 */
function makeLeakCheck({ root, names = [] } = {}) {
    const roots = rootForms(root);
    const words = [safeUserName(), homeFolderName(), ...names]
        .filter((w) => typeof w === 'string' && nfc(w).trim().length >= MIN_NAME_LENGTH)
        .map((w) => nfc(w).trim());
    const wordRe = words.length
        ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...new Set(words)].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`, 'iu')
        : null;
    return (text) => {
        if (typeof text !== 'string') return true;
        const value = nfc(text);
        if (SEPARATOR_RE.test(value) || DRIVE_RE.test(value) || FILE_URL_RE.test(value)) return true;
        const lower = value.toLowerCase();
        if (roots.some((r) => lower.includes(r))) return true;
        return Boolean(wordRe && wordRe.test(value));
    };
}

/** The text itself when it is clean, else null (the dropped text is never kept). */
function keepIfClean(text, leaks) {
    return typeof text === 'string' && text.length > 0 && !leaks(text) ? text : null;
}

module.exports = { makeLeakCheck, keepIfClean };
