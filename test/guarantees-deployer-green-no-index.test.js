// Guarantees for ISSUES.md #50 (scry-management/features/deployer-green-no-index/plan.md).
// Each test drives the bad path through the real CLI (child process, local stub
// upload service, fake scry-sbcov) and asserts what the person running CI sees:
// the exit code, the line in the log, and whether a build was queued.
// G5 (the main-build-indexed synthetic) lives in scry-management/synthetics.
const { runDeployerCli } = require('./helpers/runDeployerCli.js');
const templates = require('../lib/templates.js');

jest.setTimeout(30000);

describe('deployer-green-no-index guarantees', () => {
  // G1. A deploy asked to index whose metadata upload fails can never end green.
  test('guarantee-1-failed-metadata-upload-ends-red', async () => {
    const r = await runDeployerCli({ sbcovMode: 'ok', metadata: 'reject' });

    expect(r.sentMetadata).toBe(true);
    expect(r.hostedStorybook).toBe(true);
    expect(r.out).toContain('The metadata upload failed (metadata store unavailable (stub)), so NOTHING WILL BE INDEXED.');
    expect(r.out).toContain('The Storybook is hosted and browsable');
    expect(r.out).not.toContain('queued, not finished');
    expect(r.out).not.toContain('Deployment successful');
    expect(r.code).toBe(1);
  });

  // G2. A deploy that captured no stories never queues an empty build and never ends green.
  test('guarantee-2-empty-archive-not-queued-ends-red', async () => {
    const r = await runDeployerCli({ sbcovMode: 'empty', metadata: 'ok' });

    expect(r.hostedStorybook).toBe(true); // D1: host it, end red
    expect(r.sentMetadata).toBe(false);
    expect(r.out).toContain('Analysis captured 0 of 3 stories, so NOTHING WILL BE INDEXED.');
    expect(r.out).toContain("First capture error: button--primary: browserType.launch: Executable doesn't exist");
    expect(r.out).toContain('The empty archive was not uploaded and no build was queued.');
    expect(r.code).toBe(1);
  });

  // G3. The generated workflow installs the browser the analyzer looks for, and
  // runs a deployer that has these checks, whatever the repo pins.
  describe('guarantee-3-template-own-browser-and-floor', () => {
    const cases = [];
    for (const gen of ['generateMainWorkflow', 'generatePRWorkflow']) {
      for (const pm of ['npm', 'pnpm', 'yarn', 'bun']) cases.push([gen, pm]);
    }

    test.each(cases)('%s (%s)', (gen, pm) => {
      const yml = templates[gen]('p', 'https://api', pm, 'build-storybook');

      const install = yml.indexOf('npm i --no-save --no-audit --no-fund --ignore-scripts --prefix "$RUNNER_TEMP/scry" @scrymore/scry-deployer@' + templates.DEPLOYER_RANGE);
      const browser = yml.indexOf('npx --no-install playwright install --with-deps chromium-headless-shell');
      const deploy = yml.indexOf('"$RUNNER_TEMP/scry/node_modules/.bin/scry-deployer" \\');

      // deployer first, then its own Playwright's browser, then that deployer
      expect(install).toBeGreaterThan(-1);
      expect(browser).toBeGreaterThan(install);
      expect(deploy).toBeGreaterThan(browser);

      // the browser step runs inside the deployer's folder, so npx resolves its Playwright
      const browserStep = yml.slice(yml.lastIndexOf('- name:', browser), browser);
      expect(browserStep).toContain('working-directory: ${{ runner.temp }}/scry');

      // exactly one browser install, and no way for the repo to choose the deployer
      expect(yml.match(/playwright install/g)).toHaveLength(1);
      expect(yml).not.toMatch(/npx (--yes )?@scrymore\/scry-deployer/);
      expect(yml).not.toMatch(/npx (--yes )?(scry-deployer|storybook-deploy)\b/);
      expect(yml).not.toMatch(/(pnpm|yarn) dlx/);
      expect(yml).toContain('--with-analysis');
    });

    test('the PR workflow skips drafts and cancels a superseded run for the same PR', () => {
      const yml = templates.generatePRWorkflow('p', 'https://api', 'npm', 'build-storybook');
      expect(yml).toContain('group: storybook-pr-${{ github.event.pull_request.number }}');
      expect(yml).toContain('cancel-in-progress: true');
      expect(yml).toContain('if: github.event.pull_request.draft == false');
      expect(yml).toContain('types: [opened, synchronize, reopened, ready_for_review]');
    });
  });

  // G4. A deploy indexes unless someone explicitly opted out, and an opted-out
  // deploy says in its log that nothing will be searchable.
  describe('guarantee-4-analysis-default-or-says-not-searchable', () => {
    test('no analysis flag: analysis runs and the build is queued', async () => {
      const r = await runDeployerCli({ sbcovMode: 'ok', metadata: 'ok' });

      expect(r.sbcovArgs).toEqual(expect.arrayContaining(['--screenshots', '--output-zip']));
      expect(r.sentMetadata).toBe(true);
      expect(r.out).toContain('Analysis archive holds 3 captured stories.');
      expect(r.out).toContain('queued, not finished');
      expect(r.code).toBe(0);
    });

    // Review finding 1: the example config shipped "withAnalysis": false, so
    // copying it opted out without anyone choosing to.
    test('a project that copied .storybook-deployer.example.json still indexes', async () => {
      const example = require('fs').readFileSync(require('path').join(__dirname, '..', '.storybook-deployer.example.json'), 'utf8');
      const r = await runDeployerCli({ sbcovMode: 'ok', configFile: example });

      expect(r.sbcovArgs).toEqual(expect.arrayContaining(['--screenshots']));
      expect(r.sentMetadata).toBe(true);
      expect(r.code).toBe(0);
    });

    test('--no-analysis: hosted, exit 0, and the log says NOT searchable', async () => {
      const r = await runDeployerCli({ args: ['--no-analysis'], sbcovMode: 'ok', metadata: 'ok' });

      expect(r.sbcovArgs).not.toContain('--screenshots');
      expect(r.hostedStorybook).toBe(true);
      expect(r.sentMetadata).toBe(false);
      expect(r.out).toContain('Analysis skipped (--no-analysis): this build is hosted but NOT searchable.');
      expect(r.code).toBe(0);
    });
  });
});
