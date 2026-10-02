/**
 * The honest per-file verdict (founder decision D3, guarantee G3): every file ends as
 *   - `faithful`     uploaded as is;
 *   - `approximate`  uploaded with a visible badge, with the plain-language reasons;
 *   - `failed`       not uploaded, with a plain-language reason and the fix.
 *
 * Every reason has a stable code (for the app and for tests) and one sentence written for a designer.
 */

const VERDICTS = Object.freeze(['faithful', 'approximate', 'failed']);

const APPROXIMATE = Object.freeze({
    cmyk_no_icc: 'CMYK picture without a colour profile, so its colours are close but not exact.',
    hdr_32bit: '32-bit picture: brightness was mapped to a normal range, so it can look different from Photoshop.',
    psd_no_full_preview: 'Saved without "Maximize Compatibility", so the file has no full preview: the picture may be blank or wrong.',
    font_not_embedded: 'Some fonts are not inside the file, so text was drawn with a stand-in font.',
    huge_page: 'A page is over 200 inches wide or tall, so it was drawn small.',
    pages_capped: 'Only the first pages were converted (the file has more than the page limit).',
    extra_frames: 'The file holds more than one picture; only the first one was used.',
    colour_unmanaged: 'Colours were not converted to standard sRGB on this computer, so they can be slightly off.',
    duotone_as_grey: 'Duotone picture: shown in grey, without its ink colours.',
});

const FAILED = Object.freeze({
    unreadable: ['The file could not be read; it may be damaged or not really this type of file.', 'Open it in the app that made it and save it again.'],
    empty: ['The file is empty.', 'Save the file again from the app that made it.'],
    too_large: ['The picture is over 16,384 px on a side or over 200 megapixels, which Scry cannot use.', 'Export a smaller copy (under 16,384 px on each side) into the folder.'],
    ai_no_pdf: ['This Illustrator file was saved without PDF compatibility, so it cannot be read outside Illustrator.', 'In Illustrator, save it again with "Create PDF Compatible File" on, or export a PNG into the folder.'],
    indd_needs_pdf: ['InDesign files cannot be read directly: this needs a PDF.', 'In InDesign, export a PDF (or PNG) of it into the folder; the export will sync.'],
    unsupported_colour_mode: ['This colour mode (Lab, Multichannel) cannot be converted faithfully.', 'In Photoshop, change Image > Mode to RGB Color and save again.'],
    unsupported_compression: ['The saved preview inside this file uses a compression this app cannot read.', 'Save the file again from Photoshop.'],
    heic_no_decoder: ['This computer has no HEIC decoder.', 'On Windows, install "HEIF Image Extensions" and "HEVC Video Extensions" from the Microsoft Store; or export a JPEG into the folder.'],
    locked: ['The PDF is protected by a password.', 'Save a copy without a password into the folder.'],
    no_pages: ['The document has no pages.', 'Export it again with at least one page.'],
    output_too_big: ['The converted picture could not be made small enough (4 MB, 2048 px).', 'Export a simpler or smaller copy into the folder.'],
    not_followed: ['This is a shortcut or link to somewhere else; links are never followed.', 'Put the file itself in the folder.'],
    outside_folder: ['This file resolves to a place outside the synced folder, so it is not read.', 'Put the file itself in the folder.'],
    too_deep: ['This folder is nested too deeply to be read.', 'Move the files closer to the top of the synced folder.'],
    unsupported_type: ['This kind of file is not one Scry Sync converts.', 'Export a PNG, JPEG or PDF of it into the folder.'],
});

/** The fix shown for an approximate result, first matching code wins. */
const APPROXIMATE_FIXES = Object.freeze([
    ['psd_no_full_preview', 'In Photoshop, turn on Preferences > File Handling > "Maximize PSD and PSB File Compatibility", then save the file again.'],
    ['font_not_embedded', 'Export the PDF again with fonts embedded.'],
]);

/** The SCF `counts.skipped[].reason` a failed code is recorded under (the validator's closed set). */
const SKIP_REASON = Object.freeze({
    empty: 'empty',
    too_large: 'filtered',
    not_followed: 'filtered',
    outside_folder: 'filtered',
    too_deep: 'filtered',
    ai_no_pdf: 'unsupported',
    indd_needs_pdf: 'unsupported',
    unsupported_colour_mode: 'unsupported',
    unsupported_compression: 'unsupported',
    unsupported_type: 'unsupported',
    heic_no_decoder: 'unsupported',
    locked: 'unsupported',
});

/** A failed result for `code` (one of FAILED), with the plain reason and its fix. */
function failed(format, code, detail) {
    const [reason, fix] = FAILED[code];
    return { format, pictures: [], verdict: 'failed', codes: [code], reasons: detail ? [`${reason} (${detail})`] : [reason], fix };
}

/** The verdict for converted pictures: faithful when no approximate code fired, else approximate. */
function finish(format, pictures, codes) {
    const unique = [...new Set(codes)];
    return {
        format,
        pictures,
        verdict: unique.length === 0 ? 'faithful' : 'approximate',
        codes: unique,
        reasons: unique.map((c) => APPROXIMATE[c]),
        fix: APPROXIMATE_FIXES.find(([code]) => unique.includes(code))?.[1] ?? null,
    };
}

module.exports = { VERDICTS, APPROXIMATE, FAILED, SKIP_REASON, failed, finish };
