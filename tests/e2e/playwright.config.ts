import { defineConfig } from '@playwright/test';

/**
 * End-to-end test of the built userscript against a SAVED Akizuki product
 * page and a dataset generated from the real snapshots. No request ever
 * leaves the browser: both origins are served by route interception.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env['CI'] ? [['list'], ['junit', { outputFile: '../../reports/e2e-junit.xml' }]] : [['list']],
  outputDir: '../../test-results/e2e',
  use: {
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
  },
});
