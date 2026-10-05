const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// flutter-capture F19: the skill ships a Flutter CI template. Guarantee G5 (the upload can never run for a pull
// request, never on a machine we do not control, only one secret) is checked statically on the file, and the guard
// is itself tested against broken copies. The same rules run in scripts/check-skill-sync.sh.

const TEMPLATE = path.join(__dirname, '..', 'skills', 'scry-native-capture-setup', 'assets', 'flutter', 'scry-capture-flutter.yml');
const DEPLOYER = '@scrymore/scry-deployer@0.11.1';
const GATE = "if: github.event_name == 'push' && github.ref == 'refs/heads/main'";
const FORBIDDEN_TRIGGERS = ['pull_request', 'pull_request_target', 'workflow_dispatch', 'schedule', 'workflow_run', 'issue_comment', 'repository_dispatch'];
const PIN = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/;

// Whole-line comments and trailing ` # ...` comments are dropped.
function codeLines(text) {
  return text
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .map((l) => (l.includes(' #') ? l.slice(0, l.indexOf(' #')) : l).trimEnd());
}

// A step starts at a line whose text begins with "- " at the step indent (six spaces).
function stepsOf(lines) {
  const steps = [];
  for (const l of lines) {
    if (l.startsWith(`${' '.repeat(6)}- `)) steps.push([]);
    if (steps.length > 0) steps[steps.length - 1].push(l);
  }
  return steps.map((s) => s.join('\n'));
}

const hasKey = (l, key) => l.trim() === key || l.trim().startsWith(`${key} `);

function triggerRules(lines) {
  const out = [];
  const onAt = lines.indexOf('on:');
  const trigger = lines.slice(onAt, onAt + 3);
  if (JSON.stringify(trigger) !== JSON.stringify(['on:', '  push:', '    branches: [main]'])) out.push('push is not limited to branches: [main]');
  const names = lines.map((l) => l.trim().replace(/[:[\]{},]/g, ' ').trim().split(' ')[0]);
  for (const t of FORBIDDEN_TRIGGERS) if (names.includes(t)) out.push(`trigger ${t}`);
  if (lines.some((l) => l.includes('self-hosted'))) out.push('self-hosted runner');
  if (!lines.includes('    runs-on: ubuntu-latest')) out.push('not on a GitHub-hosted ubuntu-latest runner');
  return out;
}

function permissionRules(lines) {
  const out = [];
  const at = lines.indexOf('permissions:');
  if (at < 0 || lines[at + 1] !== '  contents: read' || lines[at + 2].startsWith(' ')) out.push('permissions are not exactly contents: read');
  if (lines.some((l) => l.includes(': write') || l.includes('write-all'))) out.push('write permission');
  if (!lines.includes('          persist-credentials: false')) out.push('checkout without persist-credentials: false');
  if (lines.some((l) => hasKey(l, 'env:') && l.length < 12)) out.push('job or workflow level env');
  return out;
}

function secretRules(lines) {
  const out = [];
  const body = lines.join('\n');
  const refs = body.split('secrets').length - 1;
  const bracket = body.includes('secrets[') || body.includes('inherit');
  if (refs !== 1 || bracket || !body.includes('${{ secrets.SCRY_API_KEY }}')) out.push(`secret references: ${refs}`);
  const withSecret = stepsOf(lines).filter((s) => s.includes('secrets'));
  const upload = withSecret[0] || '';
  if (withSecret.length !== 1 || !upload.includes('name: Upload to Scry')) out.push('secret is not only on the Upload to Scry step');
  if (!upload.includes(GATE)) out.push('upload step is not gated on a push to refs/heads/main');
  if (!upload.includes('[ -z "$SCRY_API_KEY" ]') || !upload.includes('[ -z "$SCRY_PROJECT_ID" ]')) out.push('upload step does not test for missing credentials');
  if (!upload.includes('::notice ') || !upload.includes('exit 0')) out.push('upload step does not skip with a notice and exit 0');
  if (lines.some((l) => l.includes('echo') && l.includes('$SCRY_API_KEY'))) out.push('prints the key');
  if (lines.some((l) => l.includes('set -x') || l.includes('bash -x'))) out.push('traces the shell');
  return out;
}

function pinRules(text, lines) {
  const out = [];
  const uses = text.split('\n').filter((l) => !l.trim().startsWith('#') && l.includes('uses:'));
  if (uses.length !== 3) out.push(`expected checkout, setup-node and flutter-action, got ${uses.length}`);
  for (const l of uses) {
    const [ref, comment = ''] = l.slice(l.indexOf('uses:') + 5).trim().split(' # ');
    if (!PIN.test(ref.trim()) || !comment.startsWith('v')) out.push(`not SHA-pinned with a version comment: ${l.trim()}`);
  }
  const npx = lines.filter((l) => l.includes('npx '));
  if (npx.length !== 2) out.push(`expected 2 npx lines (dry-run, upload), got ${npx.length}`);
  for (const l of npx) if (!l.includes(`npx ${DEPLOYER} upload .scry/capture`)) out.push(`deployer not pinned to 0.11.1: ${l.trim()}`);
  if (!lines.some((l) => l.endsWith('upload .scry/capture --dry-run'))) out.push('no secret-free bundle check (--dry-run)');
  return out;
}

function deviceRules(lines) {
  const out = [];
  if (!lines.some((l) => l.endsWith('bash scripts/capture.sh headless'))) out.push('does not run scripts/capture.sh headless');
  const device = ['android-emulator-runner', 'capture.sh android', 'capture.sh ios', 'macos-', 'avdmanager', 'xcrun'];
  if (lines.some((l) => device.some((d) => l.includes(d)))) out.push('ships a device job');
  return out;
}

function violations(text) {
  const lines = codeLines(text);
  return [...triggerRules(lines), ...permissionRules(lines), ...secretRules(lines), ...pinRules(text, lines), ...deviceRules(lines)];
}

// The upload step's script, extracted from the template, so the skip logic is run for real below.
function uploadScript(text) {
  const lines = codeLines(text);
  const start = lines.findIndex((l) => l.includes('name: Upload to Scry'));
  const runAt = lines.findIndex((l, i) => i > start && l.trim() === 'run: |');
  const envAt = lines.findIndex((l, i) => i > runAt && l.trim() === 'env:');
  return lines
    .slice(runAt + 1, envAt)
    .map((l) => l.slice(10))
    .join('\n');
}

describe('flutter CI template (G5 guard)', () => {
  const text = fs.readFileSync(TEMPLATE, 'utf8');

  test('the shipped template has no violations', () => {
    expect(violations(text)).toEqual([]);
  });

  test('the capture and the bundle check come before the upload and need no secret', () => {
    const body = codeLines(text).join('\n');
    const at = (s) => body.indexOf(s);
    expect(at('capture.sh headless')).toBeGreaterThan(-1);
    expect(at('capture.sh headless')).toBeLessThan(at('--dry-run'));
    expect(at('--dry-run')).toBeLessThan(at('name: Upload to Scry'));
  });

  test('the upload step exits 0 with a notice when the credentials are missing, and uploads when both are set', () => {
    const script = uploadScript(text);
    expect(script).toContain('npx');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flutter-ci-'));
    const bash = '/bin/bash';
    fs.writeFileSync(path.join(dir, 'npx'), '#!/bin/sh\necho "NPX-CALLED $*"\n', { mode: 0o755 });
    const summary = path.join(dir, 'summary.md');
    const run = (env) =>
      spawnSync(bash, ['-eo', 'pipefail', '-c', script], {
        env: { PATH: `${dir}:/usr/bin:/bin`, GITHUB_STEP_SUMMARY: summary, ...env },
        encoding: 'utf8',
      });
    try {
      for (const env of [{}, { SCRY_API_KEY: 'sk_live_FAKE' }, { SCRY_PROJECT_ID: 'proj_FAKE' }, { SCRY_API_KEY: '', SCRY_PROJECT_ID: '' }]) {
        const r = run(env);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('::notice title=Scry upload skipped::');
        expect(r.stdout).not.toContain('NPX-CALLED');
        expect(r.stdout + r.stderr).not.toContain('sk_live');
      }
      expect(fs.readFileSync(summary, 'utf8')).not.toContain('sk_live');
      const ok = run({ SCRY_API_KEY: 'sk_live_FAKE', SCRY_PROJECT_ID: 'proj_FAKE' });
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain(`NPX-CALLED ${DEPLOYER} upload .scry/capture`);
      expect(ok.stdout + ok.stderr).not.toContain('sk_live');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('the guard fails on a broken copy', () => {
    const pinned = text.split('\n').find((l) => l.includes('actions/checkout@')).trim();
    const cases = {
      'pull_request trigger': (t) => t.replace('on:\n  push:', 'on:\n  pull_request:\n  push:'),
      'pull_request_target trigger': (t) => t.replace('on:\n  push:', 'on:\n  pull_request_target:\n  push:'),
      'workflow_dispatch trigger': (t) => t.replace('on:\n  push:', 'on:\n  workflow_dispatch:\n  push:'),
      'push to any branch': (t) => t.replace('branches: [main]', "branches: ['**']"),
      'self-hosted runner': (t) => t.replace('runs-on: ubuntu-latest', 'runs-on: [self-hosted, linux]'),
      'unpinned action': (t) => t.replace(pinned.slice(pinned.indexOf('actions/')), 'actions/checkout@v4'),
      'pin without version comment': (t) => t.replace(' # v2.23.0', ''),
      'second secret': (t) => t.replace('${{ vars.SCRY_PROJECT_ID }}', '${{ secrets.SCRY_PROJECT_ID }}'),
      'job-level env hands the key to every step': (t) =>
        t.replace('    timeout-minutes: 30\n', '    timeout-minutes: 30\n    env:\n      SCRY_API_KEY: ${{ secrets.SCRY_API_KEY }}\n'),
      'upload without the main guard': (t) => t.replace(`        ${GATE}\n`, ''),
      'write permission': (t) => t.replace('contents: read', 'contents: write'),
      'checkout keeps credentials': (t) => t.replace('persist-credentials: false', 'persist-credentials: true'),
      'deployer unpinned': (t) => t.replace(`npx ${DEPLOYER} upload .scry/capture\n        env`, 'npx @scrymore/scry-deployer upload .scry/capture\n        env'),
      'missing credentials fail the run': (t) => t.replace('            exit 0\n', '            exit 1\n'),
      'no skip test': (t) => t.replace('[ -z "$SCRY_API_KEY" ] ||', '[ -z "$OTHER" ] ||'),
      'prints the key': (t) => t.replace(`          npx ${DEPLOYER} upload .scry/capture\n        env`, `          echo "$SCRY_API_KEY"\n          npx ${DEPLOYER} upload .scry/capture\n        env`),
      'ships an emulator job': (t) => t.replace('capture.sh headless', 'capture.sh android'),
    };
    test.each(Object.keys(cases))('%s', (name) => {
      const broken = cases[name](text);
      expect(broken).not.toBe(text); // the mutation applied
      expect(violations(broken).length).toBeGreaterThan(0);
    });
  });
});
