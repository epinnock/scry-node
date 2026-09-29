'use strict';

const js = require('@eslint/js');
const sonarjs = require('eslint-plugin-sonarjs');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'lib/vendor/scf/**',
      'coverage/**',
      'test/fixtures/**',
      // Pre-existing, out of capture-sources' scope: its own inline `// eslint-disable-next-line
      // import/no-dynamic-require, global-require` references a plugin (eslint-plugin-import)
      // this repo has never installed, which ESLint treats as a hard "rule not found" error that
      // no rule-severity setting can downgrade to a warning. Excluded rather than edited, per
      // this pass's scope (fix only capture-sources' own files; record everything else's count).
      'lib/pr-comment.js',
    ],
  },
  js.configs.recommended,
  sonarjs.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    // Pre-existing, out of capture-sources' scope: despite the .cjs extension this script is
    // actually ESM (top-level import/export) — a real bug in the file (Node would refuse to run
    // it as-is), but not one this pass fixes. Parsed as a module purely so lint can see it at
    // all, instead of a fatal parse error blocking `eslint .` for the whole repo.
    files: ['newscripts/generate-presigned-url.cjs'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  {
    // Mechanical fallback (ledger F13): lint was fully unconfigured before this pass, and fixing
    // every finding outside capture-sources' own files (PRs #70/#71) is out of this pass's scope.
    // Every rule left blocking below has at least one finding in a pre-existing, untouched file;
    // downgrading it to "warn" here does not affect capture-sources' own files, which are already
    // 0-findings clean against the full "error" severity. `no-unused-vars` and `no-useless-escape`
    // are included alongside the sonarjs/* rules (not just sonarjs/*) because js.configs.recommended
    // — also newly wired in by this pass — produced pre-existing findings for them too; leaving
    // them at "error" would keep `eslint . --max-warnings <N>` red regardless of N, since
    // --max-warnings only budgets warnings, never errors.
    rules: {
      // Only the rules "recommended" actually turns on (severity "error"); its many "off"
      // entries must stay off, not be dragged up to "warn" by a blind key rename.
      ...Object.fromEntries(
        Object.entries(sonarjs.configs.recommended.rules)
          .filter(([, severity]) => (Array.isArray(severity) ? severity[0] : severity) === 'error')
          .map(([rule]) => [rule, 'warn'])
      ),
      'no-unused-vars': 'warn',
      'no-useless-escape': 'warn',
    },
  },
];
