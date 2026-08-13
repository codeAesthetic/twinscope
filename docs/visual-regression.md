# Visual regression with TwinScope (v0.3.5)

Point TwinScope at two directories of screenshots and it tells you which ones moved, by
how much, and gives a build one number to gate on:

```bash
twinscope baseline/ current/ --engine visual --max-diff 0.1
```

- exit `0` — no screenshot differs by more than 0.1% of its pixels;
- exit `1` — at least one does, and the output names it;
- exit `2` — something went wrong.

Screenshots pair on their **path relative to the folder you gave**, so
`baseline/pages/checkout.png` compares against `current/pages/checkout.png` however deep
the tree is, and a shot present on one side only is reported as added or removed rather
than as a difference.

## Why `--engine visual` and not just two folders

Two folders of screenshots and two folders of source code look identical from outside, so
TwinScope does not guess: a plain `twinscope baseline/ current/` runs the folder engine
(fast, hashes, finds renames) and `--engine visual` decodes every pair. Naming it is one
word and saves decoding a repository by accident.

## The two thresholds, and why neither is zero

| Option                                        | Default | What it means                                               |
| --------------------------------------------- | ------- | ----------------------------------------------------------- |
| `--engine visual` + engine option `threshold` | `0.1`   | how different one _pixel_ has to be to count                |
| engine option `perImagePercent`               | `0.1`   | what share of an image may differ before it is a regression |
| `--max-diff <percent>`                        | —       | the **build gate**: no image may differ by more than this   |

Zero is the wrong default for a real suite. Font rasterisation, anti-aliasing and GPU
compositing move a handful of pixels between two runs on the same machine, and a suite
that goes red on that gets switched off within a week. The defaults are deliberately
forgiving and the gate is yours to tighten.

## Producing the baselines

TwinScope compares directories of images; it does not take screenshots. Whatever your
runner already writes is what you compare — there is no adapter to install, and no
TwinScope-shaped config for your test suite.

### Playwright

```ts
// playwright.config.ts
export default {
  use: { screenshot: 'off' },
  outputDir: 'artefacts',
};
```

```ts
// somewhere in a test
await page.screenshot({ path: `shots/${testInfo.title}.png`, fullPage: true });
```

Then compare `shots/` against a `baseline/` directory committed to the repository (or
downloaded as an artifact from the last green run on `main`).

Playwright's own `toHaveScreenshot()` keeps its baselines in
`tests/__screenshots__/<project>/…` — point TwinScope at that directory to review a whole
update at once instead of one failure at a time.

### Cypress

`cy.screenshot()` writes to `cypress/screenshots/`. That directory is the "current" side;
the baseline is a copy of it from a known-good run.

### Storybook

`@storybook/test-runner` with a snapshot step, or `storycap`, writes one PNG per story:

```bash
npx storycap http://localhost:6006 --outDir shots
twinscope baseline/ shots/ --engine visual --max-diff 0.1 --github
```

## Accepting a new baseline

Copy the new set over the old one:

```bash
rsync -a --delete current/ baseline/
```

TwinScope deliberately has **no `--accept` flag**. It is a comparison tool: a diff that
can also overwrite one of its inputs is one keystroke away from destroying the evidence,
and "which of these 40 changes did I mean to accept" is a question a `cp` cannot answer
either — review the report first, then copy. The report is worth keeping:

```bash
twinscope baseline/ current/ --engine visual --html --out visual-report.html
```

## In CI

The action from [ci.md](ci.md) works unchanged — `engine: visual` and `max-diff` are
inputs:

```yaml
- uses: ./tools/twinscope/integrations/github-action
  with:
    before: baseline
    after: shots
    engine: visual
    max-diff: '0.1'
    report: visual-report.html
```

The job summary lists the worst offenders first, which is the order you want to read them
in.

## Known limits, stated

- **The CLI decodes PNG only** (v0.2.2's `pngjs` adapter). JPEG, WebP and AVIF
  screenshots compare in the desktop app, where Chromium's decoder is available; a
  headless run needs PNGs. Every unreadable pair is listed with its reason rather than
  failing the run.
- **The desktop app cannot run this engine.** It needs to list directories _and_ decode
  images; the window can do the second and the engine worker the first. In the app, compare
  the two folders and drill into a pair — the same pixels, one at a time.
- **Images over 2000px on the longest side are scaled down** before comparison, as
  everywhere else in TwinScope. A 4K screenshot pair is compared at 2000px.
- **A run is capped at 2000 screenshots**, and says how many it left out.
