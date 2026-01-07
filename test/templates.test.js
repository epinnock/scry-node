describe('lib/templates workflow generation', () => {
  test('generateMainWorkflow() includes fetch-depth and coverage flags', () => {
    const { generateMainWorkflow } = require('../lib/templates.js');

    const yml = generateMainWorkflow('p', 'https://api', 'pnpm', 'build-storybook');

    expect(yml).toContain('fetch-depth: 0');
    expect(yml).toContain('SCRY_COVERAGE_ENABLED');
    expect(yml).toContain('--coverage-fail-on-threshold');
    expect(yml).toContain('GITHUB_TOKEN');
  });

  test('generatePRWorkflow() includes draft optimization and no github-script comment step', () => {
    const { generatePRWorkflow } = require('../lib/templates.js');

    const yml = generatePRWorkflow('p', 'https://api', 'pnpm', 'build-storybook');

    expect(yml).toContain('fetch-depth: 0');
    expect(yml).toContain('github.event.pull_request.draft');
    expect(yml).toContain('--coverage-fail-on-threshold');
    expect(yml).toContain('GITHUB_TOKEN');

    // Commenting is now handled by the CLI
    expect(yml).not.toContain('actions/github-script');
  });
});
