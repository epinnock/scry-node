describe('lib/templates workflow generation', () => {
  test('generateMainWorkflow() includes fetch-depth and coverage flags', () => {
    const { generateMainWorkflow } = require('../lib/templates.js');

    const yml = generateMainWorkflow('p', 'https://api', 'pnpm', 'build-storybook');

    expect(yml).toContain('fetch-depth: 0');
    expect(yml).toContain('SCRY_COVERAGE_ENABLED');
    expect(yml).toContain('--coverage-fail-on-threshold');
    expect(yml).toContain('GITHUB_TOKEN');
  });

  test('generatePRWorkflow() skips drafts and has no github-script comment step', () => {
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

describe('workflow template snapshots and reference copies (ISSUES.md #50)', () => {
  const { generateMainWorkflow, generatePRWorkflow } = require('../lib/templates.js');

  test.each(['npm', 'pnpm', 'yarn'])('main workflow for %s matches the snapshot', (pm) => {
    expect(generateMainWorkflow('', '', pm, 'build-storybook')).toMatchSnapshot();
  });

  test.each(['npm', 'pnpm', 'yarn'])('PR workflow for %s matches the snapshot', (pm) => {
    expect(generatePRWorkflow('', '', pm, 'build-storybook')).toMatchSnapshot();
  });

  // The copies in templates/workflows went stale once (no browser step, bare
  // npx) while the generator moved on. They are now generated; this fails
  // when they drift. Fix with: node scripts/regenerate-workflow-templates.js
  test('templates/workflows/*.yml match the generator', () => {
    const fs = require('fs');
    const path = require('path');
    const { files, dir } = require('../scripts/regenerate-workflow-templates.js');
    for (const [name, body] of Object.entries(files)) {
      expect(fs.readFileSync(path.join(dir, name), 'utf8')).toBe(body);
    }
    const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith('.yml')).sort();
    expect(onDisk).toEqual(Object.keys(files).sort());
  });
});
