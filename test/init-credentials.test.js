const fs = require('fs');
const os = require('os');
const path = require('path');

const init = require('../lib/init.js');

/**
 * ISSUES.md #23.
 *
 * `init` wrote the API key into `.storybook-deployer.json`, skipped the
 * `.gitignore` update, and committed the file — because `--commit-api-key`
 * described itself as "not recommended" and defaulted to true.
 *
 * The copy was never needed. `init` sets SCRY_API_KEY as a GitHub *secret* and
 * the workflow it generates reads `${{ secrets.SCRY_API_KEY }}`, so CI never
 * looked at the config file for it. What the committed copy did achieve was
 * putting a customer's credential somewhere git history makes permanent —
 * rotating the key afterwards does not remove it, and on a public repository it
 * is disclosed outright.
 *
 * These tests pin the default, because the default is the whole defect.
 */
describe('createConfigFile', () => {
  let dir;
  let cwd;

  beforeEach(() => {
    cwd = process.cwd();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scry-init-'));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function written() {
    return JSON.parse(fs.readFileSync(path.join(dir, '.storybook-deployer.json'), 'utf8'));
  }

  it('omits the API key by default', () => {
    init.createConfigFile('proj-1', 'test-key-placeholder-not-a-credential', 'https://api.example.com', {}, undefined);

    const config = written();
    expect(config.apiKey).toBeUndefined();
    // The whole file is committed, so nothing in it may contain the key.
    expect(JSON.stringify(config)).not.toContain('test-key-placeholder');
  });

  it('still writes the settings that are safe to commit', () => {
    init.createConfigFile('proj-1', 'test-key-placeholder-not-a-credential', 'https://api.example.com', {}, false);

    const config = written();
    expect(config.project).toBe('proj-1');
    expect(config.apiUrl).toBe('https://api.example.com');
    expect(config.dir).toBe('./storybook-static');
  });

  // The escape hatch stays, for anyone who deliberately wants the old
  // behaviour — which is what the flag's own description advises against.
  it('includes the key only when explicitly asked', () => {
    init.createConfigFile('proj-1', 'test-key-placeholder-not-a-credential', 'https://api.example.com', {}, true);

    expect(written().apiKey).toBe('test-key-placeholder-not-a-credential');
  });
});

/**
 * ISSUES.md #25.
 *
 * `init` printed a fixed success checklist regardless of what actually happened.
 * Found by setting up a real GitHub repository end to end, where it reported
 * "✅ Changes committed and pushed" and "✅ Repository secret" while having done
 * neither — CI then failed at the deploy step with no credentials.
 *
 * Two independent causes, both fixed:
 *   - `git add` throws on a .gitignore'd path, and one throw aborted the loop
 *     before the workflows were staged.
 *   - `gh variable` only exists from gh 2.21; on older gh the first call threw
 *     and the secret after it was never reached.
 *
 * The tests below pin the reporting, because a wrong success message is worse
 * than a failure: it stops the user looking.
 */
describe('gitCommit', () => {
  const { execSync } = require('child_process');
  let dir, cwd;

  beforeEach(() => {
    cwd = process.cwd();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scry-commit-'));
    process.chdir(dir);
    execSync('git init -q . && git config user.email t@t.t && git config user.name t', { stdio: 'pipe' });
    fs.writeFileSync('seed.txt', 'x');
    execSync('git add -A && git commit -qm seed', { stdio: 'pipe' });
    fs.mkdirSync('.github/workflows', { recursive: true });
    fs.writeFileSync('.github/workflows/deploy-storybook.yml', 'name: deploy\n');
    fs.writeFileSync('.github/workflows/deploy-pr-preview.yml', 'name: preview\n');
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const silent = { debug() {}, info() {}, success() {}, error() {} };

  // The exact shape that broke a real repository: a leftover ignore rule from
  // the pre-0.4.0 workaround stopped the workflows being committed at all.
  it('still commits the workflows when the config file is gitignored', () => {
    fs.writeFileSync('.gitignore', '.storybook-deployer.json\n');
    fs.writeFileSync('.storybook-deployer.json', '{}');

    const result = init.gitCommit(silent);

    expect(result.success).toBe(true);
    const tracked = execSync('git ls-tree -r HEAD --name-only', { encoding: 'utf8' });
    expect(tracked).toContain('.github/workflows/deploy-storybook.yml');
    expect(tracked).toContain('.github/workflows/deploy-pr-preview.yml');
    expect(tracked).not.toContain('.storybook-deployer.json');
  });

  it('reports failure rather than success when nothing could be staged', () => {
    fs.rmSync('.github', { recursive: true, force: true });

    expect(init.gitCommit(silent).success).toBe(false);
  });
});
