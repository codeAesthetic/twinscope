import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { freshWorkDir, screenshotSets } from './helpers/fixtures';
import { DEVICE_SCALE_FACTOR, STILLS_DIR } from './helpers/stage';

/**
 * MEDIA-1: the visual engine where it actually runs — a terminal (v0.3.5).
 *
 * Its sibling `visual.capture.ts` photographs the app declining, which is honest
 * but only half the answer: a reader who has just been told "run it from the
 * command line" has still never seen what that produces. This is the other half,
 * over the *same* two folders (`screenshotSets`), so the command in one picture
 * and the numbers in the other come from one comparison.
 *
 * Nothing here is typed by hand. The spec **spawns the built binary** and renders
 * whatever came back on stdout; if the CLI stops printing what this claims, the
 * assertions below fail rather than the caption quietly going stale. That is the
 * same rule the app captures follow — drive the real thing, photograph the result
 * — applied to the one surface that has no window.
 *
 * Two things are pinned, both for determinism (§3.2):
 *
 *  1. **The duration is substituted.** `Visual regression · 24 ms` is the CLI's
 *     "Compared in N ms", and it is the one token that cannot repeat. A comparison
 *     still crops it out of frame; a block of text cannot crop, so it is replaced
 *     with a fixed number and this comment is the disclosure. It is the only edit
 *     made to the output, and `RAW_ONLY` asserts nothing else moved.
 *  2. **Colour is asked for rather than detected.** The CLI colours for a TTY, and
 *     a spawned pipe is not one, so `--color` (added with this capture) says so
 *     explicitly instead of the capture faking a terminal around the process.
 *
 * The ANSI is then parsed, not approximated: each escape run becomes a span, and
 * the four colours map onto the app's own tokens so the slide belongs beside the
 * other assets rather than looking like a screenshot of somebody's terminal theme.
 */

const appRoot = resolve(__dirname, '..', '..');
const CLI = join(appRoot, 'out', 'cli', 'index.js');

/** The command as a reader would type it, and as the app's refusal prints it. */
const COMMAND = 'twinscope baseline/ current/ --engine visual';

/** Pinned in place of the real duration — see note 1 in the header. */
const FIXED_MS = '24 ms';

/**
 * Lines that must survive verbatim from the binary to the picture. The duration
 * is the only substitution; if anything else in the output changes, the still is
 * describing a CLI that no longer exists and this is what says so.
 */
const RAW_ONLY = [
  'baseline → current',
  '+0 added  -0 removed  ~2 modified',
  'images: 3',
  'worst difference: 2.34%',
  'over budget: 1',
  'Compared 3 screenshots by relative path.',
];

interface Span {
  text: string;
  tone: 'plain' | 'dim' | 'bold' | 'add' | 'del' | 'mod' | 'acc';
}

/** SGR code → the app token that carries the same meaning. */
const TONE: Record<string, Span['tone']> = {
  '0': 'plain',
  '1': 'bold',
  '2': 'dim',
  '31': 'del',
  '32': 'add',
  '33': 'mod',
  '36': 'acc',
};

/**
 * The escape byte, and a hand-written scanner rather than a regular expression.
 *
 * `no-control-regex` rejects a control character in a regex — including one
 * written as `\u001b` inside `new RegExp`, since eslint evaluates the string. The
 * repo's own rule offers the way out: "write escapes, or write a loop." This is
 * the loop, and it costs nothing, because the ANSI the CLI emits is a single
 * shape (`ESC[<digits>m`) rather than the general grammar a regex would imply.
 */
const ESC = 27;

interface Parsed {
  /** One entry per output line, each already split into coloured runs. */
  lines: Span[][];
  /** How many escapes were seen. Zero means colour never arrived at all. */
  escapes: number;
  /** The same text with every escape removed — what a pipe would have got. */
  plain: string;
}

/**
 * Splits the CLI's output into lines of coloured spans.
 *
 * The CLI wraps each coloured run in its own `ESC[..m … ESC[0m` (see `painter`),
 * so a single active tone is all this has to track — no stack, and no attempt at
 * a general terminal emulator, which would be a lie about how much of one is
 * needed here.
 */
function parseAnsi(text: string): Parsed {
  const lines: Span[][] = [];
  const plain: string[] = [];
  let spans: Span[] = [];
  let buffer = '';
  let tone: Span['tone'] = 'plain';
  let escapes = 0;

  const flush = (): void => {
    if (buffer !== '') spans.push({ text: buffer, tone });
    buffer = '';
  };

  for (let at = 0; at < text.length; at += 1) {
    const char = text[at] as string;

    if (char.charCodeAt(0) === ESC && text[at + 1] === '[') {
      let cursor = at + 2;
      let code = '';
      while (cursor < text.length && text[cursor] !== 'm') {
        code += text[cursor] as string;
        cursor += 1;
      }
      flush();
      tone = TONE[code] ?? 'plain';
      escapes += 1;
      at = cursor;
      continue;
    }

    if (char === '\n') {
      flush();
      lines.push(spans);
      spans = [];
      plain.push('\n');
      continue;
    }

    buffer += char;
    plain.push(char);
  }

  flush();
  if (spans.length > 0) lines.push(spans);
  return { lines, escapes, plain: plain.join('') };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A terminal, drawn in the app's own palette.
 *
 * Deliberately *not* app chrome: this is the one asset on the page that is not a
 * picture of TwinScope's window, and dressing it as one would make a reader think
 * the engine runs there after all — the exact confusion the refusal exists to
 * prevent. Traffic-light dots and a prompt say "terminal" in one glance.
 */
function terminalHtml(lines: Span[][]): string {
  const body = lines
    .map((spans) =>
      spans.length === 0
        ? '<span class="ln"> </span>'
        : `<span class="ln">${spans
            .map((span) => `<i class="${span.tone}">${escapeHtml(span.text)}</i>`)
            .join('')}</span>`,
    )
    // No separator: `.ln` is already a block, and under `pre-wrap` a newline
    // *between* two blocks is a second line break — every row would be double
    // spaced, which is how the first render of this slide came out.
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root {
    --bg: #07090c; --bg-2: #0a0d12; --line: #1e2530;
    --tx-1: #e6e9ef; --tx-2: #98a2b3; --tx-3: #68727f;
    --acc: #7c6cff; --add: #3fb950; --del: #f8574f; --mod: #e3b341;
    --mono: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--tx-2);
    /* An integer line box, not a ratio: 13 × 1.65 is 21.45px, and a fractional
       row height makes the clip fractional, which resamples the shot. */
    font-family: var(--mono); font-size: 13px; line-height: 22px;
    display: flex; align-items: center; justify-content: center; padding: 28px;
  }
  .term { width: 100%; border: 1px solid var(--line); border-radius: 10px;
          background: var(--bg-2); overflow: hidden; }
  .bar { display: flex; align-items: center; gap: 7px;
         padding: 10px 14px; border-bottom: 1px solid var(--line); }
  .dot { width: 11px; height: 11px; border-radius: 50%; background: var(--line); }
  .title { margin-left: 8px; color: var(--tx-3); font-size: 11.5px; letter-spacing: 0.04em; }
  /* pre-WRAP, because a terminal wraps: the engine's notes are two sentences
     long and a real 129-column window folds them exactly here. Clipping them at
     the frame instead would publish a sentence that stops mid-word. */
  .out { display: block; padding: 16px 18px 20px; white-space: pre-wrap; }
  .ln { display: block; min-height: 22px; }
  .prompt { display: block; margin-bottom: 6px; }
  .prompt .sig { color: var(--add); }
  .prompt .cmd { color: var(--tx-1); }
  i { font-style: normal; }
  .plain { color: var(--tx-2); }
  .dim   { color: var(--tx-3); }
  .bold  { color: var(--tx-1); font-weight: 600; }
  .add   { color: var(--add); }
  .del   { color: var(--del); }
  .mod   { color: var(--mod); }
  .acc   { color: var(--acc); }
</style></head>
<body><div class="term">
  <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
    <span class="title">zsh — twinscope</span></div>
  <code class="out"><span class="prompt"><i class="sig">$ </i><i class="cmd">${escapeHtml(
    COMMAND,
  )}</i></span>${body}</code>
</div></body></html>`;
}

test('stills: the visual engine in the terminal, where it runs', async () => {
  const dir = freshWorkDir('visual-cli');
  const { before, after } = screenshotSets(dir);

  // The real binary, over the real folders. `--engine visual` because detection
  // will not choose it, and `--color` because a pipe is not a terminal.
  //
  // Exit 1 is the CLI saying "they differ" — its documented second meaning, not a
  // failure — so the status is read rather than allowed to throw.
  let stdout: string;
  let status = 0;
  try {
    stdout = execFileSync(process.execPath, [CLI, before, after, '--engine', 'visual', '--color'], {
      encoding: 'utf8',
      cwd: dir,
    });
  } catch (cause) {
    const error = cause as { status?: number; stdout?: string };
    status = error.status ?? -1;
    stdout = error.stdout ?? '';
  }

  expect(status, 'two folders that differ is exit 1, not a crash').toBe(1);
  expect(stdout, 'the CLI must have been built — run `npm run build`').not.toBe('');

  // The one substitution, applied before parsing, and it must actually have found
  // something to replace — a silent no-op here would pin nothing.
  expect(stdout).toMatch(/· \d+ ms/);
  const pinned = stdout.replace(/· \d+ ms/g, `· ${FIXED_MS}`).replace(/\n+$/, '');

  const { lines, escapes, plain } = parseAnsi(pinned);

  // Colour was asked for and must have been given, or the slide is monochrome and
  // `--color` has silently stopped working.
  expect(escapes, 'the CLI emitted no ANSI — did --color stop working?').toBeGreaterThan(0);
  for (const line of RAW_ONLY) expect(plain).toContain(line);

  const page = join(dir, 'terminal.html');
  writeFileSync(page, terminalHtml(lines));

  const browser = await chromium.launch();
  try {
    const view = await browser.newPage({
      // Narrower than the app stills on purpose: a terminal that spans 1440px is a
      // terminal nobody has. The height is the content's, not a fixed frame.
      viewport: { width: 1100, height: 620 },
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      colorScheme: 'dark',
    });
    await view.goto(`file://${page}`);

    const terminal = view.locator('.term');
    await expect(terminal).toBeVisible();
    await expect(terminal).toContainText(COMMAND);
    // The counts must have arrived as colour, not as grey text: this is the whole
    // reason the slide is a picture rather than a code block.
    await expect(terminal.locator('i.add').first()).toContainText('+0 added');
    await expect(terminal.locator('i.mod').first()).toContainText('~2 modified');

    // Integers only, for the reason `unionClip` gives in stage.ts: a half-pixel
    // clip resamples the shot and softens every glyph in it.
    const box = await terminal.boundingBox();
    expect(box, 'the terminal must have a box to clip to').not.toBeNull();
    const clip = {
      x: Math.floor(box!.x),
      y: Math.floor(box!.y),
      width: Math.ceil(box!.width),
      height: Math.ceil(box!.height),
    };

    mkdirSync(STILLS_DIR, { recursive: true });
    await view.screenshot({
      path: join(STILLS_DIR, 'visual-cli.png'),
      clip,
      animations: 'disabled',
      caret: 'hide',
      scale: 'device',
    });
    console.log('[capture] still visual-cli — real CLI output, rendered in chromium');
  } finally {
    await browser.close();
  }
});
