/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  verbose: true,
  testMatch: ['**/test/**/*.test.js'],

  // Focus coverage enforcement on the deploy + coverage feature surface.
  // The repo contains older modules without tests yet.
  collectCoverageFrom: [
    'bin/cli.js',
    'lib/apiClient.js',
    'lib/config.js',
    'lib/coverage.js',
    'lib/pr-comment.js',
    'lib/templates.js',
  ],

  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],

  coverageThreshold: {
    // Global threshold applies to the focused set in `collectCoverageFrom`.
    global: {
      branches: 25,
      functions: 50,
      lines: 50,
      statements: 50,
    },

    // Enforce higher coverage on the new/critical modules.
    './lib/coverage.js': {
      branches: 60,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    './lib/pr-comment.js': {
      branches: 70,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
