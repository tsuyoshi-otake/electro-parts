// Mutation testing of the store-neutral core: change-point history, price
// normalization, statistics, sanity checks and the identity rules. Adapters,
// collectors and the userscript UI are covered by example / E2E tests instead;
// mutating them mostly measures fixture coverage, not logic.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
    // All node-project tests: the core is exercised through adapters, the DB
    // and the publisher as much as through its own unit tests.
    related: false,
    dir: 'tests',
  },
  mutate: [
    'src/core/history.ts',
    'src/core/price.ts',
    'src/core/stats.ts',
    'src/core/sanity.ts',
    'src/core/identity.ts',
    'src/core/time.ts',
  ],
  checkers: [],
  ignoreStatic: true,
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/report.json' },
  thresholds: { high: 90, low: 75, break: 70 },
  timeoutMS: 30_000,
  concurrency: 4,
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
};
