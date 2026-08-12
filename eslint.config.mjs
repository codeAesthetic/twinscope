import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Flat config. The rules that matter most here are the import boundaries at the
 * bottom — they are the architecture, enforced mechanically rather than by
 * memory (see CLAUDE.md §4).
 */
export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'out/',
      'dist/',
      'release/',
      'e2e/.artifacts/',
      'test-results/',
      'playwright-report/',
      'reference/',
      'coverage/',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always'],
      // TypeScript already catches undefined identifiers, and does it better.
      'no-undef': 'off',
    },
  },

  // --- Renderer: React rules, and NO access to node or Electron. ---
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'os', 'child_process', 'electron'],
              message:
                'The renderer must not touch node or Electron. Go through the preload bridge (window.devdiff).',
            },
          ],
        },
      ],
    },
  },

  // --- Engines: pure logic. No Electron, so the CLI can reuse them (V1-2). ---
  {
    files: ['src/engines/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron'],
              message:
                'Engines must stay host-agnostic. Filesystem access is injected via EngineCtx.fs.',
            },
          ],
        },
      ],
    },
  },

  // --- Main/preload: console is the log surface here. ---
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'e2e/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },

  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },

  // The harness fixture is intentionally CommonJS so it can launch without a
  // build step (see e2e/fixtures/harness-app/main.cjs).
  {
    files: ['**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  prettier,
);
