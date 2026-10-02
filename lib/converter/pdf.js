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

/** One page as packed RGB on white. The RGBA bitmap PDFium returns goes out of scope here, before the encoder runs. */
async function drawPage(page, scale) {
    const image = await page.render({ scale, render: 'bitmap' });
    return { width: image.width, height: image.height, rgb: rgbaToRgbOnWhite(image.data, image.width, image.height) };
}

/**
 * Draw every page (up to MAX_PAGES) of a PDF held in `bytes`, ONE AT A TIME: each page is drawn, handed to
 * `onPage` (which encodes it) and released before the next is drawn, so memory holds one page's bitmap, not all of
 * them (a 100-page PDF used to peak near 1.2 GB).
 *
 * @param {Buffer} bytes
 * @param {(page:{page:number, width:number, height:number, rgb:Buffer}) => Promise<void>|void} onPage
 * @returns {Promise<{codes:string[], failure?:string}>} `failure` as in verdicts.js FAILED; an error thrown by `onPage` propagates
 */
async function renderPdfPages(bytes, onPage) {
    const library = await pdfium();
    let document;
    try {
        document = await library.loadDocument(bytes);
    } catch (error) {
        return { codes: [], failure: looksPasswordProtected(error) ? 'locked' : 'unreadable' };
    }
    try {
        const count = document.getPageCount();
        if (count < 1) return { codes: [], failure: 'no_pages' };
        const codes = [];
        if (count > MAX_PAGES) codes.push('pages_capped');
        for (let index = 0; index < Math.min(count, MAX_PAGES); index += 1) {
            const page = document.getPage(index);
            const { originalWidth, originalHeight } = page.getOriginalSize();
            const longest = Math.max(originalWidth, originalHeight, 1);
            if (longest >= HUGE_PAGE_POINTS) codes.push('huge_page');
            if (hasMissingFont(page)) codes.push('font_not_embedded');
            const drawn = await drawPage(page, Math.min(MAX_RASTER_DIMENSION / longest, MAX_DPI / 72));
            await onPage({ page: index + 1, ...drawn });
        }
        return { codes };
    } finally {
        document.destroy();
    }
}

/** True when the first kilobyte holds a PDF header (an Illustrator file saved with PDF compatibility). */
function hasPdfHeader(bytes) {
    return bytes.subarray(0, 1024).includes('%PDF-');
}

module.exports = { MAX_PAGES, HUGE_PAGE_POINTS, renderPdfPages, hasPdfHeader };
