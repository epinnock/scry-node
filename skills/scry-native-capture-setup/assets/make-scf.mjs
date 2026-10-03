#!/usr/bin/env node
// Write an SCF 1.0 bundle (scf.json + images/) from a screens file and a folder of PNGs.
// Usage: node scripts/make-scf.mjs --platform ios|android --screens <screens.json> --shots <dir> --out <dir>
//        [--device "iPhone 16"] [--device-os "iOS 18.6"] [--scale 3] [--tool-name "my capture script"] [--tool-version 1.0.0]
// The device is written as an object { name, os } (source.device and defaults.capture.device), the shape the dashboard
// reads; --device-os is optional and `os` is left out when it is not given.
// screens.json: [{ "id": "menu", "kind": "screen", "title": ["Screens"], "name": "Menu", "file": "App/Screens/Menu.swift", "line": 12 }, ...]
// (kind is "screen" or "component" and defaults to "screen"; title groups captures in Scry)
// Each screen needs <shots>/<id>.png. A missing PNG is listed in counts.skipped (reason "error", the closest value the
// spec's enum allows) and the script exits 1, so a half-captured run never looks green.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
// `--check --out <dir>` only validates the output folder (capture scripts call it first so a bad OUT fails before any capture).
const CHECK_ONLY = args.check !== undefined;
const need = (k) => args[k] ?? (console.error(`missing --${k}`), process.exit(2));
// Safety guard for the one destructive step (the output folder is deleted and recreated): the folder must sit
// strictly inside the current directory, must not be the cwd, `/`, $HOME or a git root, and if it exists it must be
// empty or already a Scry bundle folder (holds scf.json). Symlinks are resolved before comparing.
function realish(p) {
  const rest = [];
  let cur = path.resolve(p);
  while (!fs.existsSync(cur) && path.dirname(cur) !== cur) { rest.unshift(path.basename(cur)); cur = path.dirname(cur); }
  return path.join(fs.realpathSync(cur), ...rest);
}
function refuseOut(out) {
  const abs = realish(out);
  const cwd = fs.realpathSync(process.cwd());
  const rel = path.relative(cwd, abs);
  let why = '';
  if (!out || !String(out).trim()) why = 'it is empty';
  else if (abs === path.parse(abs).root) why = 'it is the filesystem root';
  else if (abs === realish(os.homedir())) why = 'it is your home directory';
  else if (rel === '') why = 'it is the current directory';
  else if (rel.startsWith('..') || path.isAbsolute(rel)) why = `it is outside the current directory (${cwd})`;
  else if (fs.existsSync(path.join(abs, '.git'))) why = 'it is a git repository root';
  else if (fs.existsSync(abs)) {
    if (!fs.statSync(abs).isDirectory()) why = 'it exists and is not a directory';
    else if (fs.readdirSync(abs).length > 0 && !fs.existsSync(path.join(abs, 'scf.json'))) why = 'it is not empty and has no scf.json (not a Scry bundle folder)';
  }
  if (why) {
    console.error(`make-scf: refusing to use --out "${out}" (${abs}): ${why}.`);
    console.error('make-scf: --out is deleted and recreated, so it must be a new/empty folder or an earlier Scry bundle folder inside the current directory (default .scry/capture).');
    process.exit(1);
  }
}
if (CHECK_ONLY) { refuseOut(need('out')); process.exit(0); }
const platform = need('platform');
const KINDS = {
  ios: { kind: 'swiftui-preview', framework: 'swiftui', method: 'simulator' },
  android: { kind: 'compose-preview', framework: 'compose', method: 'emulator' },
};
const k = KINDS[platform] ?? (console.error('--platform must be ios or android'), process.exit(2));
const screens = JSON.parse(fs.readFileSync(need('screens'), 'utf8'));
const shots = need('shots');
const out = need('out');
refuseOut(out);
const scale = Number(args.scale ?? (platform === 'ios' ? 3 : 2.625));
const device = args.device ? { name: args.device, ...(args['device-os'] ? { os: args['device-os'] } : {}) } : undefined;

// Screen ids are used in shell commands and regexes by the capture scripts: accept only a plain shape.
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const badIds = screens.map((s) => s.id).filter((id) => typeof id !== 'string' || !ID_SHAPE.test(id));
if (badIds.length) {
  console.error(`make-scf: invalid screen id(s): ${badIds.map((i) => JSON.stringify(i)).join(', ')}. Ids must match ${ID_SHAPE}.`);
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'images'), { recursive: true });

const captures = [];
const skipped = [];
for (const s of screens) {
  const src = path.join(shots, `${s.id}.png`);
  if (!fs.existsSync(src)) {
    skipped.push({ id: s.id, reason: 'error' });
    continue;
  }
  const rel = `images/${s.id.replace(/[^A-Za-z0-9._-]/g, '_')}.png`;
  fs.copyFileSync(src, path.join(out, rel));
  captures.push({
    id: s.id, // the original id, never the sanitised file name
    image: rel,
    kind: s.kind ?? 'screen',
    title: s.title ?? ['Screens'],
    name: s.name ?? s.id,
    code: { file: s.file, line: s.line, component: s.name ?? s.id },
    capture: { method: k.method, ...(device ? { device } : {}), scale, crop: 'none' },
  });
}

const manifest = {
  scf: '1.0',
  source: {
    kind: k.kind,
    platform,
    framework: k.framework,
    tool: { name: args['tool-name'] ?? 'scry-native-capture-setup make-scf.mjs', version: args['tool-version'] ?? '1.0.0' },
    ...(device ? { device } : {}),
  },
  defaults: { capture: { method: k.method, ...(device ? { device } : {}), scale } },
  counts: { declared: screens.length, captured: captures.length, ...(skipped.length ? { skipped } : {}) },
  captures,
};
fs.writeFileSync(path.join(out, 'scf.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`scf: ${captures.length}/${screens.length} captured, ${skipped.length} skipped -> ${out}`);
if (skipped.length) process.exitCode = 1;
