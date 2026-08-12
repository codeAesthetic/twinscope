#!/usr/bin/env node
/**
 * MEDIA-1 — captures every screenshot and GIF the documentation site needs, by
 * driving the real app, and converts them into the website repo.
 *
 *   npm run capture                     # everything
 *   npm run capture -- --grep json      # one capture spec
 *   npm run capture -- --stills         # skip the (slow) clips
 *   npm run capture -- --no-build       # reuse out/ as it is
 *   npm run capture -- --dest ../other-site
 *
 * Three stages:
 *
 *  1. build the app, because `e2e/capture/**` drives the built app and a stale
 *     `out/` would photograph the previous version;
 *  2. run the capture specs (their own Playwright config — never part of
 *     `npm run verify` or `npm run gate`, which must stay fast and ffmpeg-free);
 *  3. convert: PNGs down to the size budget, webm clips to GIFs, and the first
 *     frame of every GIF back out as its poster still.
 *
 * Nothing here is committed to this repo: the artifacts land in the *website*
 * repo under `public/media`, and the webm intermediates are deleted.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const MEDIA = join(appRoot, 'e2e', '.artifacts', 'media');
const STILLS = join(MEDIA, 'stills');
const CLIPS = join(MEDIA, 'clips');
const TILES = join(MEDIA, 'tiles');
const SCRATCH = join(MEDIA, 'scratch');

/** Fixed work path used by the capture fixtures — cleaned before every run. */
const WORK_DIR = '/tmp/twinscope-media';

// --- budgets, from the MEDIA-1 brief ---------------------------------------
const STILL_MAX = 300 * 1024;
const GIF_MAX = 2 * 1024 * 1024;
/**
 * What the ladders actually aim at. Encoders are not exactly reproducible across
 * ffmpeg builds, and an asset that lands 1 KB under its limit today is an asset
 * that breaks the budget on someone else's machine.
 */
const SAFETY = 0.95;
const TOTAL_MAX = 30 * 1024 * 1024;
const GIF_WIDTH = 1000;
const GIF_FPS = 12;
const GIF_MAX_SECONDS = 10;

/**
 * Video zero is when Chromium starts capturing, a few hundred milliseconds
 * before the capture spec can observe anything, so a mark is always slightly
 * late. Starting a beat early is the safe direction: each clip holds its opening
 * state still either side of the mark (see `e2e/capture/helpers/clip.ts`).
 */
const CLIP_LEAD_SECONDS = 0.35;

/** The app's --bg token: padding between composited tiles must be invisible. */
const BACKGROUND = '0x07090c';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const options = {
  build: !flag('no-build'),
  stillsOnly: flag('stills'),
  clipsOnly: flag('clips'),
  grep: value('grep'),
  dest: value('dest'),
  keep: flag('keep'),
};

const ffmpeg = findFfmpeg();
const website = resolveWebsite();
const outStills = join(website, 'public', 'media', 'stills');
const outGifs = join(website, 'public', 'media', 'gifs');

function main() {
  console.log(`[media] app     ${appRoot}`);
  console.log(`[media] website ${website}`);
  console.log(`[media] ffmpeg  ${ffmpeg}`);

  if (options.build) {
    console.log('\n[media] building the app…');
    run('npm', ['run', 'build']);
  } else if (!existsSync(join(appRoot, 'out', 'main', 'index.js'))) {
    fail('out/main/index.js is missing — drop --no-build, or run `npm run build`.');
  }

  // A leftover still from a deleted asset would be published forever otherwise.
  for (const dir of [STILLS, CLIPS, TILES, SCRATCH, WORK_DIR]) {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of [STILLS, CLIPS, TILES, SCRATCH, outStills, outGifs]) {
    mkdirSync(dir, { recursive: true });
  }

  console.log('\n[media] capturing…');
  const spec = [];
  if (options.stillsOnly) spec.push('--grep-invert', 'gifs:');
  if (options.clipsOnly) spec.push('--grep', 'gifs:');
  if (options.grep !== undefined) spec.push('--grep', options.grep);
  run('npx', ['playwright', 'test', '--config', 'playwright.capture.config.ts', ...spec]);

  const report = [];

  console.log('\n[media] compositing…');
  compositeImageModes(report);

  console.log('\n[media] optimising stills…');
  for (const file of pngs(STILLS)) {
    report.push(publishStill(join(STILLS, file), basename(file, '.png')));
  }

  console.log('\n[media] converting clips…');
  for (const id of readdirSync(CLIPS).sort()) {
    const dir = join(CLIPS, id);
    if (!statSync(dir).isDirectory()) continue;
    report.push(...publishClip(dir, id));
  }

  if (!options.keep) rmSync(SCRATCH, { recursive: true, force: true });
  summarise(report);
}

// ---------------------------------------------------------------------------
// stills
// ---------------------------------------------------------------------------

/**
 * The still ladder: keep the full 2× resolution as long as it fits the budget,
 * and give up colour depth before giving up pixels — a 256-colour screenshot of
 * a dark UI is indistinguishable at full size, while a downscaled one is visibly
 * softer on text.
 */
const LADDER = [
  { colours: 0 },
  { colours: 256 },
  { colours: 128 },
  { width: 2160, colours: 256 },
  { width: 1600, colours: 256 },
  { width: 1200, colours: 192 },
];

function publishStill(source, id) {
  const target = join(outStills, `${id}.png`);
  let best;

  for (const step of LADDER) {
    const candidate = encodePng(source, id, step);
    if (best === undefined || size(candidate) < size(best.path)) {
      best = { path: candidate, step };
    }
    if (size(candidate) <= STILL_MAX * SAFETY) {
      best = { path: candidate, step };
      break;
    }
  }

  copyFileSync(best.path, target);
  const bytes = size(target);
  const how = [
    best.step.colours === 0 ? 'full colour' : `${best.step.colours} colours`,
    best.step.width === undefined ? '' : `rescaled to ${best.step.width}px`,
  ]
    .filter((part) => part !== '')
    .join(' · ');

  return {
    id,
    kind: 'still',
    bytes,
    limit: STILL_MAX,
    note: `${dimensions(target)} · ${how}`,
  };
}

function encodePng(source, id, { width, colours = 0 }) {
  const scale = width === undefined ? '' : `scale=${width}:-1:flags=lanczos`;
  const out = join(SCRATCH, `${id}-${width ?? 'full'}-${colours}.png`);

  if (colours === 0) {
    const filters = scale === '' ? [] : ['-vf', scale];
    ffmpegRun(['-i', source, ...filters, '-compression_level', '100', out]);
    // Recompressing a Chromium PNG sometimes makes it bigger; keep the smaller.
    if (scale === '' && size(source) < size(out)) copyFileSync(source, out);
    return out;
  }

  const palette = join(SCRATCH, `${id}-palette-${width ?? 'full'}-${colours}.png`);
  const generate = [scale, `palettegen=max_colors=${colours}:stats_mode=full`]
    .filter((part) => part !== '')
    .join(',');
  ffmpegRun(['-i', source, '-vf', generate, palette]);

  const use =
    scale === ''
      ? '[0:v][1:v]paletteuse=dither=none'
      : `[0:v]${scale}[x];[x][1:v]paletteuse=dither=none`;
  ffmpegRun(['-i', source, '-i', palette, '-lavfi', use, '-compression_level', '100', out]);
  return out;
}

/**
 * The four image-viewer modes as one 2×2 still.
 *
 * The tiles are equally wide (each crop includes the full-width toolbar) but not
 * equally tall, because a single-pane mode fits its image larger than the
 * side-by-side one does — so each is padded to the tallest before stacking.
 */
function compositeImageModes(report) {
  const order = ['side-by-side', 'overlay', 'blink', 'difference'];
  const tiles = order.map((mode) => join(TILES, `image-mode-${mode}.png`));
  if (!tiles.every((tile) => existsSync(tile))) {
    console.log('[media] skipping image-four-modes — its tiles were not captured');
    return;
  }

  const sizes = tiles.map((tile) => dimensions(tile).split('×').map(Number));
  const gap = 16;
  const cell = [
    Math.max(...sizes.map(([w]) => w)) + gap,
    Math.max(...sizes.map(([, h]) => h)) + gap,
  ];

  const pads = tiles
    .map(
      (_, index) => `[${index}:v]pad=${cell[0]}:${cell[1]}:${gap}:${gap}:${BACKGROUND}[p${index}]`,
    )
    .join(';');
  const stack =
    '[p0][p1]hstack=inputs=2[top];[p2][p3]hstack=inputs=2[low];[top][low]vstack=inputs=2[out]';
  const composed = join(SCRATCH, 'image-four-modes.png');

  ffmpegRun([
    ...tiles.flatMap((tile) => ['-i', tile]),
    '-filter_complex',
    `${pads};${stack}`,
    '-map',
    '[out]',
    composed,
  ]);

  report.push(publishStill(composed, 'image-four-modes'));
}

// ---------------------------------------------------------------------------
// clips → GIFs
// ---------------------------------------------------------------------------

/**
 * GIF ladder: hold the brief's 1000px and 12fps as long as possible and pay for
 * the budget in colours, which a UI recording barely notices — a 64-colour frame
 * of the diff view is indistinguishable from a 256-colour one at this size.
 * Frame rate goes before width: a smaller GIF is unreadable, a choppier one is
 * merely worse.
 */
const GIF_LADDER = [
  { colours: 256, fps: GIF_FPS, width: GIF_WIDTH },
  { colours: 192, fps: GIF_FPS, width: GIF_WIDTH },
  { colours: 128, fps: GIF_FPS, width: GIF_WIDTH },
  { colours: 96, fps: GIF_FPS, width: GIF_WIDTH },
  { colours: 64, fps: GIF_FPS, width: GIF_WIDTH },
  { colours: 64, fps: 10, width: GIF_WIDTH },
  { colours: 48, fps: 10, width: 900 },
];

function publishClip(dir, id) {
  const webm = join(dir, `${id}.webm`);
  const sidecar = join(dir, `${id}.json`);
  if (!existsSync(webm) || !existsSync(sidecar)) {
    console.log(`[media] skipping ${id} — no webm or sidecar`);
    return [];
  }

  const {
    startMs,
    endMs,
    cropHeight,
    width: videoWidth,
  } = JSON.parse(readFileSync(sidecar, 'utf8'));
  const start = Math.max(0, startMs / 1000 - CLIP_LEAD_SECONDS);
  const duration = Math.min(
    GIF_MAX_SECONDS,
    Math.max(1, (endMs - startMs) / 1000 + CLIP_LEAD_SECONDS),
  );

  const target = join(outGifs, `${id}.gif`);
  let best;

  for (const step of GIF_LADDER) {
    const candidate = encodeGif(webm, id, { start, duration, cropHeight, videoWidth, ...step });
    if (best === undefined || size(candidate) < size(best.path)) best = { path: candidate, step };
    if (size(candidate) <= GIF_MAX * SAFETY) {
      best = { path: candidate, step };
      break;
    }
  }

  copyFileSync(best.path, target);

  // The poster the documentation page shows before the GIF plays has to be the
  // GIF's own first frame, or the picture changes when it starts.
  const poster = join(SCRATCH, `${id}-poster.png`);
  ffmpegRun(['-i', target, '-frames:v', '1', poster]);

  const { step } = best;
  return [
    {
      id,
      kind: 'gif',
      bytes: size(target),
      limit: GIF_MAX,
      note:
        `${dimensions(target)} · ${duration.toFixed(1)}s · ${step.fps}fps · ` +
        `${step.colours} colours`,
    },
    publishStill(poster, id),
  ];
}

function encodeGif(webm, id, { start, duration, cropHeight, videoWidth, colours, fps, width }) {
  // Cropping the status bar away drops the live "Compared in N ms" — the one
  // pixel in the app that differs between two identical runs.
  const chain = [
    `crop=${videoWidth}:${cropHeight}:0:0`,
    `fps=${fps}`,
    `scale=${width}:-1:flags=lanczos`,
  ].join(',');

  const palette = join(SCRATCH, `${id}-gifpal-${colours}-${fps}-${width}.png`);
  const trim = ['-ss', String(start), '-t', String(duration)];

  ffmpegRun([
    ...trim,
    '-i',
    webm,
    '-vf',
    `${chain},palettegen=max_colors=${colours}:stats_mode=full`,
    palette,
  ]);

  const gif = join(SCRATCH, `${id}-${colours}-${fps}-${width}.gif`);
  ffmpegRun([
    ...trim,
    '-i',
    webm,
    '-i',
    palette,
    '-lavfi',
    // No dithering: on near-black UI panels a bayer pattern reads as coloured
    // speckle, and it costs size too — every dithered pixel is a pixel that
    // changed between frames, which is exactly what a GIF pays for.
    `${chain}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`,
    '-loop',
    '0',
    gif,
  ]);
  return gif;
}

// ---------------------------------------------------------------------------
// plumbing
// ---------------------------------------------------------------------------

function summarise(report) {
  const rows = report.sort((a, b) => a.id.localeCompare(b.id));
  const width = Math.max(...rows.map((row) => row.id.length), 4);
  const over = rows.filter((row) => row.bytes > row.limit);

  console.log(`\n${'asset'.padEnd(width)}  kind   size      detail`);
  for (const row of rows) {
    const mark = row.bytes > row.limit ? ' ← OVER BUDGET' : '';
    console.log(
      `${row.id.padEnd(width)}  ${row.kind.padEnd(5)}  ${kb(row.bytes).padStart(8)}  ${row.note}${mark}`,
    );
  }

  const total = directoryBytes(join(website, 'public', 'media'));
  console.log(`\n[media] ${rows.length} assets · public/media is ${kb(total)} of ${kb(TOTAL_MAX)}`);
  if (over.length > 0) console.log(`[media] over budget: ${over.map((row) => row.id).join(', ')}`);
  if (total > TOTAL_MAX) console.log('[media] public/media is over its 30 MB budget');

  const webms = readdirSync(join(website, 'public', 'media'), { recursive: true }).filter((file) =>
    String(file).endsWith('.webm'),
  );
  if (webms.length > 0) fail(`a .webm reached the website repo: ${webms.join(', ')}`);
}

function resolveWebsite() {
  const candidate = resolve(
    appRoot,
    options.dest ?? process.env['TWINSCOPE_WEBSITE'] ?? '../twinscope-website',
  );
  if (!existsSync(join(candidate, 'package.json'))) {
    fail(
      `no website repo at ${candidate}\n` + '        pass --dest <path> or set TWINSCOPE_WEBSITE.',
    );
  }
  return candidate;
}

function findFfmpeg() {
  const candidates = [process.env['FFMPEG'], '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  for (const candidate of candidates) {
    if (candidate !== undefined && existsSync(candidate)) return candidate;
  }
  const found = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' });
  if (found.status === 0) return found.stdout.trim();
  fail('ffmpeg is required (brew install ffmpeg), or set FFMPEG=<path>.');
}

function ffmpegRun(ffmpegArgs) {
  execFileSync(ffmpeg, ['-y', '-v', 'error', ...ffmpegArgs], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function dimensions(file) {
  const probe = execFileSync(
    ffmpeg.replace(/ffmpeg$/, 'ffprobe'),
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0:s=x',
      file,
    ],
    { encoding: 'utf8' },
  );
  return probe.trim().replace(/x/g, '×').split('\n')[0];
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: appRoot, stdio: 'inherit' });
  if (result.status !== 0) fail(`${command} ${commandArgs.join(' ')} failed`);
}

function pngs(dir) {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith('.png'))
        .sort()
    : [];
}

function size(file) {
  return statSync(file).size;
}

function directoryBytes(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((total, entry) => total + size(join(entry.parentPath, entry.name)), 0);
}

function kb(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

function fail(message) {
  console.error(`[media] ${message}`);
  process.exit(1);
}

// Kept last: `main` reads consts declared further down this file.
main();
