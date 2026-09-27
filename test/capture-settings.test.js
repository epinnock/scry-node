const fs = require('fs');
const path = require('path');

// capture-provenance PR F1: the deployer forwards a project's screenshot
// capture settings to scry-sbcov, and forwards nothing it was not given so
// sbcov's own defaults and scry-sbcov.config.* keep applying (guarantee G6).

describe('buildCaptureArgs', () => {
  const { buildCaptureArgs } = require('../lib/coverage.js');

  test('forwards nothing when no capture setting is set', () => {
    expect(buildCaptureArgs()).toEqual([]);
    expect(buildCaptureArgs({})).toEqual([]);
    expect(buildCaptureArgs({ captureMode: '', captureScale: null, captureViewport: undefined })).toEqual([]);
  });

  test('maps each setting to its sbcov flag', () => {
    expect(buildCaptureArgs({ captureMode: 'viewport', captureScale: 1, captureViewport: '390x844' })).toEqual([
      '--capture-mode', 'viewport',
      '--capture-scale', '1',
      '--capture-viewport', '390x844',
    ]);
    expect(buildCaptureArgs({ captureMode: 'root' })).toEqual(['--capture-mode', 'root']);
    expect(buildCaptureArgs({ captureScale: '1.5' })).toEqual(['--capture-scale', '1.5']);
    expect(buildCaptureArgs({ captureViewport: { width: 1280, height: 720 } })).toEqual(['--capture-viewport', '1280x720']);
    expect(buildCaptureArgs({ captureViewport: ' 800 X 600 ' })).toEqual(['--capture-viewport', '800x600']);
  });

  test.each([
    [{ captureMode: 'element' }, /captureMode/],
    [{ captureMode: 'root; rm -rf /' }, /captureMode/],
    [{ captureMode: ['root'] }, /captureMode/],
    [{ captureScale: 0 }, /captureScale/],
    [{ captureScale: 5 }, /captureScale/],
    [{ captureScale: '-1' }, /captureScale/],
    [{ captureScale: '2 --ci' }, /captureScale/],
    [{ captureScale: '1e1' }, /captureScale/],
    [{ captureScale: 'NaN' }, /captureScale/],
    [{ captureViewport: '390' }, /captureViewport/],
    [{ captureViewport: '390x844$(id)' }, /captureViewport/],
    [{ captureViewport: { width: 1.5, height: 2 } }, /captureViewport/],
    [{ captureViewport: { width: 0, height: 720 } }, /captureViewport/],
  ])('rejects %j', (settings, pattern) => {
    expect(() => buildCaptureArgs(settings)).toThrow(pattern);
  });
});

describe('runCoverageAnalysis capture forwarding', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  function setup() {
    jest.resetModules();
    const execSync = jest.fn();
    jest.doMock('child_process', () => ({ execSync }));
    const fixedNow = 1234567899;
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
    const outPath = path.join(process.cwd(), `.scry-coverage-report-${fixedNow}.json`);
    execSync.mockImplementation(() => {
      fs.writeFileSync(outPath, JSON.stringify({ summary: { metrics: {}, health: {} }, qualityGate: {}, generatedAt: 'x' }));
    });
    const { runCoverageAnalysis } = require('../lib/coverage.js');
    return { execSync, runCoverageAnalysis };
  }

  test('appends the capture flags to the sbcov command', async () => {
    const { execSync, runCoverageAnalysis } = setup();
    await runCoverageAnalysis({
      storybookDir: './storybook-static',
      screenshots: true,
      captureMode: 'viewport',
      captureScale: '1',
      captureViewport: '1280x720',
    });
    const cmd = execSync.mock.calls.map((c) => c[0]).find((c) => !/ --help$/.test(c));
    expect(cmd).toMatch(/ --capture-mode viewport --capture-scale 1 --capture-viewport 1280x720$/);
  });

  test('passes no capture flag when the project set none, leaving sbcov defaults in charge', async () => {
    const { execSync, runCoverageAnalysis } = setup();
    await runCoverageAnalysis({ storybookDir: './storybook-static', screenshots: true });
    expect(execSync.mock.calls.map((c) => c[0]).find((c) => !/ --help$/.test(c))).not.toContain('--capture-');
  });

  test('throws on an invalid setting before running anything, even with failOnThreshold=false', async () => {
    const { execSync, runCoverageAnalysis } = setup();
    await expect(
      runCoverageAnalysis({ storybookDir: './storybook-static', captureMode: 'viewport && echo pwned' })
    ).rejects.toThrow(/captureMode/);
    expect(execSync).not.toHaveBeenCalled();
  });
});

describe('capture settings from project config', () => {
  const ENV = ['SCRY_CAPTURE_MODE', 'SCRY_CAPTURE_SCALE', 'SCRY_CAPTURE_VIEWPORT', 'STORYBOOK_DEPLOYER_CAPTURE_MODE'];
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    for (const k of ENV) delete process.env[k];
  });

  function mockConfigFile(content) {
    const realFs = jest.requireActual('fs');
    jest.doMock('fs', () => ({
      ...realFs,
      existsSync: jest.fn((p) => {
        if (typeof p === 'string' && p.endsWith('.storybook-deployer.json')) return content !== null;
        return realFs.existsSync(p);
      }),
      readFileSync: jest.fn((p, ...rest) => {
        if (typeof p === 'string' && p.endsWith('.storybook-deployer.json')) return JSON.stringify(content);
        return realFs.readFileSync(p, ...rest);
      }),
    }));
  }

  test('reads captureMode / captureScale / captureViewport from .storybook-deployer.json', () => {
    mockConfigFile({ captureMode: 'viewport', captureScale: 1, captureViewport: { width: 390, height: 844 } });
    const { loadConfig } = require('../lib/config.js');
    const cfg = loadConfig({ dir: './storybook-static' });
    expect(cfg.captureMode).toBe('viewport');
    expect(cfg.captureScale).toBe(1);
    expect(cfg.captureViewport).toEqual({ width: 390, height: 844 });
  });

  test('leaves them unset by default, so nothing is forwarded', () => {
    mockConfigFile(null);
    const { loadConfig } = require('../lib/config.js');
    const cfg = loadConfig({ dir: './storybook-static' });
    expect(cfg.captureMode).toBeUndefined();
    expect(cfg.captureScale).toBeUndefined();
    expect(cfg.captureViewport).toBeUndefined();
  });

  test('SCRY_CAPTURE_* env vars override the file; CLI args override both', () => {
    mockConfigFile({ captureMode: 'viewport', captureScale: 1 });
    process.env.SCRY_CAPTURE_MODE = 'root';
    process.env.SCRY_CAPTURE_SCALE = '2';
    process.env.SCRY_CAPTURE_VIEWPORT = '800x600';
    const { loadConfig } = require('../lib/config.js');
    expect(loadConfig({ dir: 'x' })).toMatchObject({ captureMode: 'root', captureScale: '2', captureViewport: '800x600' });
    expect(loadConfig({ dir: 'x', captureMode: 'viewport' }).captureMode).toBe('viewport');
  });
});

describe('resolveCoverage forwards capture settings', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('passes argv capture settings to runCoverageAnalysis', async () => {
    const runCoverageAnalysis = jest.fn(async () => ({ report: null, metadataZipPath: null }));
    jest.doMock('../lib/coverage.js', () => ({
      runCoverageAnalysis,
      loadCoverageReport: jest.fn(),
      extractCoverageSummary: jest.fn(() => null),
    }));
    const { resolveCoverage } = require('../bin/cli.js');
    const logger = { info: jest.fn(), debug: jest.fn(), success: jest.fn(), error: jest.fn() };
    await resolveCoverage(
      { coverage: true, dir: './storybook-static', withAnalysis: true, captureMode: 'viewport', captureScale: '1', captureViewport: '390x844' },
      logger
    );
    expect(runCoverageAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ captureMode: 'viewport', captureScale: '1', captureViewport: '390x844', screenshots: true })
    );
  });
});
