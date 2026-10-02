/**
 * Scry Sync converter: the library the desktop app (scry-sync, Electron main process) uses to turn a synced
 * folder into an SCF bundle. CommonJS, Node >= 18, no network, no child processes unless the HEIC fallback is used.
 *
 *   const converter = require('@scrymore/scry-deployer/lib/converter');
 *   const scan = converter.scanFolder(folder);                         // files with kind and size; refused ones
 *   const one = await converter.convertFile(file, { decoders });       // pictures + verdict + reasons + fix
 *   const { manifest } = await converter.buildBundle({ folderUuid, scan, outDir, appVersion });
 *   converter.pictureId(folderUuid, 'Sub/Home.psd')                    // stable id (see ids.js)
 *
 * `scry import` (the CLI) is unchanged and does not use this module.
 */
const { pictureId, normaliseRelativePath, PictureIdError } = require('./ids.js');
const { scanFolder, ScanError, kindOf } = require('./scan.js');
const { convertFile, FORMATS } = require('./convert.js');
const { buildBundle, originBlock, BundleTooBigError, TOO_BIG_MESSAGE, SOURCE_KIND, VENDOR_KEY, MAX_BUNDLE_BYTES } = require('./bundle.js');
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
    FORMATS,
    VERDICTS,
    APPROXIMATE,
    FAILED,
    SOURCE_KIND,
    VENDOR_KEY,
    LIMITS: Object.freeze({ MAX_SOURCE_EDGE, MAX_SOURCE_PIXELS, MAX_RASTER_BYTES, MAX_RASTER_DIMENSION, MAX_BUNDLE_BYTES }),
    TOO_BIG_MESSAGE,
    BundleTooBigError,
    PictureIdError,
    ScanError,
};
