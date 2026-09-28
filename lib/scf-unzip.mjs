#!/usr/bin/env node
// Extract a bundle .zip into a directory with the vendored validator's own ZIP reader, so the
// CLI reads a zip exactly the way the validator (and the upload service) does.
// Usage: node lib/scf-unzip.mjs <zip> <outDir>
// Refuses unsafe member paths (absolute, backslash, "." or ".." segments) instead of writing them.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readZip } from './vendor/scf/zip.js';
import { isSafeRelPath } from './vendor/scf/validate.js';

const [zipPath, outDir] = process.argv.slice(2);
if (!zipPath || !outDir) {
  console.error('usage: scf-unzip.mjs <zip> <outDir>');
  process.exit(2);
}
const files = readZip(readFileSync(zipPath));
const unsafe = [...files.keys()].filter((p) => !isSafeRelPath(p));
if (unsafe.length) {
  console.error(`unsafe member path(s): ${unsafe.map((p) => JSON.stringify(p)).join(', ')}`);
  process.exit(1);
}
for (const [rel, bytes] of files) {
  const abs = join(outDir, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
}
console.log(JSON.stringify({ members: files.size }));
