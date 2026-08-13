#!/usr/bin/env node
/**
 * Stages the `twinscope` CLI as a publishable npm package.
 *
 * The root manifest describes the **Electron app**: it is `private: true`, its `main`
 * points at `out/main`, and it lists twelve runtime dependencies. Publishing it would
 * make `npm i -g twinscope` install React, shiki and pdfjs for nothing — the CLI bundle
 * already contains all of them (`vite.cli.config.ts` sets `ssr.noExternal`). So this
 * writes a *purpose-built* manifest into a staging directory instead of adding a second
 * package to the repo, which keeps D31 intact: there is still one package here.
 *
 *   node scripts/pack-cli.mjs            # stage into out/npm
 *   node scripts/pack-cli.mjs --pack     # …and build the tarball
 *
 * Publishing is deliberately NOT part of this: it is an owner action with credentials,
 * and it happens from the staged directory (see docs/release.md).
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = join(root, 'out', 'npm');
const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const entry = join(root, 'out', 'cli', 'index.js');
if (!existsSync(entry)) {
  console.error('No out/cli/index.js — run `npm run build` first.');
  process.exit(1);
}

// The pdfjs worker is loaded by *relative* import from the pdf chunk, so its absence is
// not a missing nicety but a crash on any .pdf pair. Assert it rather than trust it.
const worker = join(root, 'out', 'cli', 'assets', 'pdf.worker.mjs');
if (!existsSync(worker)) {
  console.error('No out/cli/assets/pdf.worker.mjs — the CLI build did not copy it.');
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// Everything the binary needs, and nothing else.
cpSync(join(root, 'out', 'cli'), join(stage, 'bin'), { recursive: true });
copyFileSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
copyFileSync(join(root, 'docs', 'npm-readme.md'), join(stage, 'README.md'));

const manifest = {
  name: 'twinscope',
  version: app.version,
  description:
    'Compare anything from the command line — text, JSON, YAML, XML, CSV, PDFs, images, folders, git refs, API contracts, .env and Kubernetes config, and screenshot sets. Detects the type and picks the right engine.',
  keywords: [
    'diff',
    'diff-tool',
    'compare',
    'json-diff',
    'yaml-diff',
    'xml-diff',
    'csv-diff',
    'pdf-diff',
    'image-diff',
    'visual-regression',
    'openapi',
    'cli',
  ],
  homepage: 'https://codeaesthetic.github.io/twinscope-website/',
  bugs: { url: 'https://github.com/codeAesthetic/twinscope/issues' },
  repository: { type: 'git', url: 'git+https://github.com/codeAesthetic/twinscope.git' },
  license: app.license,
  author: app.author,
  // Node 22 is the build target (`vite.cli.config.ts`) and is verified by
  // `scripts/pack-cli.mjs --pack`, which runs the packed binary on it.
  engines: { node: '>=22.12.0' },
  // Everything is bundled. A dependency here would be a lie about what is loaded.
  dependencies: {},
  bin: { twinscope: 'bin/index.js' },
  files: ['bin/', 'README.md', 'LICENSE'],
};

writeFileSync(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`staged ${manifest.name}@${manifest.version} → ${stage}`);

if (process.argv.includes('--pack')) {
  const output = execFileSync('npm', ['pack', '--json'], { cwd: stage, encoding: 'utf8' });
  const [packed] = JSON.parse(output);
  console.log(
    `packed ${packed.filename} — ${(packed.size / 1024 / 1024).toFixed(1)} MB, ` +
      `${packed.entryCount} files, unpacked ${(packed.unpackedSize / 1024 / 1024).toFixed(1)} MB`,
  );
}
