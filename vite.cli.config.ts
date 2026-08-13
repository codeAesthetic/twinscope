import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The CLI build (v0.2.2) — a fourth output alongside electron-vite's three.
 *
 * Its own config rather than a fourth entry in `electron.vite.config.ts`, because
 * electron-vite's `main`/`preload`/`renderer` sections each carry Electron
 * assumptions this output must not inherit: `externalizeDepsPlugin` would leave
 * `require('pngjs')` in the bundle, and the target would be Electron's Node rather
 * than the user's.
 *
 * Everything is bundled, `pngjs` included, so `out/cli/index.js` runs from
 * anywhere with no `node_modules` beside it.
 */

const version = (
  JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

export default defineConfig({
  define: {
    // Read at build time: a bundled file has no reliable way to find its own
    // package.json once it is installed globally or copied out of the tree.
    __TWINSCOPE_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: 'out/cli',
    emptyOutDir: true,
    // Not `lib` mode: this is a program, not a library, and lib mode would add
    // an `exports` shim that a shebang file has no use for.
    ssr: resolve(__dirname, 'src/cli/index.ts'),
    target: 'node22',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'index.js',
        // The shebang has to be the first bytes of the file, which is the one
        // thing a bundler will not do for you.
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: {
    // Bundle every dependency. The default externalises them, which would make
    // the binary depend on a node_modules tree next to it.
    noExternal: true,
    target: 'node',
  },
});
