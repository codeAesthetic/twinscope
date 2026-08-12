import { defineConfig } from 'vitest/config';

/**
 * Unit tests only — engines and pure logic (SETUP-5 onward).
 *
 * Anything needing a real window goes through the Playwright harness
 * (`npm run verify`) instead; see CLAUDE.md §3.1.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'out/**'],
  },
});
