/**
 * Scry Sync converter: the library the desktop app (scry-sync, Electron main process) uses to turn a synced
 * folder into an SCF bundle. CommonJS, Node >= 20.9, no network, no child processes unless the HEIC fallback is used.
 *
 *   const converter = require('@scrymore/scry-deployer/lib/converter');
 *   const scan = converter.scanFolder(folder);                         // files with kind and size; refused ones
 *   const one = await converter.convertFile(file, { root: scan.root, decoders }); // pictures + verdict + reasons + fix (root required)
 *   const { manifest } = await converter.buildBundle({ folderUuid, scan, outDir, appVersion });
 *   converter.pictureId(folderUuid, 'Sub/Home.psd')                    // stable id (see ids.js)
 *
 * `scry import` (the CLI) is unchanged and does not use this module.
 */
const { pictureId, normaliseRelativePath, PictureIdError } = require('./ids.js');
const { scanFolder, ScanError, kindOf, isTooBroad } = require('./scan.js');
const { convertFile, FORMATS } = require('./convert.js');
const { buildBundle, originBlock, BundleTooBigError, TooManyCapturesError, TOO_BIG_MESSAGE, TOO_MANY_MESSAGE, SOURCE_KIND, VENDOR_KEY, MAX_BUNDLE_BYTES, MAX_BUNDLE_CAPTURES } = require('./bundle.js');
const { VERDICTS, APPROXIMATE, FAILED } = require('./verdicts.js');
const { MAX_SOURCE_EDGE, MAX_SOURCE_PIXELS, MAX_RASTER_BYTES, MAX_RASTER_DIMENSION } = require('./raster.js');

module.exports = {
    scanFolder,
    convertFile,
    buildBundle,
    pictureId,
    normaliseRelativePath,
    originBlock,
    kindOf,
    isTooBroad,
    FORMATS,
    VERDICTS,
    APPROXIMATE,
    FAILED,
    SOURCE_KIND,
    VENDOR_KEY,
    LIMITS: Object.freeze({ MAX_SOURCE_EDGE, MAX_SOURCE_PIXELS, MAX_RASTER_BYTES, MAX_RASTER_DIMENSION, MAX_BUNDLE_BYTES, MAX_BUNDLE_CAPTURES }),
    TOO_BIG_MESSAGE,
    TOO_MANY_MESSAGE,
    BundleTooBigError,
    TooManyCapturesError,
    PictureIdError,
    ScanError,
};
