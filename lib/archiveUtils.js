const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { FileSystemError } = require('./errors.js');

/**
 * Creates a master ZIP file containing staticsite, images, and metadata
 * @param {Object} options - Configuration options
 * @param {string} options.outPath - Output path for the master ZIP file
 * @param {string} options.staticsiteDir - Path to storybook-static directory (optional)
 * @param {string} options.screenshotsDir - Path to screenshots directory
 * @param {Object} options.metadata - Metadata object to include as JSON
 * @returns {Promise<void>} A promise that resolves when the zipping is complete
 */
function createMasterZip(options) {
  const {
    outPath,
    staticsiteDir,
    screenshotsDir,
    metadata
  } = options;

  const archive = archiver('zip', {
    zlib: { level: 9 } // Sets the compression level
  });
  const stream = fs.createWriteStream(outPath);

  return new Promise((resolve, reject) => {
    archive
      .on('error', err => reject(new FileSystemError(`Failed to create master archive: ${err.message}`)))
      .pipe(stream);

    // Add staticsite directory if provided
    if (staticsiteDir && fs.existsSync(staticsiteDir)) {
      archive.directory(staticsiteDir, 'staticsite');
    }

    // Add screenshots/images directory if it exists
    if (screenshotsDir && fs.existsSync(screenshotsDir)) {
      archive.directory(screenshotsDir, 'images');
    }

    // Add metadata.json file
    if (metadata) {
      const metadataJson = JSON.stringify(metadata, null, 2);
      archive.append(metadataJson, { name: 'metadata.json' });
    }

    stream.on('close', () => {
      resolve();
    });

    archive.finalize();
  });
}

/**
 * Creates a ZIP file from a directory with a custom internal path
 * @param {string} sourceDir - The path to the directory to zip
 * @param {string} outPath - The path to save the output zip file
 * @param {string} internalPath - The internal path within the ZIP (default: no prefix)
 * @returns {Promise<void>} A promise that resolves when the zipping is complete
 */
function zipDirectoryWithPath(sourceDir, outPath, internalPath = false) {
  const archive = archiver('zip', {
    zlib: { level: 9 }
  });
  const stream = fs.createWriteStream(outPath);

  return new Promise((resolve, reject) => {
    archive
      .directory(sourceDir, internalPath)
      .on('error', err => reject(new FileSystemError(`Failed to archive directory: ${err.message}`)))
      .pipe(stream);

    stream.on('close', () => {
      resolve();
    });
    
    archive.finalize();
  });
}

module.exports = {
  createMasterZip,
  zipDirectoryWithPath
};