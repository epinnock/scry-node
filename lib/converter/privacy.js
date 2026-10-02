/**
 * The structural rule for text that comes from a file or a folder (guarantee G2: no paths, no user name leave the
 * computer). It replaces the old "find the path in the text and cut it out" heuristic, which leaked the tail of any
 * path that contained a space.
 *
 * A free-text value (an XMP title, description, keyword or label, the folder label, a failure detail) is either
 *   (a) DROPPED ENTIRELY when it contains any sign of a location: a path separator (`/` or `\`, which also covers
 *       `\\server\share`, `~/` and `file:///`), a slash lookalike (below), a drive (`C:` alone, at the start of the
 *       value or before a separator), `file:`, an old Mac colon path (`Macintosh HD:Projects:a.psd`), the synced
 *       folder's absolute root (case-insensitive, either separator style, either Unicode form) or the OS user name
 *       (or the home folder's name) as a whole word; or
 *   (b) passed through UNCHANGED.
 * Nothing in between: a value is never edited, so there is no remainder to leak. The dropped text is never echoed.
 *
 * Every rule is applied to several READINGS of the value, and one hit drops it: the value itself (NFC), its NFKC
 * form (folds fullwidth `／ ＼ ： Ｃ` and small `﹨` to their ASCII selves), and its URL-decoded forms (up to
 * MAX_DECODE_PASSES passes, so `%252F` -> `%2F` -> `/`; a bad escape such as `%ZZ` or broken UTF-8 is left as it is
 * and the rest still decodes), each also with `+` read as a space.
 *
 * Slash lookalikes, dropped like `/` and `\`: U+FF0F and U+FF3C (fullwidth; also folded by NFKC), U+FE68 (small
 * reverse solidus), U+2215 (division slash) and U+29F8 / U+29F9 (big solidus / big reverse solidus). macOS and
 * file-sync tools substitute these for `/` in file names, so a path copied from such a name carries them. U+2044
 * (fraction slash) is NOT a separator: it is how `1⁄2` is written, and dropping every fraction would be the larger loss.
 *
 * Old Mac colon paths: a volume prefix (`Macintosh HD:` or any `<word> HD:` followed by text), or a chain of three or
 * more colon-separated segments with no space after any colon and a letter in it (`Projects:Client:a.psd`). One
 * colon (`Version A:B`), a colon followed by a space (`Note: final`) and digit-only chains (`10:30:15`, `16:9`) stay.
 *
 * Whole word: the name is not touched on either side by a letter or a digit (any script), so `annsmith` is found in
 * "by annsmith" but not in "joannsmithers", "xannsmith" or "annsmith2024" (a name glued to letters or digits leaves
 * with the value: that is the accepted trade-off, since substring matching would drop ordinary words). A name joined
 * by `-` or `_` to a word ("annsmith-brand", "brand_annsmith_kit") is likewise kept, as the file-name title already
 * is, UNLESS the joined phrase is path-shaped: it also holds a home-folder word (`home`, `Users`, `Desktop`,
 * `Documents`, ...), as in a flattened path `-home-annsmith-scry` or `Users_annsmith_Desktop`. A user name with a space
 * ("Ann Smith") is matched as that whole phrase.
 */
const os = require('os');

const SEPARATOR_RE = /[\\/\uFF0F\uFF3C\uFE68\u2215\u29F8\u29F9]/u;
/** A drive at the start of the value (`C:`, `C:Users`); a drive before a separator is caught by the separator. `Version A:B` is not a drive. */
const DRIVE_RE = /^\s*["'([]?[A-Za-z]:(?:$|\S)/u;
const FILE_URL_RE = /(?:^|[^\p{L}\p{N}])file:/iu;
/** `Macintosh HD:...`, `Server HD:...`: a classic Mac volume prefix. */
const HFS_VOLUME_RE = /(?:^|[^\p{L}\p{N}])(?:[\p{L}\p{N}]+ )?HD:(?=\S)/iu;
/** A segment held between two colons, each followed directly by text: `:Projects:` in `Macintosh HD:Projects:a.psd`. */
const HFS_SEGMENT_RE = /:(?=[^\s:])([^\s:]+(?: [^\s:]+)?):(?=[^\s:])/gu;
const MIN_NAME_LENGTH = 2;
const MAX_DECODE_PASSES = 4;
/** Words that make a `-`/`_`-joined phrase holding the user's name a flattened path. */
const PATH_WORDS = new Set(['home', 'users', 'user', 'desktop', 'documents', 'downloads', 'volumes', 'onedrive', 'library', 'appdata', 'mnt', 'media', 'dropbox', 'icloud']);

function nfc(text) {
    return String(text).normalize('NFC');
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One URL-decode pass: each run of `%XX` escapes becomes its UTF-8 text (bad bytes become U+FFFD); anything else stays. */
function decodeOnce(text) {
    return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => Buffer.from(run.replace(/%/g, ''), 'hex').toString('utf8'));
}

/** Every reading of a value the rules look at (see the header). */
function readings(text) {
    const out = new Set();
    for (const seed of [nfc(text), nfc(text).normalize('NFKC')]) {
        let current = seed;
        for (let pass = 0; pass <= MAX_DECODE_PASSES; pass += 1) {
            for (const form of [current, current.normalize('NFKC')]) {
                out.add(form);
                out.add(form.replace(/\+/g, ' '));
            }
            const next = nfc(decodeOnce(current));
            if (next === current) break;
            current = next;
        }
    }
    return [...out];
}

/** An old Mac (HFS) colon path; a clock or a ratio (`10:30:15`) is not one. */
function hasColonPath(value) {
    if (HFS_VOLUME_RE.test(value)) return true;
    for (const match of value.matchAll(HFS_SEGMENT_RE)) {
        if (!/^\d+$/.test(match[1])) return true;
    }
    return false;
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
    const alternatives = [...new Set(words)].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
    // Not touched by a letter or digit, and not joined by `-`/`_` to one (the joined case is checked below).
    const wordRe = words.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?<![\\p{L}\\p{N}][-_])(?:${alternatives})(?![\\p{L}\\p{N}])(?![-_][\\p{L}\\p{N}])`, 'iu') : null;
    // A `-`/`_`-joined phrase that holds a name: dropped only when the phrase is path-shaped.
    const joinedRe = words.length ? new RegExp(`[\\p{L}\\p{N}_-]*(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])[\\p{L}\\p{N}_-]*`, 'giu') : null;
    const pathShaped = (phrase) => phrase.toLowerCase().split(/[-_]+/).some((part) => PATH_WORDS.has(part));
    const leaksOne = (value) => {
        if (SEPARATOR_RE.test(value) || DRIVE_RE.test(value) || FILE_URL_RE.test(value) || hasColonPath(value)) return true;
        const lower = value.toLowerCase();
        if (roots.some((r) => lower.includes(r))) return true;
        if (!wordRe) return false;
        if (wordRe.test(value)) return true;
        return (value.match(joinedRe) || []).some(pathShaped);
    };
    return (text) => {
        if (typeof text !== 'string') return true;
        return readings(text).some(leaksOne);
    };
}

/** The text itself when it is clean, else null (the dropped text is never kept). */
function keepIfClean(text, leaks) {
    return typeof text === 'string' && text.length > 0 && !leaks(text) ? text : null;
}

module.exports = { makeLeakCheck, keepIfClean };
