// Guarantees G6 and G7 (deployer side) for ISSUES.md #54
// (scry-management/features/storybook-preview-ci-runtime/plan.md "Guarantees").
//
// G6  A run that takes longer than its budget says so, and a job can never run for hours.
// G7  Every build records how much CI time Scry took. A build whose time could not be
//     measured says so (field absent and counted), never shows a made-up zero, and
//     still uploads.
//
// The CLI cases drive the real CLI (child process, local stub upload service that
// also stands in for the GitHub Actions API, fake scry-sbcov) and assert what the
// person running CI sees and what reaches the upload service.
const http = require('http');
const { runDeployerCli } = require('./helpers/runDeployerCli.js');
const templates = require('../lib/templates.js');
const {
  resolveBudget,
  fetchJobElapsed,
  sendCiTimings,
  detectRunner,
  readCiContext,
  safeLabel,
  splitSbcovTime,
  storyCounts,
  timeLost,
} = require('../lib/ciTimings.js');
const { version: DEPLOYER_VERSION } = require('../package.json');

jest.setTimeout(30000);

const GITHUB_ENV = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'scryorg/fixture',
  GITHUB_RUN_ID: '18123456789',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_WORKFLOW: 'Deploy Storybook PR Preview',
  GITHUB_JOB: 'deploy',
  RUNNER_ENVIRONMENT: 'self-hosted',
  RUNNER_NAME: 'stub-runner',
};

const presignBody = (r) => r.requests.find((q) => q.method === 'POST' && q.path.startsWith('/presigned-url/'))?.json;
const finalBody = (r) => r.requests.find((q) => q.method === 'POST' && /\/ci-timings$/.test(q.path))?.json;
const count = (text, needle) => text.split(needle).length - 1;

describe('guarantee-6 a run over its budget says so; a job cannot run for hours', () => {
  test('guarantee-6 over-budget run prints the budget warning and still exits 0', async () => {
    const r = await runDeployerCli({
      env: {
        ...GITHUB_ENV,
        FAKE_SBCOV_EXECUTION: '1',
        FAKE_SBCOV_EXECUTE_MS: '60',
        FAKE_SBCOV_SLEEP_MS: '150',
        SCRY_EXECUTE_BUDGET_BASE_S: '0',
        SCRY_EXECUTE_BUDGET_PER_STORY_S: '0.001',
      },
    });
    expect(r.out).toMatch(/^::warning title=Scry story execution over budget::Executing 3 stories took 60 ms, over the 3 ms budget \(0 s \+ 0\.001 s × 3 stories\)/m);
    expect(r.out).toContain('Story execution took 60 ms, over its 3 ms budget');
    expect(presignBody(r).ciTimings).toMatchObject({ budgetMs: 3, overBudget: true });
    expect(r.code).toBe(0);
  });

  test('guarantee-6 a run within its budget prints the duration line and no warning', async () => {
    const r = await runDeployerCli({
      env: { ...GITHUB_ENV, FAKE_SBCOV_EXECUTION: '1', FAKE_SBCOV_EXECUTE_MS: '60', FAKE_SBCOV_SLEEP_MS: '150' },
    });
    // 120 s + 0.5 s × 3 stories
    expect(r.out).toContain('Story execution: 3 stories in 60 ms (4 workers), budget 2.0 min');
    expect(r.out).not.toContain('::warning');
    expect(presignBody(r).ciTimings).toMatchObject({ budgetMs: 121500, overBudget: false });
    expect(r.code).toBe(0);
  });

  test('guarantee-6 outside GitHub Actions the warning is a plain line, not a workflow command', async () => {
    const r = await runDeployerCli({
      env: { FAKE_SBCOV_EXECUTION: '1', FAKE_SBCOV_EXECUTE_MS: '60', FAKE_SBCOV_SLEEP_MS: '150', SCRY_EXECUTE_BUDGET_BASE_S: '0', SCRY_EXECUTE_BUDGET_PER_STORY_S: '0' },
    });
    expect(r.out).toContain('Story execution took 60 ms, over its 0 ms budget');
    expect(r.out).not.toContain('::warning');
    expect(r.code).toBe(0);
  });

  test('guarantee-6 a mistyped budget setting is named and the default is used', () => {
    const b = resolveBudget({ declared: 461, env: { SCRY_EXECUTE_BUDGET_BASE_S: '2m', SCRY_EXECUTE_BUDGET_PER_STORY_S: '-1' } });
    expect(b.budgetMs).toBe(Math.round((120 + 0.5 * 461) * 1000));
    expect(b.warnings).toHaveLength(2);
    expect(b.warnings[0]).toContain('SCRY_EXECUTE_BUDGET_BASE_S="2m"');
    // Unknown story count: no budget, not a budget of 120 s.
    expect(resolveBudget({ declared: null, env: {} }).budgetMs).toBeNull();
    // The plan's worked numbers: dashboard 461 → 5.8 min, sample app 21 → 2.2 min.
    expect(resolveBudget({ declared: 461, env: {} }).budgetMs).toBe(350500);
    expect(resolveBudget({ declared: 21, env: {} }).budgetMs).toBe(130500);
  });

  describe('guarantee-6 both workflow templates bound the job and may read Actions', () => {
    const cases = [];
    for (const gen of ['generateMainWorkflow', 'generatePRWorkflow']) {
      for (const pm of ['npm', 'pnpm', 'yarn', 'bun']) cases.push([gen, pm]);
    }
    test.each(cases)('%s (%s)', (gen, pm) => {
      const yml = templates[gen]('p', 'https://api', pm, 'build-storybook');
      expect(yml).toMatch(/\n {4}timeout-minutes: 20\n/);
      expect(yml).toMatch(/\n {4}permissions:\n(?: {6}[\w-]+: \w+\n)*? {6}actions: read\n/);
      // A permissions block drops every scope it does not list: checkout still needs contents.
      expect(yml).toMatch(/\n {4}permissions:\n(?: {6}[\w-]+: \w+\n)*? {6}contents: read\n/);
      expect(yml).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
    });
  });
});

describe('guarantee-7 every build records its CI time; unmeasured = absent and said, never 0; the upload never fails for it', () => {
  test('guarantee-7 a full record: phases, counts, versions, runner, run ids, budget, job time', async () => {
    const r = await runDeployerCli({
      env: (stubUrl) => ({
        ...GITHUB_ENV,
        GITHUB_API_URL: stubUrl,
        GITHUB_TOKEN: 'ghs_not_a_real_token',
        FAKE_SBCOV_EXECUTION: '1',
        FAKE_SBCOV_EXECUTE_MS: '60',
        FAKE_SBCOV_SLEEP_MS: '150',
      }),
    });
    expect(r.code).toBe(0);

    const pre = presignBody(r);
    expect(pre.contentType).toBe('application/zip');
    const t = pre.ciTimings;
    expect(t).toMatchObject({
      executeMs: 60,
      executeSource: 'sbcov',
      stories: { declared: 3, passed: 3, failed: 0, timeouts: 0, notIndexed: 0 },
      timeLostMs: {},
      failedTimeShare: 0,
      concurrency: 4,
      sbcovVersion: '0.6.0-fake',
      deployerVersion: DEPLOYER_VERSION,
      runner: 'self-hosted',
      ci: { provider: 'github', runId: '18123456789', runAttempt: 1, workflow: 'Deploy Storybook PR Preview', job: 'deploy' },
      budgetMs: 121500,
      overBudget: false,
    });
    for (const k of ['analyzeMs', 'archiveMs']) expect(t[k]).toBeGreaterThanOrEqual(0);
    // The pre-upload part cannot know the upload or the total yet.
    for (const k of ['uploadMs', 'deployerTotalMs', 'jobElapsedMs', 'jobTimeSource']) expect(t).not.toHaveProperty(k);

    const final = finalBody(r).ciTimings;
    expect(final).toMatchObject({ ...t, jobTimeSource: 'actions-api' });
    expect(final.uploadMs).toBeGreaterThan(0);
    expect(final.deployerTotalMs).toBeGreaterThanOrEqual(final.analyzeMs + final.executeMs + final.archiveMs + final.uploadMs);
    // The stub's job started 90 s ago.
    expect(final.jobElapsedMs).toBeGreaterThanOrEqual(90000);
    expect(final.jobElapsedMs).toBeLessThan(120000);
    expect(final).not.toHaveProperty('jobTimeReason');

    // The Actions API was asked with the token, for this run and attempt.
    const jobs = r.requests.find((q) => q.method === 'GET' && q.path === '/repos/scryorg/fixture/actions/runs/18123456789/attempts/1/jobs');
    expect(jobs.authorization).toBe('present');
    expect(r.out).toMatch(/CI time recorded: deployer \S+ (ms|s|min), job \S+ (s|min) so far \(Actions API\)/);
    // The token is never printed.
    expect(r.out).not.toContain('ghs_not_a_real_token');
  });

  test('guarantee-7 an sbcov that reports no time: execute from the deployer clock, labelled, analysis and time lost absent (not 0)', async () => {
    const r = await runDeployerCli({ env: { ...GITHUB_ENV, FAKE_SBCOV_NO_DURATION: '1' } });
    expect(r.code).toBe(0);
    const t = finalBody(r).ciTimings;
    expect(t.executeSource).toBe('deployer-wall');
    expect(t.executeMs).toBeGreaterThan(0);
    expect(t).not.toHaveProperty('analyzeMs');
    expect(t).not.toHaveProperty('timeLostMs');
    expect(t).not.toHaveProperty('failedTimeShare');
    expect(t).not.toHaveProperty('concurrency');
    // Counts an older manifest does hold are still sent.
    expect(t.stories).toMatchObject({ declared: 3, notIndexed: 0 });
    expect(t.sbcovVersion).toBe('0.5.2-fake');
  });

  test('guarantee-7 an upload service without the ci-timings route: "not stored" said once, deploy result unchanged', async () => {
    const r = await runDeployerCli({ ciTimings: 'missing', env: { ...GITHUB_ENV, FAKE_SBCOV_EXECUTION: '1' } });
    expect(finalBody(r)).toBeDefined();
    expect(count(r.out, 'upload service does not record CI timings yet; not stored')).toBe(1);
    expect(r.out).toContain('CI timings: final record not stored (1)');
    expect(r.out).toContain('Indexing has been queued');
    expect(r.code).toBe(0);
  });

  test('guarantee-7 the final record is keyed by the build id the presigned response returned', async () => {
    const r = await runDeployerCli({ env: { ...GITHUB_ENV, FAKE_SBCOV_EXECUTION: '1' } });
    expect(r.requests.some((q) => q.method === 'POST' && q.path === '/upload/fixture/main/builds/stub-build/ci-timings')).toBe(true);
    expect(r.code).toBe(0);
  });

  test('guarantee-7 fields the service dropped are named at warn; the rest is stored and the deploy unaffected', async () => {
    const r = await runDeployerCli({ ciTimings: 'dropped', env: { ...GITHUB_ENV, FAKE_SBCOV_EXECUTION: '1' } });
    expect(r.out).toContain('CI timings: stored, but the upload service dropped 1 field(s) it would not accept: ci.workflow.');
    expect(r.out).toContain('CI timings: stored with the build, 1 field(s) dropped by the service.');
    expect(r.code).toBe(0);
  });

  test('guarantee-7 a 404 "Build not found" from a service that has the route is not called an old service', async () => {
    const r = await runDeployerCli({ ciTimings: 'nobuild', env: { ...GITHUB_ENV, FAKE_SBCOV_EXECUTION: '1' } });
    expect(r.out).toContain('the upload service has the CI-timings route but did not find this build (Build not found');
    expect(r.out).not.toContain('does not record CI timings yet');
    expect(r.out).toContain('CI timings: final record not stored (1)');
    expect(r.code).toBe(0);
  });

  test('guarantee-7 an sbcov that crashed ran no stories: no execute or analyze time is made up', async () => {
    const r = await runDeployerCli({ sbcovMode: 'crash', env: { ...GITHUB_ENV } });
    const t = finalBody(r).ciTimings;
    for (const k of ['analyzeMs', 'executeMs', 'executeSource', 'budgetMs', 'overBudget', 'stories']) expect(t).not.toHaveProperty(k);
    expect(r.out).not.toContain('Story execution:');
    expect(r.code).toBe(1);
  });

  test('guarantee-7 a record the service rejects (400) is a warning with the reason, never a failed deploy', async () => {
    const r = await runDeployerCli({ ciTimings: 'reject', env: { ...GITHUB_ENV, FAKE_SBCOV_EXECUTION: '1' } });
    expect(r.out).toContain('upload service rejected the CI timings (executeMs); not stored');
    expect(r.out).toContain('CI timings: final record not stored (1)');
    expect(r.code).toBe(0);
  });

  test('guarantee-7 the same failure paths keep a red deploy red (exit code comes from indexing only)', async () => {
    const r = await runDeployerCli({ sbcovMode: 'exit3', ciTimings: 'missing', env: { ...GITHUB_ENV, FAKE_SBCOV_EXECUTION: '1' } });
    expect(r.code).toBe(1);
    expect(finalBody(r).ciTimings.stories).toMatchObject({ declared: 3, passed: 2, notIndexed: 1, timeouts: 1 });
    expect(finalBody(r).ciTimings.timeLostMs).toEqual({ render_timeout: 5000 });
  });

  test('guarantee-7 a token without actions: read: deployer time only, reason said, deploy unaffected', async () => {
    const r = await runDeployerCli({
      actionsApi: 'forbidden',
      env: (stubUrl) => ({ ...GITHUB_ENV, GITHUB_API_URL: stubUrl, GITHUB_TOKEN: 'ghs_x', FAKE_SBCOV_EXECUTION: '1' }),
    });
    expect(r.code).toBe(0);
    const t = finalBody(r).ciTimings;
    expect(t).toMatchObject({ jobTimeSource: 'deployer-only', jobTimeReason: 'forbidden' });
    expect(t).not.toHaveProperty('jobElapsedMs');
    expect(r.out).toContain('CI time recorded: deployer time only (job start unknown: forbidden)');
  });

  test('guarantee-7 no token: deployer time only (no-token), Actions API not called', async () => {
    const r = await runDeployerCli({ env: (stubUrl) => ({ ...GITHUB_ENV, GITHUB_API_URL: stubUrl, FAKE_SBCOV_EXECUTION: '1' }) });
    expect(finalBody(r).ciTimings).toMatchObject({ jobTimeSource: 'deployer-only', jobTimeReason: 'no-token' });
    expect(r.requests.some((q) => q.method === 'GET')).toBe(false);
    expect(r.code).toBe(0);
  });

  test('guarantee-7 outside GitHub Actions: runner unknown, no run ids, not-github', async () => {
    const r = await runDeployerCli({ env: { FAKE_SBCOV_EXECUTION: '1' } });
    const t = finalBody(r).ciTimings;
    expect(t.runner).toBe('unknown');
    expect(t).not.toHaveProperty('ci');
    expect(t).toMatchObject({ jobTimeSource: 'deployer-only', jobTimeReason: 'not-github' });
    expect(r.out).toContain('CI time recorded: deployer time only (job start unknown: not-github)');
    expect(r.code).toBe(0);
  });

  test('guarantee-7 --no-coverage: no execution, no execute time or budget (absent, not 0), still recorded', async () => {
    const r = await runDeployerCli({ args: ['--no-coverage', '--no-analysis'], env: { ...GITHUB_ENV } });
    expect(r.code).toBe(0);
    const t = finalBody(r).ciTimings;
    for (const k of ['analyzeMs', 'executeMs', 'executeSource', 'budgetMs', 'overBudget', 'stories', 'timeLostMs']) {
      expect(t).not.toHaveProperty(k);
    }
    expect(t.archiveMs).toBeGreaterThanOrEqual(0);
    expect(t.deployerTotalMs).toBeGreaterThan(0);
  });
});

describe('guarantee-7 units', () => {
  test('runner kind from RUNNER_ENVIRONMENT', () => {
    expect(detectRunner({ RUNNER_ENVIRONMENT: 'github-hosted' })).toBe('github-hosted');
    expect(detectRunner({ RUNNER_ENVIRONMENT: 'self-hosted' })).toBe('self-hosted');
    expect(detectRunner({})).toBe('unknown');
    expect(detectRunner({ RUNNER_ENVIRONMENT: 'weird' })).toBe('unknown');
  });

  test('workflow and job names are cleaned to what the service accepts, not dropped whole', () => {
    expect(readCiContext({ GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW: "Build & Deploy, it's CI", GITHUB_JOB: 'déploy' }))
      .toEqual({ provider: 'github', workflow: 'Build - Deploy- it-s CI', job: 'd-ploy' });
    for (const v of ["Build & Deploy, it's CI", 'déploy', 'a;b|c']) {
      expect(safeLabel(v)).toMatch(/^[\w .:@+/()-]+$/);
    }
  });

  test('run ids are bounded and malformed ones are left out', () => {
    expect(readCiContext({})).toBeNull();
    expect(readCiContext({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: 'abc', GITHUB_RUN_ATTEMPT: '0', GITHUB_WORKFLOW: 'x'.repeat(500) }))
      .toEqual({ provider: 'github', workflow: 'x'.repeat(100) });
  });

  test('execute time from sbcov is used only when it fits inside the sbcov run', () => {
    expect(splitSbcovTime({ sbcovWallMs: 1000, manifestExecution: { durationMs: 700 }, executed: true }))
      .toEqual({ analyzeMs: 300, executeMs: 700, executeSource: 'sbcov' });
    expect(splitSbcovTime({ sbcovWallMs: 1000, report: { execution: { summary: { duration: 900 } } }, executed: true }))
      .toEqual({ analyzeMs: 100, executeMs: 900, executeSource: 'sbcov' });
    expect(splitSbcovTime({ sbcovWallMs: 1000, manifestExecution: { durationMs: 5000 }, executed: true }))
      .toEqual({ executeMs: 1000, executeSource: 'deployer-wall' });
    expect(splitSbcovTime({ sbcovWallMs: 1000, executed: false })).toEqual({ analyzeMs: 1000 });
    expect(splitSbcovTime({ sbcovWallMs: null, executed: true })).toEqual({});
  });

  test('counts and time lost: unknown is absent, never 0', () => {
    expect(storyCounts({})).toBeUndefined();
    expect(timeLost(undefined)).toBeUndefined();
    expect(timeLost({ timeLostMs: {} })).toEqual({});
    expect(timeLost({ timeLostMs: { timeout: 3000, bad: -1, worse: 'x' } })).toEqual({ timeout: 3000 });
  });

  test('the Actions API call is bounded: a slow API gives deployer-only (timeout)', async () => {
    const server = http.createServer(() => { /* never answers */ });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const t0 = Date.now();
      const res = await fetchJobElapsed({
        env: { ...GITHUB_ENV, GITHUB_TOKEN: 't', GITHUB_API_URL: `http://127.0.0.1:${server.address().port}` },
        timeoutMs: 300,
      });
      expect(res).toEqual({ jobTimeSource: 'deployer-only', jobTimeReason: 'timeout' });
      expect(Date.now() - t0).toBeLessThan(3000);
    } finally {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
  });

  test('an unreachable service or a missing build number is reported, never thrown', async () => {
    const failing = { post: async () => { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; throw e; } };
    await expect(sendCiTimings(failing, { project: 'p', version: 'v' }, 'b-7', {})).resolves.toEqual({ stored: false, reason: 'error', detail: 'ECONNREFUSED' });
    await expect(sendCiTimings(failing, { project: 'p', version: 'v' }, undefined, {})).resolves.toEqual({ stored: false, reason: 'no-build-id' });
    await expect(sendCiTimings(failing, { project: 'p', version: 'v' }, '../x', {})).resolves.toEqual({ stored: false, reason: 'no-build-id' });
  });
});

describe('SCRY_CONCURRENCY / SCRY_RENDER_TIMEOUT_MS forwarding', () => {
  const { buildExecutionArgs } = require('../lib/coverage.js');

  test('forwarded to an sbcov that lists the flags', async () => {
    const r = await runDeployerCli({ env: { FAKE_SBCOV_EXECUTION: '1', SCRY_CONCURRENCY: '2', SCRY_RENDER_TIMEOUT_MS: '3000' } });
    expect(r.sbcovArgs).toEqual(expect.arrayContaining(['--concurrency', '2', '--render-timeout', '3000']));
    expect(r.code).toBe(0);
  });

  test('not sent to an older sbcov (it would reject them and capture nothing); the log says they were not applied', async () => {
    const r = await runDeployerCli({ env: { SCRY_CONCURRENCY: '2' } });
    expect(r.sbcovArgs).not.toContain('--concurrency');
    expect(r.out).toContain('The installed scry-sbcov does not support --concurrency, so SCRY_CONCURRENCY /');
    expect(r.code).toBe(0);
  });

  test('bad values are refused before they reach a shell', () => {
    expect(buildExecutionArgs({})).toEqual([]);
    expect(buildExecutionArgs({ concurrency: '4', renderTimeoutMs: 5000 })).toEqual(['--concurrency', '4', '--render-timeout', '5000']);
    expect(() => buildExecutionArgs({ concurrency: '0' })).toThrow(/SCRY_CONCURRENCY/);
    expect(() => buildExecutionArgs({ concurrency: '4; rm -rf /' })).toThrow(/SCRY_CONCURRENCY/);
    expect(() => buildExecutionArgs({ renderTimeoutMs: '5s' })).toThrow(/SCRY_RENDER_TIMEOUT_MS/);
  });
});

describe('execution block fallback', () => {
  test('without an archive the report execution block (sbcov 0.6) still gives concurrency and time lost', () => {
    const { buildPreUploadTimings } = require('../bin/cli.js');
    const block = { durationMs: 700, concurrency: 4, declared: 2, passed: 2, failed: 0, timeouts: 0, notIndexed: 0, timeLostMs: {}, failedTimeShare: 0 };
    const { record } = buildPreUploadTimings({
      coverage: { sbcovWallMs: 1000, executed: true, coverageReport: { execution: { summary: { duration: 700 }, execution: block } } },
      manifest: null,
      archiveMs: 5,
      env: {},
    });
    expect(record).toMatchObject({ executeMs: 700, analyzeMs: 300, concurrency: 4, timeLostMs: {}, failedTimeShare: 0, stories: { declared: 2, passed: 2 } });
  });
});
