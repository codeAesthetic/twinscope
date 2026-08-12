import { defineConfig } from '@playwright/test';

/**
 * Playwright here is a *verification harness*, not a maintained E2E suite: it
 * lets a session boot the real Electron app, drive it and screenshot it, so a
 * feature claim can be checked instead of assumed. See e2e/verify.spec.ts.
 *
 * `testDir` + `testMatch` are load-bearing — without them Playwright scans the
 * whole repo and tries to run vitest unit tests, which fails confusingly.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,

  // Electron launches a real app: one instance at a time, no parallelism.
  workers: 1,
  fullyParallel: false,
  retries: 0,

  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [['list']],
  outputDir: './e2e/.artifacts/test-output',

  use: { trace: 'off', video: 'off', screenshot: 'off' },
});
