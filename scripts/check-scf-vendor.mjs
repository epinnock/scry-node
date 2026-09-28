#!/usr/bin/env node
// Fails when the vendored @scrymore/scf (lib/vendor/scf) is not the latest release of
// scryorg/scry-capture-format. Until the package is published to npm (capture-sources: at the
// sbcov public flip) every consumer vendors dist/ and records the source commit in VERSION.
//
// "Latest" = the newest tag of the repo; while the repo has no tags yet, the head of its `stage`
// branch. Needs git + network; with SCF_VENDOR_OFFLINE=1 it only checks that VERSION is a sha.
//
// Usage: node scripts/check-scf-vendor.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.SCF_REPO_URL || 'https://github.com/scryorg/scry-capture-format.git';
const here = dirname(fileURLToPath(import.meta.url));
const versionFile = join(here, '..', 'lib', 'vendor', 'scf', 'VERSION');
const vendored = readFileSync(versionFile, 'utf8').trim();

if (!/^[0-9a-f]{40}$/.test(vendored)) {
  console.error(`check-scf-vendor: ${versionFile} does not hold a full commit sha (${JSON.stringify(vendored)}).`);
  process.exit(1);
}
if (process.env.SCF_VENDOR_OFFLINE === '1') {
  console.log(`check-scf-vendor: offline, vendored ${vendored.slice(0, 7)} (not compared).`);
  process.exit(0);
}

function lsRemote(options, patterns = []) {
  return execFileSync('git', ['ls-remote', ...options, REPO, ...patterns], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
}

// Peeled tags (^{}) point at the commit; prefer them over the tag object.
const tags = lsRemote(['--tags', '--sort=-v:refname']);
let latest = null;
let label = null;
if (tags.length > 0) {
  const name = tags[0][1].replace(/\^\{\}$/, '');
  const peeled = tags.find(([, ref]) => ref === `${name}^{}`);
  latest = (peeled || tags.find(([, ref]) => ref === name))[0];
  label = name.replace('refs/tags/', 'tag ');
} else {
  const stage = lsRemote([], ['refs/heads/stage']);
  if (stage.length === 0) {
    console.error('check-scf-vendor: the repo has no tags and no stage branch.');
    process.exit(1);
  }
  latest = stage[0][0];
  label = 'stage (no tags yet)';
}

if (latest !== vendored) {
  console.error(
    `check-scf-vendor: vendored @scrymore/scf is ${vendored.slice(0, 7)}, latest is ${latest.slice(0, 7)} (${label}).\n` +
      '  Re-vendor: clone scry-capture-format at that sha, `npm ci && npm run build` in packages/scf,\n' +
      '  copy dist/*.js + *.d.ts into lib/vendor/scf/ and write the sha to lib/vendor/scf/VERSION.',
  );
  process.exit(1);
}
console.log(`check-scf-vendor: vendored @scrymore/scf ${vendored.slice(0, 7)} is the latest (${label}).`);
