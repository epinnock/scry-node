const { checkForNewerVersion, isOlder } = require('../lib/versionCheck.js');

function logger() {
  const lines = { warn: [], info: [], debug: [] };
  return { lines, warn: (m) => lines.warn.push(m), info: (m) => lines.info.push(m), debug: (m) => lines.debug.push(m) };
}

describe('deployer version self-check (ISSUES.md #50)', () => {
  test('warns when the running deployer is older than npm latest', async () => {
    const l = logger();
    const r = await checkForNewerVersion({ currentVersion: '0.2.2', logger: l, env: {}, fetchLatest: async () => '0.7.0' });
    expect(r).toEqual({ status: 'behind', latest: '0.7.0' });
    expect(l.lines.warn).toEqual([
      '⚠️  scry-deployer 0.2.2 is running; 0.7.0 is current. Older versions can report success while indexing nothing.',
    ]);
  });

  test('says nothing when current or ahead', async () => {
    for (const [cur, latest] of [['0.7.0', '0.7.0'], ['0.7.1', '0.7.0'], ['0.8.0-next.20261001', '0.7.0']]) {
      const l = logger();
      const r = await checkForNewerVersion({ currentVersion: cur, logger: l, env: {}, fetchLatest: async () => latest });
      expect(r.status).toBe('current');
      expect(l.lines.warn).toEqual([]);
    }
  });

  test('never fails the deploy: a registry error is one info line', async () => {
    const l = logger();
    const r = await checkForNewerVersion({ currentVersion: '0.7.0', logger: l, env: {}, fetchLatest: async () => { throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org'); } });
    expect(r.status).toBe('unknown');
    expect(l.lines.info[0]).toMatch(/Could not check for a newer scry-deployer \(getaddrinfo ENOTFOUND/);
    expect(l.lines.warn).toEqual([]);
  });

  test('gives up after the timeout', async () => {
    const l = logger();
    const started = Date.now();
    const r = await checkForNewerVersion({ currentVersion: '0.7.0', logger: l, env: {}, timeoutMs: 50, fetchLatest: () => new Promise(() => {}) });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r.status).toBe('unknown');
    expect(l.lines.info[0]).toMatch(/no answer from npm in 50 ms/);
  });

  test('an unreadable registry answer is reported, not trusted', async () => {
    const l = logger();
    const r = await checkForNewerVersion({ currentVersion: '0.7.0', logger: l, env: {}, fetchLatest: async () => undefined });
    expect(r.status).toBe('unknown');
    expect(l.lines.info[0]).toMatch(/registry answered/);
  });

  test('SCRY_NO_UPDATE_CHECK=1 skips it without a network call', async () => {
    const fetchLatest = jest.fn();
    const r = await checkForNewerVersion({ currentVersion: '0.2.2', logger: logger(), env: { SCRY_NO_UPDATE_CHECK: '1' }, fetchLatest });
    expect(r.status).toBe('skipped');
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  test('isOlder compares numerically and treats a prerelease of the same version as older', () => {
    expect(isOlder('0.10.0', '0.9.9')).toBe(false);
    expect(isOlder('0.9.9', '0.10.0')).toBe(true);
    expect(isOlder('0.7.0-next.1', '0.7.0')).toBe(true);
    expect(isOlder('garbage', '0.7.0')).toBe(false);
  });
});
