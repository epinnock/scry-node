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
