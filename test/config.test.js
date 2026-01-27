describe('lib/config coverage env mapping', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();

    delete process.env.SCRY_COVERAGE_ENABLED;
    delete process.env.SCRY_COVERAGE_FAIL_ON_THRESHOLD;
    delete process.env.SCRY_COVERAGE_BASE;
    delete process.env.SCRY_COVERAGE_REPORT;
    delete process.env.SCRY_COVERAGE_PREVIOUS_REPORT;
  });

  function mockNoConfigFile() {
    const realFs = jest.requireActual('fs');

    jest.doMock('fs', () => ({
      ...realFs,
      existsSync: jest.fn((p) => {
        if (typeof p === 'string' && p.endsWith('.storybook-deployer.json')) return false;
        return realFs.existsSync(p);
      }),
      readFileSync: jest.fn((...args) => realFs.readFileSync(...args)),
    }));
  }

  test('coverage defaults to true', () => {
    mockNoConfigFile();
    const { loadConfig } = require('../lib/config.js');

    const cfg = loadConfig({ dir: './storybook-static' });

    expect(cfg.coverage).toBe(true);
    expect(cfg.coverageFailOnThreshold).toBe(false);
    expect(cfg.coverageBase).toBe('main');
  });

  test('SCRY_COVERAGE_ENABLED=false disables coverage', () => {
    mockNoConfigFile();
    process.env.SCRY_COVERAGE_ENABLED = 'false';

    const { loadConfig } = require('../lib/config.js');
    const cfg = loadConfig({ dir: './storybook-static' });

    expect(cfg.coverage).toBe(false);
  });

  test('SCRY_COVERAGE_FAIL_ON_THRESHOLD=true enables fail on threshold', () => {
    mockNoConfigFile();
    process.env.SCRY_COVERAGE_FAIL_ON_THRESHOLD = 'true';

    const { loadConfig } = require('../lib/config.js');
    const cfg = loadConfig({ dir: './storybook-static' });

    expect(cfg.coverageFailOnThreshold).toBe(true);
  });

  test('SCRY_COVERAGE_BASE sets coverageBase', () => {
    mockNoConfigFile();
    process.env.SCRY_COVERAGE_BASE = 'develop';

    const { loadConfig } = require('../lib/config.js');
    const cfg = loadConfig({ dir: './storybook-static' });

    expect(cfg.coverageBase).toBe('develop');
  });

  test('SCRY_COVERAGE_PREVIOUS_REPORT sets previousReport', () => {
    mockNoConfigFile();
    process.env.SCRY_COVERAGE_PREVIOUS_REPORT = '/tmp/prev-report.json';

    const { loadConfig } = require('../lib/config.js');
    const cfg = loadConfig({ dir: './storybook-static' });

    expect(cfg.previousReport).toBe('/tmp/prev-report.json');
  });
});
