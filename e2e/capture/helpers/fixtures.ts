import {
  cpSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { boxes, encodePng, type Box, type Rgba } from './png';

/**
 * Inputs for the media captures — pinned, so a capture never changes because the
 * fixture did.
 *
 * Two rules here matter:
 *
 *  1. **Every fixture is stored with a trailing `.txt`** (`client.ts.txt`,
 *     `package.json.txt`) and the suffix is stripped when it is copied out.
 *     Fixtures live under `e2e/`, which `tsconfig.e2e.json` compiles and eslint
 *     and prettier both walk — a fixture named `client.ts` would be typechecked
 *     against imports that do not exist. The app only ever sees the stripped
 *     name, which is what detection and the language picker read.
 *
 *  2. **The work directory is a fixed, neutral path**, because it is *visible*
 *     in the captures: the folder view prints its roots and the titlebar prints
 *     file names. A `mkdtemp` path would put a fresh random id and the user's
 *     name into every screenshot.
 */

/** Fixed on purpose — see rule 2 above. */
export const WORK_DIR = '/tmp/twinscope-media';

const FIXTURES_DIR = resolve(__dirname, '..', 'fixtures');

/** An empty, freshly created work directory: captures must not see leftovers. */
export function freshWorkDir(name: string): string {
  const dir = join(WORK_DIR, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Copies `fixtures/<rel>` (stored as `<rel>.txt`) into `dir`, unsuffixed. */
export function copyFixture(rel: string, dir: string): string {
  const target = join(dir, basename(rel));
  cpSync(join(FIXTURES_DIR, `${rel}.txt`), target);
  return target;
}

/** Copies a whole fixture tree, stripping `.txt` from every file in it. */
export function copyFixtureTree(rel: string, dir: string): string {
  const target = join(dir, basename(rel));
  cpSync(join(FIXTURES_DIR, rel), target, { recursive: true });
  unsuffix(target);
  return target;
}

function unsuffix(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      unsuffix(full);
    } else if (entry.endsWith('.txt')) {
      renameSync(full, join(dir, stripTxt(entry)));
    }
  }
}

function stripTxt(name: string): string {
  return name.endsWith('.txt') ? name.slice(0, -4) : name;
}

// ---------------------------------------------------------------------------
// Generated fixtures. Pinned drawings and pinned pseudo-random bytes: same code,
// same bytes, every run.
// ---------------------------------------------------------------------------

const INK = {
  bg: [14, 17, 23, 255] as Rgba,
  panel: [22, 27, 34, 255] as Rgba,
  line: [48, 54, 61, 255] as Rgba,
  text: [110, 118, 129, 255] as Rgba,
  accent: [110, 168, 255, 255] as Rgba,
  warn: [227, 179, 65, 255] as Rgba,
  good: [63, 185, 80, 255] as Rgba,
};

const IMAGE_WIDTH = 960;
const IMAGE_HEIGHT = 600;

/**
 * A pair of "design screenshots": the same dashboard mockup with three changes —
 * a recoloured card accent, a moved header badge and a taller chart bar. Three
 * separated changes cluster into three regions, which is what the region list
 * and the boxes on the stage are there to show.
 */
function dashboard(version: 1 | 2): Buffer {
  const badgeX = version === 1 ? 800 : 856;
  const cardAccent = version === 1 ? INK.accent : INK.warn;
  const barHeight = version === 1 ? 60 : 132;

  const list: Box[] = [
    // header
    { x: 0, y: 0, w: IMAGE_WIDTH, h: 56, fill: INK.panel },
    { x: 24, y: 20, w: 148, h: 16, fill: INK.text },
    { x: badgeX, y: 18, w: 80, h: 20, fill: INK.good },
    // sidebar
    { x: 0, y: 56, w: 200, h: IMAGE_HEIGHT - 56, fill: INK.panel },
    ...[0, 1, 2, 3, 4].map((row) => ({
      x: 24,
      y: 92 + row * 40,
      w: 140,
      h: 12,
      fill: INK.line,
    })),
    // three cards
    ...[232, 480, 728].map((x) => ({ x, y: 96, w: 200, h: 132, fill: INK.panel })),
    { x: 232, y: 96, w: 200, h: 6, fill: INK.accent },
    { x: 480, y: 96, w: 200, h: 6, fill: cardAccent },
    { x: 728, y: 96, w: 200, h: 6, fill: INK.accent },
    ...[232, 480, 728].map((x) => ({ x: x + 20, y: 132, w: 120, h: 14, fill: INK.text })),
    ...[232, 480, 728].map((x) => ({ x: x + 20, y: 172, w: 72, h: 26, fill: INK.line })),
    // chart
    { x: 232, y: 268, w: 696, h: 252, fill: INK.panel },
    ...[0, 1, 2, 3, 4, 5].map((bar) => {
      const heights = [88, 132, barHeight, 176, 104, 148];
      const h = heights[bar] as number;
      return { x: 272 + bar * 108, y: 480 - h, w: 64, h, fill: INK.accent };
    }),
  ];

  return encodePng(IMAGE_WIDTH, IMAGE_HEIGHT, boxes(INK.bg, list));
}

export interface Pair {
  before: string;
  after: string;
}

export function imagePair(dir: string): Pair {
  const before = join(dir, 'home-v1.png');
  const after = join(dir, 'home-v2.png');
  writeFileSync(before, dashboard(1));
  writeFileSync(after, dashboard(2));
  return { before, after };
}

/**
 * Two directories of "screenshots" for the visual engine (v0.3.5): one real
 * regression, one byte-identical shot, one changed by less than the per-image
 * budget allows.
 *
 * Shared by the two stills that describe this engine — the app's refusal
 * (`visual.capture.ts`) and the terminal slide (`cli.capture.ts`) — precisely so
 * they describe the *same* pair. The refusal names `baseline/ current/` and the
 * slide reports what comparing those two actually produced; if each built its
 * own fixture, the page would show a command beside numbers that never came
 * from it.
 */
const SHOT = { width: 640, height: 400 };

interface ShotVariant {
  /** The primary button's fill and left edge — the big regression. */
  button: Rgba;
  buttonX: number;
  /** A 14×14 status dot: 196 of 256 000 pixels, under the 0.1% per-image budget. */
  dot: Rgba;
}

function appScreen({ button, buttonX, dot }: ShotVariant): Buffer {
  const list: Box[] = [
    { x: 0, y: 0, w: SHOT.width, h: 44, fill: INK.panel },
    { x: 20, y: 16, w: 120, h: 12, fill: INK.text },
    { x: 0, y: 44, w: 150, h: SHOT.height - 44, fill: INK.panel },
    ...[0, 1, 2, 3].map((row) => ({ x: 18, y: 70 + row * 30, w: 110, h: 10, fill: INK.line })),
    { x: 174, y: 76, w: 420, h: 150, fill: INK.panel },
    { x: 194, y: 96, w: 180, h: 14, fill: INK.text },
    ...[0, 1, 2].map((row) => ({ x: 194, y: 126 + row * 20, w: 340, h: 10, fill: INK.line })),
    { x: 194, y: 196, w: 14, h: 14, fill: dot },
    { x: buttonX, y: 250, w: 130, h: 34, fill: button },
    { x: 400, y: 250, w: 110, h: 34, fill: INK.line },
  ];
  return encodePng(SHOT.width, SHOT.height, boxes(INK.bg, list));
}

const STEADY: ShotVariant = { button: INK.accent, buttonX: 194, dot: INK.good };

export function screenshotSets(dir: string): Pair {
  const before = join(dir, 'baseline');
  const after = join(dir, 'current');
  mkdirSync(before, { recursive: true });
  mkdirSync(after, { recursive: true });

  const pairs: Array<[string, ShotVariant, ShotVariant]> = [
    // A recoloured, moved primary button: a few thousand pixels, and a real regression.
    ['checkout.png', STEADY, { button: INK.warn, buttonX: 240, dot: INK.good }],
    // Byte-identical, which is what most of a real suite looks like.
    ['settings.png', STEADY, STEADY],
    // 196 pixels — under the per-image budget on purpose, because anti-aliasing moves
    // a handful of pixels on every run and zero is the wrong number to gate on.
    ['sign-in.png', STEADY, { ...STEADY, dot: INK.warn }],
  ];

  for (const [name, one, other] of pairs) {
    writeFileSync(join(before, name), appScreen(one));
    writeFileSync(join(after, name), appScreen(other));
  }

  return { before, after };
}

/** A pinned linear-congruential stream: binary-looking bytes, NULs included. */
function pseudoBytes(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1_103_515_245 + 12_345) & 0x7fffffff;
    out[index] = index % 64 === 0 ? 0 : (state >>> 16) & 0xff;
  }
  return out;
}

export function binaryPair(dir: string): Pair {
  const before = join(dir, 'twinscope-1.4.2.bin');
  const after = join(dir, 'twinscope-2.0.0.bin');
  writeFileSync(before, pseudoBytes(48_128, 7));
  writeFileSync(after, pseudoBytes(51_712, 11));
  return { before, after };
}

/**
 * Two big log files whose every line differs by its status code.
 *
 * Their only job is to make a comparison take long enough that the progress
 * state can be photographed. Size alone does not do it — the line diff finds a
 * mostly-identical pair almost instantly. What costs time is *pairing* and
 * marking tens of thousands of modified lines, which is the work the engine does
 * while it is reporting 45%.
 *
 * Kept under the 10 MB heavy-input confirmation so the run is one click.
 */
export function largeLogPair(dir: string): Pair {
  const before = join(dir, 'access-2026-03-03.log');
  const after = join(dir, 'access-2026-03-04.log');

  const line = (index: number, status: number): string =>
    `10.0.${index % 251}.${(index * 7) % 251} - [0${index % 10}:12:${index % 60}] ` +
    `"GET /v1/users/${index}" ${status} ${1200 + (index % 900)}`;

  const rows = 60_000;
  const a: string[] = [];
  const b: string[] = [];
  for (let index = 0; index < rows; index += 1) {
    a.push(line(index, 200));
    b.push(line(index, index % 3 === 0 ? 503 : 204));
  }
  writeFileSync(before, `${a.join('\n')}\n`);
  writeFileSync(after, `${b.join('\n')}\n`);
  return { before, after };
}
