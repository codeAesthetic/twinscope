import { defineConfig } from '@playwright/test';

/**
 * The media capture harness (MEDIA-1) — deliberately a *separate* config from
 * `playwright.config.ts`.
 *
 * Captures are slow, need ffmpeg, and write outside the repo, so they must never
 * run as part of `npm run verify` or `npm run gate`. Keeping them in their own
 * config with their own `testMatch` (`*.capture.ts`, not `*.spec.ts`) is what
 * guarantees that: the default config's `testMatch` cannot see these files, and
 * this config's cannot see the regression suite.
 *
 * Run it through `npm run capture`, which builds first and converts afterwards.
 */
export default defineConfig({
  testDir: './e2e/capture',
  testMatch: /.*\.capture\.ts$/,

  // One real Electron app at a time, same as the regression suite.
  workers: 1,
  fullyParallel: false,
  retries: 0,

  // A GIF spec spends most of its time deliberately waiting, and every spec
  // boots the app; 60s is not enough here.
  timeout: 240_000,
  expect: { timeout: 20_000 },

  reporter: [['list']],
  outputDir: './e2e/.artifacts/media/test-output',

  use: { trace: 'off', video: 'off', screenshot: 'off' },
});
