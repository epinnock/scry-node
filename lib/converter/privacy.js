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
 * form (folds fullwidth `／ ＼ ： Ｃ` and small `﹨` to their ASCII selves), and its decoded forms: each pass decodes
 * `%XX` runs (UTF-8), `%uXXXX` escapes and HTML entities (`&#47;`, `&#x2F;`, `&sol;`, `&amp;`, ...), so `%252F`,
 * `%u002F` and `&amp;#47;` all reach `/`; a bad escape such as `%ZZ` or broken UTF-8 is left as it is and the rest
 * still decodes. Each reading is also looked at with `+` read as a space and with every escape still left in it
 * read as a space (so a name glued to an escape's hex letters, `%2Fboxuser`, is a whole word).
 *
 * FAIL CLOSED (F108): if the value would still decode further after MAX_DECODE_PASSES passes, it is dropped: no
 * reading past the bound was looked at, so it cannot be kept. A value longer than MAX_CHECKED_LENGTH is dropped whole
 * without being scanned (F109; XMP values are capped to 2000 well before this, and the folder label is cut to its
 * 200 shown characters BEFORE the check). Every rule runs in time linear in the value's length.
 *
 * Slash lookalikes, dropped like `/` and `\`: U+FF0F and U+FF3C (fullwidth; also folded by NFKC), U+FE68 (small
 * reverse solidus), U+2215 / U+2216 (division slash / set minus), U+29F5 (reverse solidus operator), U+29F8 / U+29F9
 * (big solidus / big reverse solidus), U+2571 / U+2572 (box-drawing diagonals) and U+27CB / U+27CD (mathematical
 * rising / falling diagonal). macOS and file-sync tools substitute these for `/` in file names, so a path copied from
 * such a name carries them. U+2044 (fraction slash) is NOT a separator: it is how `1⁄2` is written, and dropping
 * every fraction would be the larger loss.
 *
 * Old Mac colon paths: a volume prefix (`Macintosh HD:` or any `<word> HD:` followed by text, or `<word> HD: a:`), a
 * chain of three or more colon-separated segments with no space after any colon and a letter in it
 * (`Projects:Client:a.psd`), a chain of three or more segments whose last one is a file name (`Macintosh HD: Projects:
 * a.psd`), or a colon glued to a file name (`Client:a.psd`). One colon (`Version A:B`), a colon followed by a space
 * (`Note: final`), chains not ending in a file name (`Step 1: crop: done`) and digit-only chains (`10:30:15`, `16:9`) stay.
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

const SEPARATOR_RE = /[\\/\uFF0F\uFF3C\uFE68\u2215\u2216\u29F5\u29F8\u29F9\u2571\u2572\u27CB\u27CD]/u;
/** A drive at the start of the value (`C:`, `C:Users`); a drive before a separator is caught by the separator. `Version A:B` is not a drive. */
const DRIVE_RE = /^\s*["'([]?[A-Za-z]:(?:$|\S)/u;
const FILE_URL_RE = /(?:^|[^\p{L}\p{N}])file:/iu;
/** `Macintosh HD:...`, `Server HD:...`: a classic Mac volume prefix. */
const HFS_VOLUME_RE = /(?:^|[^\p{L}\p{N}])(?:[\p{L}\p{N}]+ )?HD:(?:(?=\S)| [^:]*:)/iu;
/** A colon glued to a file name: `Client:a.psd`. The lookbehind keeps the scan linear (one start per colon). */
const COLON_FILE_RE = /(?<=[^\s:]):[^\s:]*\.[A-Za-z][A-Za-z0-9]{0,4}(?![\p{L}\p{N}])/u;
/** The last segment of a colon chain that is a file name: `a.psd` in `Macintosh HD: Projects: a.psd`. */
const FILE_NAME_RE = /^\s*\S+\.[A-Za-z][A-Za-z0-9]{0,4}\s*$/u;
/** A segment held between two colons, each followed directly by text: `:Projects:` in `Macintosh HD:Projects:a.psd`. */
const HFS_SEGMENT_RE = /:(?=[^\s:])([^\s:]+(?: [^\s:]+)?):(?=[^\s:])/gu;
const MIN_NAME_LENGTH = 2;
const MAX_DECODE_PASSES = 4;
/** Longer values are dropped whole, never scanned (F109). */
const MAX_CHECKED_LENGTH = 4096;
/** Words that make a `-`/`_`-joined phrase holding the user's name a flattened path. */
const PATH_WORDS = new Set([
    'home', 'users', 'user', 'desktop', 'documents', 'downloads', 'volumes', 'onedrive', 'library', 'appdata', 'mnt', 'media', 'dropbox', 'icloud',
    'srv', 'opt', 'var', 'tmp', 'private', 'root', 'etc', 'usr', 'data', 'workspace', 'workspaces', 'projects',
]);
/** HTML named entities that can spell a path (or another escape). Others are left as they are. */
const NAMED_ENTITIES = Object.freeze({ amp: '&', sol: '/', bsol: '\\', colon: ':', period: '.', percnt: '%', num: '#', semi: ';', nbsp: '\u00A0', lt: '<', gt: '>', quot: '"', apos: "'" });
/** Any escape the decoder knows: `%XX`, `%uXXXX`, `&#..;`, `&#x..;`, `&name;`. */
const ESCAPE_RE = /%u[0-9A-Fa-f]{4}|%[0-9A-Fa-f]{2}|&#\w{1,7};?|&[A-Za-z]{2,8};/g;

function nfc(text) {
    return String(text).normalize('NFC');
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function codePointText(code) {
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD';
}

/**
 * One decode pass, each escape decoded once: runs of `%XX` become their UTF-8 text (bad bytes become U+FFFD), `%uXXXX`
 * becomes its UTF-16 unit, and HTML entities become their character. Anything else stays. Every change shortens the text.
 */
function decodeOnce(text) {
    return text
        .replace(/%u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
        .replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => Buffer.from(run.replace(/%/g, ''), 'hex').toString('utf8'))
        .replace(/&#([xX])?([0-9A-Fa-f]{1,7});?/g, (whole, hexMark, digits) => {
            if (!hexMark && !/^\d+$/.test(digits)) return whole;
            return codePointText(Number.parseInt(digits, hexMark ? 16 : 10));
        })
        .replace(/&([A-Za-z]{2,8});/g, (whole, name) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);
}

/**
 * Every reading of a value the rules look at (see the header), or null when the value still decodes further after
 * MAX_DECODE_PASSES passes (the caller then drops it: fail closed).
 */
function readings(text) {
    const out = new Set();
    for (const seed of [nfc(text), nfc(text).normalize('NFKC')]) {
        let current = seed;
        let settled = false;
        for (let pass = 0; pass <= MAX_DECODE_PASSES && !settled; pass += 1) {
            for (const form of [current, current.normalize('NFKC')]) {
                for (const spaced of [form, form.replace(/\+/g, ' ')]) {
                    out.add(spaced);
                    out.add(spaced.replace(ESCAPE_RE, ' '));
                }
            }
            const next = nfc(decodeOnce(current));
            settled = next === current;
            current = next;
        }
        if (!settled) return null;
    }
    return [...out];
}

/** An old Mac (HFS) colon path; a clock or a ratio (`10:30:15`) is not one. */
function hasColonPath(value) {
    if (HFS_VOLUME_RE.test(value) || COLON_FILE_RE.test(value)) return true;
    for (const match of value.matchAll(HFS_SEGMENT_RE)) {
        if (!/^\d+$/.test(match[1])) return true;
    }
    const segments = value.split(':');
    return segments.length >= 3 && segments.slice(0, -1).every((s) => s.trim().length > 0) && FILE_NAME_RE.test(segments[segments.length - 1]);
}

const WORD_CHAR_RE = /[\p{L}\p{N}_-]/u;

/**
 * For each UTF-16 offset, where the run of letters, digits, `-` and `_` around it starts and ends (one linear pass,
 * F109). An offset just past a run (or at a non-run character) maps to the run that ends there.
 */
function wordRuns(value) {
    const start = new Array(value.length + 1);
    const end = new Array(value.length + 1);
    let runStart = 0;
    let filled = 0;
    let offset = 0;
    for (const ch of [...value, '']) {
        if (ch && WORD_CHAR_RE.test(ch)) {
            offset += ch.length;
            continue;
        }
        for (; filled <= offset; filled += 1) {
            start[filled] = runStart;
            end[filled] = offset;
        }
        offset += ch.length;
        filled = Math.max(filled, offset);
        runStart = offset;
    }
    return { start, end };
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
    // Found by the name alone, then widened over the `-`/`_`-joined run on each side: linear, unlike a regex that
    // starts a `[\p{L}\p{N}_-]*` scan at every index (F109).
    const nameRe = words.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, 'giu') : null;
    const pathShaped = (phrase) => phrase.toLowerCase().split(/[-_]+/).some((part) => PATH_WORDS.has(part));
    const joinedPathPhrase = (value) => {
        let runs = null;
        const seen = new Set();
        for (const match of value.matchAll(nameRe)) {
            runs ??= wordRuns(value);
            const from = runs.start[match.index];
            const to = runs.end[match.index + match[0].length];
            const key = `${from}:${to}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (pathShaped(value.slice(from, to))) return true;
        }
        return false;
    };
    const leaksOne = (value) => {
        if (SEPARATOR_RE.test(value) || DRIVE_RE.test(value) || FILE_URL_RE.test(value) || hasColonPath(value)) return true;
        const lower = value.toLowerCase();
        if (roots.some((r) => lower.includes(r))) return true;
        if (!wordRe) return false;
        if (wordRe.test(value)) return true;
        return joinedPathPhrase(value);
    };
    return (text) => {
        if (typeof text !== 'string' || text.length > MAX_CHECKED_LENGTH) return true;
        const all = readings(text);
        return all === null || all.some(leaksOne);
    };
}

/** The text itself when it is clean, else null (the dropped text is never kept). */
function keepIfClean(text, leaks) {
    return typeof text === 'string' && text.length > 0 && !leaks(text) ? text : null;
}

module.exports = { makeLeakCheck, keepIfClean, MAX_CHECKED_LENGTH };
