const fs = require('fs');
const zlib = require('zlib');

/**
 * Count the entries in an analysis archive's metadata.json.
 *
 * scry-sbcov writes an archive even when every story failed after the browser
 * launched: its metadata.json is `[]`. Uploading that queues a build with
 * nothing to index, and the processing service then marks it `completed`, so
 * the deploy used to end green over an empty index (ISSUES.md #50). The
 * deployer counts before it uploads.
 *
 * A small reader of the ZIP central directory, not a dependency: the archive
 * is written by sbcov with `archiver` (stored or deflated entries, no ZIP64 at
 * the sizes the upload service accepts).
 *
 * Never throws. When the archive cannot be read the result says why
 * (`count: null`, `error`), and the caller must surface it.
 *
 * @param {string} zipPath
 * @returns {{count: number|null, error: string|null}}
 */
function countMetadataEntries(zipPath) {
  let buf;
  try {
    buf = fs.readFileSync(zipPath);
  } catch (err) {
    return { count: null, error: `cannot read archive: ${err.message}` };
  }

  try {
    const json = readZipEntry(buf, 'metadata.json');
    if (json === null) return { count: 0, error: 'archive has no metadata.json' };
    const parsed = JSON.parse(json.toString('utf8'));
    if (!Array.isArray(parsed)) {
      return { count: null, error: 'metadata.json is not a list' };
    }
    return { count: parsed.length, error: null };
  } catch (err) {
    return { count: null, error: err.message };
  }
}

/**
 * Return one entry's bytes, or null when the archive has no entry by that name.
 *
 * @param {Buffer} buf
 * @param {string} name
 * @returns {Buffer|null}
 */
function readZipEntry(buf, name) {
  const EOCD_SIG = 0x06054b50;
  const CEN_SIG = 0x02014b50;
  const LOC_SIG = 0x04034b50;

  // End of central directory: 22 bytes plus an optional comment of up to 64 KiB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');

  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || off === 0xffffffff) throw new Error('ZIP64 archives are not supported');

  for (let n = 0; n < total; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CEN_SIG) {
      throw new Error('corrupt zip central directory');
    }
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const entryName = buf.toString('utf8', off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;

    if (entryName !== name) continue;

    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== LOC_SIG) {
      throw new Error(`corrupt local header for ${name}`);
    }
    const start = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    const data = buf.subarray(start, start + compSize);
    if (method === 0) return data;
    if (method === 8) return zlib.inflateRawSync(data);
    throw new Error(`unsupported compression method ${method} for ${name}`);
  }
  return null;
}

module.exports = { countMetadataEntries, readZipEntry };
