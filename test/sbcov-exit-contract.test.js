// The exit-code contract between the deployer and scry-sbcov (#51, built in
// parallel with ISSUES.md #50). Written against a fake sbcov (SCRY_SBCOV_CMD)
// so it holds before sbcov 0.5.2 ships:
//   exit 2 = broken / misspelt / unknown capture config, no archive written
//   exit 3 = stories dropped above --max-dropped, archive of the rest written
// The deployer no longer swallows a non-zero sbcov exit (lib/coverage.js):
// with an archive it uploads and queues first, then exits 1 naming the reason;
// without one it takes the "NOTHING WILL BE INDEXED" path, naming the reason.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runDeployerCli, FAKE_SBCOV, STORYBOOK_DIR } = require('./helpers/runDeployerCli.js');

jest.setTimeout(30000);

describe('sbcov exit-code contract (end to end)', () => {
  test('exit 3 with an archive: the captured stories are queued first, then the run ends red naming the reason', async () => {
    const r = await runDeployerCli({ args: ['--max-dropped', '0'], sbcovMode: 'exit3' });

    expect(r.sbcovArgs).toEqual(expect.arrayContaining(['--max-dropped', '0']));
    expect(r.sentMetadata).toBe(true);
    expect(r.out).toContain('Analysis archive holds 2 captured stories.');
    expect(r.out).toContain('queued, not finished');
    expect(r.out).toContain('scry-sbcov dropped more stories than --max-dropped allows (exit 3). The stories that were captured are queued');
    expect(r.out).toContain('1 of 3 stories were not captured (timeout 1); see sbcov-manifest.json in the archive.');
    expect(r.code).toBe(1);
  });

  // Contract update (orchestrator, 2026-09-26): sbcov 0.5.2 exits 3 only when
  // --max-dropped is passed, so the deployer always passes it (0 unless the
  // user set a value) and also enforces it from sbcov-manifest.json.
  test('by default the deployer asks sbcov for --max-dropped 0', async () => {
    const r = await runDeployerCli({ sbcovMode: 'ok' });
    expect(r.sbcovArgs).toEqual(expect.arrayContaining(['--max-dropped', '0']));
    expect(r.out).toContain('scry-sbcov: 3/3 stories captured, 0 not captured.');
    expect(r.code).toBe(0);
  });

  test("the user's --max-dropped is forwarded instead of the default", async () => {
    const r = await runDeployerCli({ args: ['--max-dropped', '5'], sbcovMode: 'ok' });
    const i = r.sbcovArgs.indexOf('--max-dropped');
    expect(r.sbcovArgs[i + 1]).toBe('5');
    expect(r.sbcovArgs.filter((a) => a === '--max-dropped')).toHaveLength(1);
  });

  test('an sbcov that exits 0 but lists drops in its manifest still ends red, after uploading', async () => {
    const r = await runDeployerCli({ sbcovMode: 'dropped-ignored' });
    expect(r.sentMetadata).toBe(true);
    expect(r.out).toContain('queued, not finished');
    expect(r.out).toContain('1 of 3 stories were not captured (timeout 1), more than');
    expect(r.out).toContain('--max-dropped 0 allows. The 2 captured stories are queued');
    expect(r.code).toBe(1);
  });

  test('drops within the --max-dropped allowance end green and are still counted', async () => {
    const r = await runDeployerCli({ args: ['--max-dropped', '5'], sbcovMode: 'dropped-ignored' });
    expect(r.out).toContain('scry-sbcov: 2/3 stories captured, 1 not captured (timeout 1).');
    expect(r.code).toBe(0);
  });

  test('an sbcov too old for --max-dropped is not sent the flag, and the log says drops cannot be counted', async () => {
    const r = await runDeployerCli({ sbcovMode: 'ok', env: { FAKE_SBCOV_OLD: '1' } });
    expect(r.sbcovArgs).not.toContain('--max-dropped');
    expect(r.out).toContain('does not support --max-dropped');
    expect(r.sentMetadata).toBe(true);
    expect(r.code).toBe(0);
  });

  test('exit 2 with no archive: nothing queued, the run ends red naming the broken capture config', async () => {
    const r = await runDeployerCli({ sbcovMode: 'exit2' });

    expect(r.hostedStorybook).toBe(true);
    expect(r.sentMetadata).toBe(false);
    expect(r.out).toContain('Analysis produced no metadata, so NOTHING WILL BE INDEXED.');
    expect(r.out).toContain('Cause: scry-sbcov rejected the capture config (exit 2).');
    expect(r.code).toBe(1);
  });

  // Review finding 3: only exit 0 and 3 promise a complete archive.
  test('a crash that left a partial archive behind never sends it', async () => {
    const r = await runDeployerCli({ sbcovMode: 'crash-after-zip' });
    expect(r.sentMetadata).toBe(false);
    expect(r.out).toContain('Cause: scry-sbcov exited with code 1.');
    expect(r.code).toBe(1);
  });

  // Review finding 6: say why an archive counted zero.
  test('an archive with no metadata.json says so', async () => {
    const r = await runDeployerCli({ sbcovMode: 'no-metadata' });
    expect(r.sentMetadata).toBe(false);
    expect(r.out).toContain('The archive: archive has no metadata.json.');
    expect(r.code).toBe(1);
  });

  // Review finding 5: the coverage subcommand reads SCRY_MAX_DROPPED like the deploy does.
  test('the coverage command forwards SCRY_MAX_DROPPED', async () => {
    const r = await runDeployerCli({ command: 'coverage', sbcovMode: 'ok', env: { SCRY_MAX_DROPPED: '4' } });
    expect(r.sbcovArgs).toEqual(expect.arrayContaining(['--max-dropped', '4']));
    expect(r.code).toBe(0);
  });

  test('any other non-zero exit is named too', async () => {
    const r = await runDeployerCli({ sbcovMode: 'crash' });

    expect(r.sentMetadata).toBe(false);
    expect(r.out).toContain('Cause: scry-sbcov exited with code 1.');
    expect(r.code).toBe(1);
  });

  test('--no-analysis: a failed coverage run is reported, the deploy still ends green', async () => {
    const r = await runDeployerCli({ args: ['--no-analysis'], sbcovMode: 'exit2' });

    expect(r.out).toContain('Coverage report not produced: scry-sbcov rejected the capture config (exit 2).');
    expect(r.out).toContain('hosted but NOT searchable');
    expect(r.code).toBe(0);
  });

  test('SCRY_MAX_DROPPED is forwarded as --max-dropped', async () => {
    const r = await runDeployerCli({ sbcovMode: 'ok', env: { SCRY_MAX_DROPPED: '5' } });
    expect(r.sbcovArgs).toEqual(expect.arrayContaining(['--max-dropped', '5']));
    expect(r.code).toBe(0);
  });

  test('a --max-dropped that is not a whole number is refused before anything is uploaded', async () => {
    const r = await runDeployerCli({ args: ['--max-dropped', '3; echo pwned'], sbcovMode: 'ok' });
    expect(r.out).toContain('Invalid maxDropped');
    expect(r.requests).toHaveLength(0);
    expect(r.sbcovArgs).toBeNull();
    expect(r.code).toBe(1);
  });
});

describe('lib/coverage runCoverageAnalysis() against the fake sbcov (in process)', () => {
  const { runCoverageAnalysis, describeSbcovExit, buildMaxDroppedArgs } = require('../lib/coverage.js');
  // Jest gives the test its own copy of process.env, which a child started by
  // execSync does not see; the mode rides in the command prefix instead.
  const useMode = (mode) => { process.env.SCRY_SBCOV_CMD = `FAKE_SBCOV_MODE=${mode} node ${FAKE_SBCOV}`; };
  let prev;
  let dir;
  beforeEach(() => {
    prev = process.env.SCRY_SBCOV_CMD;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scry-cov-'));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.SCRY_SBCOV_CMD; else process.env.SCRY_SBCOV_CMD = prev;
    fs.rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('exit 3 keeps the report and the archive, and carries the reason', async () => {
    useMode('exit3');
    const zip = path.join(dir, 'm.zip');
    const res = await runCoverageAnalysis({ storybookDir: STORYBOOK_DIR, screenshots: true, outputZipPath: zip, maxDropped: 0 });
    expect(res.metadataZipPath).toBe(zip);
    expect(res.report.summary.totalStories).toBe(3);
    expect(res.sbcovFailure).toEqual({ exitCode: 3, signal: null, reason: describeSbcovExit(3) });
  });

  test('exit 3 is not rethrown under failOnThreshold (the archive still ships)', async () => {
    useMode('exit3');
    const zip = path.join(dir, 'm.zip');
    const res = await runCoverageAnalysis({ storybookDir: STORYBOOK_DIR, screenshots: true, outputZipPath: zip, failOnThreshold: true });
    expect(res.sbcovFailure.exitCode).toBe(3);
  });

  test('exit 2 under failOnThreshold is rethrown, as other failures always were', async () => {
    useMode('exit2');
    await expect(runCoverageAnalysis({ storybookDir: STORYBOOK_DIR, failOnThreshold: true })).rejects.toThrow();
  });

  test('exit 2 returns no report, no archive, and the reason', async () => {
    useMode('exit2');
    const res = await runCoverageAnalysis({ storybookDir: STORYBOOK_DIR, screenshots: true, outputZipPath: path.join(dir, 'm.zip') });
    expect(res).toEqual({
      report: null, metadataZipPath: null,
      sbcovFailure: { exitCode: 2, signal: null, reason: 'scry-sbcov rejected the capture config (exit 2)' },
      effectiveMaxDropped: 0, maxDroppedUnsupported: false,
    });
  });

  test('describeSbcovExit names every case', () => {
    expect(describeSbcovExit(2)).toMatch(/capture config/);
    expect(describeSbcovExit(3)).toMatch(/--max-dropped/);
    expect(describeSbcovExit(127)).toMatch(/command not found/);
    expect(describeSbcovExit(null, 'SIGKILL')).toBe('scry-sbcov was killed by SIGKILL');
    expect(describeSbcovExit(null, null)).toBe('scry-sbcov could not be run');
    expect(describeSbcovExit(9)).toBe('scry-sbcov exited with code 9');
  });

  test('buildMaxDroppedArgs validates to a whole number', () => {
    expect(buildMaxDroppedArgs(undefined)).toEqual([]);
    expect(buildMaxDroppedArgs('')).toEqual([]);
    expect(buildMaxDroppedArgs(0)).toEqual(['--max-dropped', '0']);
    expect(buildMaxDroppedArgs(' 12 ')).toEqual(['--max-dropped', '12']);
    for (const bad of ['-1', '1.5', 'abc', '3; rm -rf /', '1e3']) {
      expect(() => buildMaxDroppedArgs(bad)).toThrow(/Invalid maxDropped/);
    }
  });
});
