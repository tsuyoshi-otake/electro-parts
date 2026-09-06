import { defineConfig } from 'vitest/config';

const shared = {
  testTimeout: 60_000,
  hookTimeout: 60_000,
};

export default defineConfig({
  test: {
    ...shared,
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
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
