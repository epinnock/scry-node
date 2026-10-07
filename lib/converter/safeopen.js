/**
 * Reads that refuse to follow a link at the last path segment (O_NOFOLLOW; a no-op flag on Windows, where convertFile's
 * lstat check does the same job). A file that was a plain file when the folder was scanned and is a link now is not read.
 */
const fs = require('fs');

const FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);

function openNoFollow(file) {
    return fs.openSync(file, FLAGS);
}

function readNoFollow(file) {
    const fd = openNoFollow(file);
    try {
        return fs.readFileSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

module.exports = { openNoFollow, readNoFollow };
