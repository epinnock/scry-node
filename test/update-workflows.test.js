// `update-workflows` existed in lib/ but no command called it, so a project
// had no way to regenerate a stale workflow (ISSUES.md #50, rca.md).
const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

describe('scry-deployer update-workflows', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scry-uw-'));
    execSync('git init -q . && git config user.email t@t.t && git config user.name t', { cwd: dir, stdio: 'pipe' });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { 'build-storybook': 'storybook build' } }));
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
    // What a stale consumer looks like: a bare npx deployer and no browser step.
    fs.writeFileSync(path.join(dir, '.github/workflows/deploy-storybook.yml'), 'run: npx @scrymore/scry-deployer --dir ./storybook-static\n');
    execSync('git add -A && git commit -qm seed', { cwd: dir, stdio: 'pipe' });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (...args) => spawnSync(process.execPath, [CLI, 'update-workflows', ...args], {
    cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, SCRY_TELEMETRY: '0' },
  });

  test('rewrites both workflows from the current templates', () => {
    const r = run();
    expect(r.status).toBe(0);
    const main = fs.readFileSync(path.join(dir, '.github/workflows/deploy-storybook.yml'), 'utf8');
    const pr = fs.readFileSync(path.join(dir, '.github/workflows/deploy-pr-preview.yml'), 'utf8');
    for (const y of [main, pr]) {
      expect(y).toContain(`@scrymore/scry-deployer@${require('../lib/templates.js').DEPLOYER_RANGE}`);
      expect(y).toContain('npx --no-install playwright install --with-deps chromium-headless-shell');
      expect(y).toContain('pnpm run build-storybook');
      expect(y).not.toMatch(/npx @scrymore\/scry-deployer/);
    }
    expect(r.stdout).toContain('Package manager: pnpm');
  });

  test('--commit commits them, and the message is never run by a shell', () => {
    const marker = path.join(dir, 'pwned');
    const r = run('--commit', '--commit-message', `update "$(touch ${marker})"`);
    expect(r.status).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
    const log = execSync('git log -1 --format=%s', { cwd: dir, encoding: 'utf8' }).trim();
    expect(log).toBe(`update "$(touch ${marker})"`);
    const files = execSync('git show --name-only --format= HEAD', { cwd: dir, encoding: 'utf8' });
    expect(files).toContain('.github/workflows/deploy-pr-preview.yml');
  });

  test('is listed in --help', () => {
    const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', env: { PATH: process.env.PATH, SCRY_TELEMETRY: '0' } });
    expect(r.stdout).toContain('update-workflows');
    expect(r.stdout).toContain('--no-analysis');
  });
});
