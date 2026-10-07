/**
 * Stable picture ids for Scry Sync (founder decision D2: identify a picture by its place in the folder,
 * not by its content, so editing a file keeps its id and the Figma links, issues and history on it).
 *
 *   pictureId(folderUuid, relativePath)        = sha256(folderUuid + normalisedPath), lower-case hex
 *   pictureId(folderUuid, relativePath, page)  = the same + `#p<page>` (PDF/AI pages, 1-based)
 *
 * Normalisation of the relative path, so the same file gives the same id on Windows and on a Mac:
 *   - separators: every `\` becomes `/` (a Windows path and a Mac path of the same file are equal);
 *   - leading `./` and `/`, repeated `/` and `.` segments are removed; `..` is refused (not inside the folder);
 *   - Unicode NFC (macOS hands out decomposed NFD names, Windows composed NFC ones);
 *   - case is PRESERVED: `Home.psd` and `home.psd` are two ids (a rename that only changes case is a new id).
 *
 * The folder UUID is minted once per synced folder by the app and kept locally; it is a fixed-length UUID, so
 * plain concatenation is unambiguous. The id is a hash: no path, file name or user name can be read from it.
 */
const crypto = require('crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class PictureIdError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PictureIdError';
    }
}

/** The relative path in the one form every OS agrees on (see the module comment). */
function normaliseRelativePath(relativePath) {
    if (typeof relativePath !== 'string' || relativePath.length === 0) throw new PictureIdError('relative path is empty');
    const segments = relativePath.normalize('NFC').replace(/\\/g, '/').split('/');
    const kept = [];
    for (const segment of segments) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') throw new PictureIdError('relative path leaves the folder');
        kept.push(segment);
    }
    if (kept.length === 0) throw new PictureIdError('relative path is empty');
    if (/^[A-Za-z]:$/.test(kept[0])) throw new PictureIdError('expected a path relative to the synced folder, got a drive path');
    return kept.join('/');
}

/**
 * @param {string} folderUuid the synced folder's UUID
 * @param {string} relativePath path of the file inside the folder, with `/` or `\`
 * @param {number} [page] 1-based page for PDF/AI pictures
 * @returns {string} 64 hex chars, plus `#p<page>` when a page is given
 */
function pictureId(folderUuid, relativePath, page) {
    if (typeof folderUuid !== 'string' || !UUID_RE.test(folderUuid)) throw new PictureIdError('folder id must be a UUID');
    const hex = crypto.createHash('sha256').update(folderUuid.toLowerCase() + normaliseRelativePath(relativePath), 'utf8').digest('hex');
    if (page === undefined || page === null) return hex;
    if (!Number.isInteger(page) || page < 1) throw new PictureIdError('page must be a positive integer');
    return `${hex}#p${page}`;
}

module.exports = { PictureIdError, normaliseRelativePath, pictureId };
