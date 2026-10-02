/**
 * PDF and Illustrator (.ai with PDF compatibility) pages, drawn with PDFium (Google's PDF renderer, compiled to
 * WebAssembly by @hyzyla/pdfium; MIT wrapper, PDFium BSD-3/Apache-2.0). One picture per page, ids `#p1`, `#p2`...
 *
 * Pages are drawn at up to 300 dpi and at most 2048 px on the longest side, on white. A text object whose font is
 * not inside the file is drawn with a stand-in font: that makes the verdict `approximate` (reason font_not_embedded).
 */
const { MAX_RASTER_DIMENSION } = require('./raster.js');

/** Pages after this many are not converted (verdict approximate, pages_capped). */
const MAX_PAGES = 100;
const MAX_DPI = 300;
/** 200 inches, in PDF points. */
const HUGE_PAGE_POINTS = 200 * 72;

let libraryPromise = null;
/** One PDFium instance per process, made on first use. */
function pdfium() {
    if (!libraryPromise) {
        const { PDFiumLibrary } = require('@hyzyla/pdfium');
        libraryPromise = PDFiumLibrary.init();
    }
    return libraryPromise;
}

function looksPasswordProtected(error) {
    return /password/i.test(String(error && error.message));
}

/** True when any text object on the page uses a font that is not embedded in the file. */
function hasMissingFont(page) {
    for (const object of page.objects()) {
        if (object.type !== 'text' || !object.module) continue;
        const font = object.module._FPDFTextObj_GetFont(object.objectIdx);
        if (font && !object.module._FPDFFont_GetIsEmbedded(font)) return true;
    }
    return false;
}

/** Page bitmap (RGBA, as @hyzyla/pdfium returns it) into packed RGB on white, ready for sharp's raw input. */
function rgbaToRgbOnWhite(data, width, height) {
    const out = Buffer.alloc(width * height * 3);
    for (let i = 0, o = 0; i < width * height * 4; i += 4, o += 3) {
        const alpha = data[i + 3] / 255;
        const over = 255 * (1 - alpha);
        out[o] = Math.round(data[i] * alpha + over);
        out[o + 1] = Math.round(data[i + 1] * alpha + over);
        out[o + 2] = Math.round(data[i + 2] * alpha + over);
    }
    return out;
}

/**
 * Draw every page (up to MAX_PAGES) of a PDF held in `bytes`.
 *
 * @param {Buffer} bytes
 * @returns {Promise<{pages: Array<{page:number, width:number, height:number, rgb:Buffer}>, codes:string[], failure?:string}>}
 */
async function renderPdfPages(bytes) {
    const library = await pdfium();
    let document;
    try {
        document = await library.loadDocument(bytes);
    } catch (error) {
        return { pages: [], codes: [], failure: looksPasswordProtected(error) ? 'locked' : 'unreadable' };
    }
    try {
        const count = document.getPageCount();
        if (count < 1) return { pages: [], codes: [], failure: 'no_pages' };
        const codes = [];
        if (count > MAX_PAGES) codes.push('pages_capped');
        const pages = [];
        let index = 0;
        for (const page of document.pages()) {
            if (index >= MAX_PAGES) break;
            index += 1;
            const { originalWidth, originalHeight } = page.getOriginalSize();
            const longest = Math.max(originalWidth, originalHeight, 1);
            if (longest >= HUGE_PAGE_POINTS) codes.push('huge_page');
            if (hasMissingFont(page)) codes.push('font_not_embedded');
            const scale = Math.min(MAX_RASTER_DIMENSION / longest, MAX_DPI / 72);
            const image = await page.render({ scale, render: 'bitmap' });
            pages.push({ page: index, width: image.width, height: image.height, rgb: rgbaToRgbOnWhite(image.data, image.width, image.height) });
        }
        return { pages, codes };
    } finally {
        document.destroy();
    }
}

/** True when the first kilobyte holds a PDF header (an Illustrator file saved with PDF compatibility). */
function hasPdfHeader(bytes) {
    return bytes.subarray(0, 1024).includes('%PDF-');
}

module.exports = { MAX_PAGES, HUGE_PAGE_POINTS, renderPdfPages, hasPdfHeader };
