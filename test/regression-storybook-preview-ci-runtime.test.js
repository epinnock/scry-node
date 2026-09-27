// regression-storybook-preview-ci-runtime (ISSUES.md #54,
// scry-management/features/storybook-preview-ci-runtime).
//
// The symptom on the deployer side: a dashboard PR preview spent 19-21 minutes
// executing stories and the run said nothing about it. No line gave the
// execution time, nothing compared it with a budget, and the upload carried no
// timing, so the build document could not record how much CI time Scry took.
//
// Driven through the real CLI (child process, local stub upload service, fake
// scry-sbcov 0.6 that reports its execution time), with a budget small enough
// that the run is over it.
const { runDeployerCli } = require('./helpers/runDeployerCli.js');

jest.setTimeout(30000);

const GITHUB_ENV = {
  GITHUB_ACTIONS: 'true',
  GITHUB_RUN_ID: '18123456789',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_WORKFLOW: 'Deploy Storybook PR Preview',
  GITHUB_JOB: 'deploy-preview',
  RUNNER_ENVIRONMENT: 'github-hosted',
};

describe('regression-storybook-preview-ci-runtime', () => {
  test('a run over its execute budget says so, and the upload carries its CI timings', async () => {
    const r = await runDeployerCli({
      sbcovMode: 'ok',
      env: {
        ...GITHUB_ENV,
        FAKE_SBCOV_EXECUTION: '1',
        FAKE_SBCOV_EXECUTE_MS: '60',
        FAKE_SBCOV_SLEEP_MS: '150',
        SCRY_EXECUTE_BUDGET_BASE_S: '0',
        SCRY_EXECUTE_BUDGET_PER_STORY_S: '0.001',
      },
    });

    // The person reading the run sees the execution time and the budget.
    expect(r.out).toMatch(/Story execution: 3 stories in 60 ms \(4 workers\), budget 3 ms/);
    expect(r.out).toMatch(/^::warning title=Scry story execution over budget::/m);

    // The build request carries the pre-upload timings...
    const presign = r.requests.find((q) => q.method === 'POST' && q.path.startsWith('/presigned-url/'));
    expect(presign.json.ciTimings).toMatchObject({ executeMs: 60, executeSource: 'sbcov', budgetMs: 3, overBudget: true });

    // ...and the final record goes to the ci-timings route.
    const final = r.requests.find((q) => q.method === 'POST' && /\/builds\/stub-build\/ci-timings$/.test(q.path));
    expect(final).toBeDefined();
    expect(final.json.ciTimings.deployerTotalMs).toBeGreaterThan(0);

    // A slow run is information, not a broken build.
    expect(r.code).toBe(0);
  });
});
