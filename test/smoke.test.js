const { loadConfig } = require('../lib/config.js');

describe('smoke', () => {
  test('loadConfig() returns an object with expected keys', () => {
    const cfg = loadConfig({ dir: './storybook-static', project: 'p', deployVersion: 'v1' });

    expect(cfg).toEqual(
      expect.objectContaining({
        dir: './storybook-static',
        project: 'p',
        version: 'v1',
      })
    );
  });
});
