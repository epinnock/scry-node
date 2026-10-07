/**
 * Creative Cloud Libraries source (`x-scry-cc`): the allow-listed `origin` fields and the id of a library item.
 *
 *   origin.kind     always `cc-library`
 *   origin.library  the library's display name   (free text, dropped whole when it looks like a location)
 *   origin.item     the item's display name       (same rule)
 *   origin.stock    boolean: an Adobe Stock preview (true) or the user's own item (false)
 *   origin.link     a clean `https` adobe.com address, query and fragment stripped; anything else is DROPPED
 *
 * Guarantee G2: no signed URL, token or credential reaches an origin field. `link` is the only URL-shaped field and it
 * is rebuilt from the parsed host and path, never passed through; a value that is not a plain adobe.com page address
 * (another host, `http`, credentials, a port, an opaque or key-like path) is refused, not edited.
 */
const crypto = require('crypto');
const { PictureIdError } = require('./ids.js');
const { keepIfClean } = require('./privacy.js');

const CC_SOURCE_KIND = 'x-scry-cc';
const CC_ORIGIN_KIND = 'cc-library';
const MAX_NAME_LENGTH = 200;
const MAX_LINK_LENGTH = 300;
const MAX_PATH_SEGMENT = 64;
const MAX_ID_PART = 256;
/** `adobe.com` itself or a sub-domain of it, lower-case letters, digits and hyphens only. */
const ADOBE_HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*adobe\.com$/;
const SAFE_PATH_RE = /^\/[A-Za-z0-9._~/-]*$/;
/** A path that names a credential is refused even when it is otherwise plain (`/x/token/abc`). */
const SECRET_WORD_RE = /token|signature|credential|secret|password|passwd|auth|session|cookie|apikey|api-key|x-amz|sig=|expires/i;

/**
 * The clean address of an Adobe page, or null. Query and fragment are removed (they are where signed URLs keep their
 * secrets); everything else that is not a plain `https://<name>.adobe.com/<path>` is refused.
 * @param {unknown} raw
 * @returns {string|null}
 */
function cleanAdobeLink(raw) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LINK_LENGTH * 4) return null;
    // eslint-disable-next-line no-control-regex -- refuse control characters and whitespace anywhere in the raw text
    if (/[\u0000- \u007f\\]/.test(raw)) return null;
    let url;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!ADOBE_HOST_RE.test(url.hostname)) return null;
    const pathname = url.pathname;
    if (!SAFE_PATH_RE.test(pathname) || SECRET_WORD_RE.test(pathname)) return null;
    if (pathname.split('/').some((segment) => segment.length > MAX_PATH_SEGMENT)) return null;
    const clean = `https://${url.hostname}${pathname === '/' ? '' : pathname}`;
    return clean.length <= MAX_LINK_LENGTH ? clean : null;
}

/** A display name: cut to its shown length first, then unchanged or dropped by the structural rule (privacy.js). */
function cleanName(raw, leaks) {
    if (typeof raw !== 'string') return null;
    return keepIfClean(Array.from(raw).slice(0, MAX_NAME_LENGTH).join(''), leaks);
}

/**
 * The allow-listed `origin` fields of one Creative Cloud item.
 * @param {object} raw `{library, item, link, stock}` as supplied by the app
 * @param {(text:any)=>boolean} leaks the leak check (privacy.js)
 * @returns {{fields: object, dropped: string[]}} the fields to merge into `origin`, and the NAMES of the ones refused
 */
function ccOriginFields(raw, leaks) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const fields = { kind: CC_ORIGIN_KIND };
    const dropped = [];
    for (const name of ['library', 'item']) {
        if (source[name] === undefined || source[name] === null || source[name] === '') continue;
        const value = cleanName(source[name], leaks);
        if (value) fields[name] = value;
        else dropped.push(name);
    }
    if (typeof source.stock === 'boolean') fields.stock = source.stock;
    if (source.link !== undefined && source.link !== null && source.link !== '') {
        const link = cleanAdobeLink(source.link);
        if (link) fields.link = link;
        else dropped.push('link');
    }
    return { fields, dropped };
}

function idPart(value, name) {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_PART) throw new PictureIdError(`${name} must be a non-empty string`);
    if (value.includes('\n')) throw new PictureIdError(`${name} must not contain a line break`);
    return value;
}

/**
 * The id of a Creative Cloud library item (plan: Defaults taken):
 *   sha256("cc-library\n" + sourceUuid + "\n" + libraryId + "\n" + elementId), lower-case hex, plus `#p<page>` for a page.
 * Never the name or a path, so renaming an item in Adobe keeps it the same picture. Line breaks cannot occur inside a
 * part, so the joined text is unambiguous.
 * @param {string} sourceUuid the Creative Cloud source's UUID (minted once by the app)
 * @param {string} libraryId Adobe's library id
 * @param {string} elementId Adobe's element id
 * @param {number} [page]
 */
function ccLibraryId(sourceUuid, libraryId, elementId, page) {
    const text = ['cc-library', idPart(sourceUuid, 'source id').toLowerCase(), idPart(libraryId, 'library id'), idPart(elementId, 'element id')].join('\n');
    const hex = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    if (page === undefined || page === null) return hex;
    if (!Number.isInteger(page) || page < 1) throw new PictureIdError('page must be a positive integer');
    return `${hex}#p${page}`;
}

module.exports = { CC_SOURCE_KIND, CC_ORIGIN_KIND, cleanAdobeLink, ccOriginFields, ccLibraryId };
