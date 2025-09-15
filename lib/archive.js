const fs = require('fs');
const archiver = require('archiver');
const { FileSystemError } = require('./errors.js');

/**
 * Zips a directory and saves it to the specified output path.
 * @param {string} sourceDir The path to the directory to zip.
 * @param {string} outPath The path to save the output zip file.
 * @returns {Promise<void>} A promise that resolves when the zipping is complete.
 */
function zipDirectory(sourceDir, outPath) {
  const archive = archiver('zip', {
    zlib: { level: 9 } // Sets the compression level.
  });
  const stream = fs.createWriteStream(outPath);

  return new Promise((resolve, reject) => {
    archive
      .directory(sourceDir, false) // Adds files from sourceDir to the root of the archive
      .on('error', err => reject(new FileSystemError(`Failed to archive directory: ${err.message}`)))
      .pipe(stream);

    stream.on('close', () => {
      resolve();
    });
    archive.finalize();
  });
}

module.exports = { zipDirectory };
