import { defineConfig, type Plugin } from 'vite';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
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

/**
 * pdfjs loads its worker by *relative import*, so the file has to sit beside the
 * chunk that asks for it.
 *
 * In the packaged app `pdfjs-dist` stays external and is required from
 * `node_modules`, where `pdf.mjs` and `pdf.worker.mjs` are siblings — so the
 * import resolves and nobody notices. Here `ssr.noExternal` bundles pdfjs into
 * `out/cli/assets/pdf-<hash>.js`, which then resolved `./pdf.worker.mjs` against
 * that directory and found nothing: comparing two PDFs from the command line died
 * with "Setting up fake worker failed", an unhandled rejection rather than a
 * refusal. Copying the worker next to the chunk is the whole fix.
 *
 * `engine-worker/pdfHost.ts` runs the worker module in-process (a utilityProcess
 * cannot construct a real Worker), so this is loaded, not spawned.
 */
function pdfWorkerAsset(): Plugin {
  return {
    name: 'twinscope:pdf-worker-asset',
    // `writeBundle` rather than `closeBundle`: the output directory certainly
    // exists by then, and this must not run for a `--watch` rebuild that wrote
    // nothing.
    writeBundle(options) {
      const dir = options.dir ?? resolve(__dirname, 'out/cli');
      const target = resolve(dir, 'assets');
      mkdirSync(target, { recursive: true });
      copyFileSync(
        resolve(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
        resolve(target, 'pdf.worker.mjs'),
      );
    },
  };
}

export default defineConfig({
  plugins: [pdfWorkerAsset()],
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
