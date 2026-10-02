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
 * ONE NORMALISATION, ITERATED TO A FIXPOINT (F120, F121). The rules are not applied to the value as typed; they are
 * applied to EVERY form of it that the normalising operations reach, in EVERY order, until no new form appears:
 *   fold: strip invisible format characters (Cf: zero-width space and joiners, bidi marks, soft hyphen; U+034F, the
 *     combining grapheme joiner; variation selectors, Hangul fillers, tag characters), NFKC (folds fullwidth
 *     `％ ／ ＼ ： Ｃ`), case fold, map every slash lookalike to `/` and every colon lookalike to `:`;
 *   decode (lenient and strict): ONE scan that decodes every escape present exactly once: `%XX` runs (UTF-8; bytes
 *     that are not valid UTF-8 stay as typed), `%uXXXX`, numeric entities (`&#47;`, `&#x2F;`, any number of leading
 *     zeros; lenient also without `;`) and named entities (`&sol;`, `&bsol;`, `&setminus;`, `&Backslash;`, `&amp;`,
 *     `&percnt;`, ...). A decoded character is never re-scanned in the same step.
 * The operations do not commute (a fullwidth `％` revealed by a decode needs a fold before the next decode), so every
 * order is followed: a breadth-first search over forms, deduplicated. EVERY form reached is checked, each also read
 * with `+` as a space and with every escape still in it read as a space (so a name glued to an escape's hex letters,
 * `%2Fboxuser`, is a whole word). The value as typed (NFC), and as typed with invisibles read as spaces, is checked too.
 *
 * FAIL CLOSED: a value is dropped when the search has not reached its fixpoint after MAX_STEPS operations along any
 * order, or has produced more than MAX_FORMS distinct forms (F108, F120), or when any form is longer than the typed
 * value and its fold (only a decoded compatibility character can grow it). A value longer than MAX_CHECKED_LENGTH is
 * dropped whole without being scanned (F109; XMP values are capped to 2000 well before this, and the folder label is
 * cut to its 200 shown characters BEFORE the check). Each operation and each rule runs in time linear in the text,
 * and the forms are bounded, so the whole check is linear in the text.
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
 * a.psd`), or a colon glued to a file name (`Client:a.psd`; a version suffix such as `.v2` is not a file extension, so
 * `Step:final.v2` stays). One colon (`Version A:B`), a colon followed by a space (`Note: final`), chains not ending
 * in a file name (`Step 1: crop: done`) and digit-only chains (`10:30:15`, `16:9`) stay. A single letter and a colon
 * at the start is a drive (`C:`, `C:Users`) unless one letter or digit and a space follow (`A:B testing`).
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

const LOOKALIKE_SLASHES = '\\uFF0F\\uFF3C\\uFE68\\u2215\\u2216\\u29F5\\u29F6\\u29F8\\u29F9\\u2571\\u2572\\u27CB\\u27CD';
const SEPARATOR_RE = new RegExp(`[\\\\/${LOOKALIKE_SLASHES}]`, 'u');
const LOOKALIKE_SLASH_RE = new RegExp(`[${LOOKALIKE_SLASHES}]`, 'gu');
/** Colon lookalikes that sync tools put in file names in place of `:` (U+A789 modifier colon, U+2236 ratio, U+02F8). */
const LOOKALIKE_COLON_RE = /[\uA789\u2236\u02F8]/gu;
/** Invisible characters stripped before the check: format characters, the combining grapheme joiner, variation selectors, Hangul fillers. */
const INVISIBLE_RE = /[\p{Cf}\p{Variation_Selector}\u034F\u115F\uFFA0]|\u1160|\u17B4|\u17B5|\u3164/gu;
/** A drive at the start of the value (`C:`, `C:Users`); a drive before a separator is caught by the separator. `Version A:B` is not a drive. */
const DRIVE_RE = /^\s*["'([]?[A-Za-z]:(?:$|(?![\p{L}\p{N}]\s)\S)/u;
const FILE_URL_RE = /(?:^|[^\p{L}\p{N}])file:/iu;
/** `Macintosh HD:...`, `Server HD:...`: a classic Mac volume prefix. */
const HFS_VOLUME_RE = /(?:^|[^\p{L}\p{N}])(?:[\p{L}\p{N}]+ )?HD:(?:(?=\S)| [^:]*:)/iu;
/** A colon glued to a file name: `Client:a.psd`. The lookbehind keeps the scan linear (one start per colon). */
const COLON_FILE_RE = /(?<=[^\s:]):[^\s:]*\.(?![vV]\d+(?![\p{L}\p{N}]))[A-Za-z][A-Za-z0-9]{0,4}(?![\p{L}\p{N}])/u;
/** The last segment of a colon chain that is a file name: `a.psd` in `Macintosh HD: Projects: a.psd`. */
const FILE_NAME_RE = /^\s*\S+\.[A-Za-z][A-Za-z0-9]{0,4}\s*$/u;
/** A segment held between two colons, each followed directly by text: `:Projects:` in `Macintosh HD:Projects:a.psd`. */
const HFS_SEGMENT_RE = /:(?=[^\s:])([^\s:]+(?: [^\s:]+)?):(?=[^\s:])/gu;
const MIN_NAME_LENGTH = 2;
/** Operations along any one order, and distinct forms in all, before a value that still changes is dropped (fail closed). */
const MAX_STEPS = 16;
const MAX_FORMS = 256;
/** Longer values are dropped whole, never scanned (F109). */
const MAX_CHECKED_LENGTH = 4096;
/** Words that make a `-`/`_`-joined phrase holding the user's name a flattened path. */
const PATH_WORDS = new Set([
    'home', 'users', 'user', 'desktop', 'documents', 'downloads', 'volumes', 'onedrive', 'library', 'appdata', 'mnt', 'media', 'dropbox', 'icloud',
    'srv', 'opt', 'var', 'tmp', 'private', 'root', 'etc', 'usr', 'data', 'workspace', 'workspaces', 'projects',
]);
/**
 * HTML named entities (looked up after the case fold) that can spell a path, a name break or another escape. Others
 * are left as they are. Every one decodes to text no longer than the entity.
 */
const NAMED_ENTITIES = Object.freeze({
    amp: '&', sol: '/', bsol: '\\', setminus: '\u2216', setmn: '\u2216', smallsetminus: '\u2216', ssetmn: '\u2216', backslash: '\u2216',
    dsol: '\u29F6', colon: ':', period: '.', percnt: '%', num: '#', semi: ';', lowbar: '_', underbar: '_', hyphen: '\u2010', dash: '\u2010',
    minus: '\u2212', nbsp: '\u00A0', lt: '<', gt: '>', quot: '"', apos: "'", tilde: '~', excl: '!', commat: '@', plus: '+', equals: '=',
});
/** Any escape the decoder knows (any case): `%XX`, `%uXXXX`, `&#..;`, `&#x..;`, `&name;`. */
const ESCAPE_RE = new RegExp(['%u[0-9a-f]{4}', '%[0-9a-f]{2}', '&#x?[0-9a-z]+;?', '&[a-z][a-z0-9]{1,31};?'].join('|'), 'gi');

function nfc(text) {
    return String(text).normalize('NFC');
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A numeric entity's character: any number of leading zeros; past U+10FFFF (or NUL) it is U+FFFD, as browsers read it. */
function numericEntity(digits, radix) {
    const significant = digits.replace(/^0+/, '');
    if (significant.length > 7) return '\uFFFD';
    const code = significant ? Number.parseInt(significant, radix) : 0;
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD';
}

/** Strip invisibles, NFKC, case fold, map slash and colon lookalikes. Linear; NFKC alone may lengthen the text. */
function fold(text) {
    return text
        .replace(INVISIBLE_RE, '')
        .normalize('NFKC')
        .toLowerCase()
        .normalize('NFKC')
        .replace(LOOKALIKE_SLASH_RE, '/')
        .replace(LOOKALIKE_COLON_RE, ':');
}

/** Bytes of a UTF-8 sequence that starts with `lead`: [length, lowest and highest second byte], or null. */
function utf8Shape(lead) {
    if (lead >= 0xc2 && lead <= 0xdf) return [2, 0x80, 0xbf];
    if (lead === 0xe0) return [3, 0xa0, 0xbf];
    if (lead === 0xed) return [3, 0x80, 0x9f];
    if (lead >= 0xe1 && lead <= 0xef) return [3, 0x80, 0xbf];
    if (lead === 0xf0) return [4, 0x90, 0xbf];
    if (lead >= 0xf1 && lead <= 0xf3) return [4, 0x80, 0xbf];
    if (lead === 0xf4) return [4, 0x80, 0x8f];
    return null;
}

/**
 * A run of `%XX` escapes as UTF-8. A byte that does not start a valid sequence is LEFT as its escape (never turned
 * into U+FFFD), so a sequence whose lead byte is still hidden under another layer decodes once that layer is gone.
 */
function decodePercentRun(run) {
    const bytes = run.slice(1).split('%').map((h) => Number.parseInt(h, 16));
    let out = '';
    let i = 0;
    while (i < bytes.length) {
        const lead = bytes[i];
        if (lead < 0x80) {
            out += String.fromCharCode(lead);
            i += 1;
            continue;
        }
        const shape = utf8Shape(lead);
        const tail = shape ? bytes.slice(i + 1, i + shape[0]) : [];
        const valid = shape && tail.length === shape[0] - 1 && tail[0] >= shape[1] && tail[0] <= shape[2] && tail.every((b) => b >= 0x80 && b <= 0xbf);
        if (valid) {
            out += Buffer.from(bytes.slice(i, i + shape[0])).toString('utf8');
            i += shape[0];
        } else {
            out += `%${lead.toString(16).padStart(2, '0')}`;
            i += 1;
        }
    }
    return out;
}

/** The escapes the decoder knows, as capture groups in decodeMatch's argument order. */
const PERCENT_U = '%u([0-9a-f]{4})';
const PERCENT_RUN = '((?:%[0-9a-f]{2})+)';
const NUMERIC_ENTITY = String.raw`&#(?:x([0-9a-f]+)|(\d+))`;
const NAMED_ENTITY = '&([a-z][a-z0-9]{1,31});';
const LEGACY_ENTITY = '&(amp|lt|gt|quot|nbsp)(?![a-z0-9;])';
/** Every escape in one alternation, so one scan decodes each escape present exactly once. */
const LENIENT_DECODE_RE = new RegExp([PERCENT_U, PERCENT_RUN, `${NUMERIC_ENTITY};?`, NAMED_ENTITY, LEGACY_ENTITY].join('|'), 'gi');
/** The same with every entity closed by `;` (no `&#47` or `&amp` without one). */
const STRICT_DECODE_RE = new RegExp([PERCENT_U, PERCENT_RUN, `${NUMERIC_ENTITY};`, NAMED_ENTITY].join('|'), 'gi');

function decodeMatch(whole, u, run, hex, dec, name, legacy) {
    if (u !== undefined) return String.fromCharCode(Number.parseInt(u, 16));
    if (run !== undefined) return decodePercentRun(run);
    if (hex !== undefined) return numericEntity(hex, 16);
    if (dec !== undefined) return numericEntity(dec, 10);
    if (name !== undefined) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    return NAMED_ENTITIES[legacy.toLowerCase()];
}

/**
 * Decode once, in ONE scan: each escape present (`%uXXXX`, a run of `%XX`, a numeric or named entity) is replaced by
 * its text, and what a replacement produces is not looked at again until the next step, so no layer is decoded ahead
 * of the layers around it. Lenient: an entity may lack its `;` (as browsers read `&#47` and `&amp`); strict: it may
 * not (so `&#00` glued to the next layer's escape is not read as a character). Each replacement is no longer than
 * what it replaces.
 */
function decodeLenient(text) {
    return text.replace(LENIENT_DECODE_RE, decodeMatch);
}

function decodeStrict(text) {
    return text.replace(STRICT_DECODE_RE, decodeMatch);
}

/** The operations of the normalising step; readings() follows every order of them. */
const OPERATIONS = [decodeLenient, decodeStrict, fold];

/** A form as the rules look at it: itself, `+` as a space, every escape as a space, and both. */
function variants(form) {
    const plus = form.replace(/\+/g, ' ');
    return [form, plus, form.replace(ESCAPE_RE, ' '), plus.replace(ESCAPE_RE, ' ')];
}

/**
 * Every form of a value the rules look at (see the header), or null when it must be dropped unexamined.
 *
 * The normalising step is three operations, `decodeLenient`, `decodeStrict` and `fold`, and they do not commute (a fullwidth `％` must be
 * folded before the escape it starts can be decoded; a fullwidth `＆` inside an entity layer must NOT be folded before
 * that layer is decoded). So every order is followed: from each form every operation is applied, and the forms are
 * deduplicated, until every form is a fixpoint of both. Fail closed: null when that takes more than MAX_STEPS
 * operations along any order, when more than MAX_FORMS distinct forms appear, or when a form grows past the longer of
 * the value and its fold (only a decoded compatibility character can do that).
 */
function readings(text) {
    const typed = nfc(text);
    const out = new Set([...variants(typed), ...variants(typed.replace(INVISIBLE_RE, ' '))]);
    const search = { seen: new Set([typed]), limit: Math.max(typed.length, fold(typed).length), out };
    let frontier = [typed];
    let step = 0;
    while (frontier.length > 0) {
        frontier = expand(frontier, step, search);
        if (frontier === null) return null;
        step += 1;
    }
    return [...out];
}

/** One breadth-first step of readings(): every operation on every form of the frontier; null to fail closed. */
function expand(frontier, step, { seen, limit, out }) {
    const next = [];
    for (const form of frontier) {
        for (const operation of OPERATIONS) {
            const child = operation(form);
            if (seen.has(child)) continue;
            if (step >= MAX_STEPS || child.length > limit || seen.size >= MAX_FORMS) return null;
            seen.add(child);
            for (const v of variants(child)) out.add(v);
            next.push(child);
        }
    }
    return next;
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
