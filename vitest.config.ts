import { defineConfig } from 'vitest/config';
import WorkerExitReporter from './tests/helpers/workerExitReporter.ts';

const shared = {
  testTimeout: 60_000,
  hookTimeout: 60_000,
};

export default defineConfig({
  test: {
    ...shared,
    // The last one keeps the exit code and the unfinished file when a worker process dies (#108); silent otherwise.
    reporters: [...(process.env['CI'] ? ['default', 'junit'] : ['default']), new WorkerExitReporter()],
    outputFile: { junit: 'reports/junit.xml' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'userscript/**/*.ts'],
      reportsDirectory: 'reports/coverage',
    },
    // Two projects: the userscript suite needs a DOM; everything else runs in node.
    projects: [
      {
        test: {
          ...shared,
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/e2e/**', 'tests/userscript/**', 'node_modules/**'],
        },
      },
      {
        test: {
          ...shared,
          name: 'userscript',
          environment: 'jsdom',
          include: ['tests/userscript/**/*.test.ts'],
        },
      },
    ],
  },
});
