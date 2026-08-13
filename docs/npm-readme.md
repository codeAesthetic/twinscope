# twinscope

**Compare anything. Understand what changed.**

Drop two things in and TwinScope works out what they are, then picks the comparison that
answers the question — a structural tree for JSON, a page-by-page diff for PDFs, pixels
for images, a table for CSV, packages for a lockfile.

This package is the command line. There is also a
[desktop app](https://github.com/codeAesthetic/twinscope/releases/latest).

```bash
npx twinscope before.json after.json
```

Or install it:

```bash
npm install -g twinscope
```

## What it compares

It detects the type; you do not pick an engine.

|                        |                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------- |
| **Text and code**      | Lines paired and marked word by word, not deleted-and-added                       |
| **Large text**         | Files too big to hold in memory — anchored, then diffed in the gaps               |
| **JSON · YAML · XML**  | Structural, so reformatting changes nothing. Anchors and merge keys resolved      |
| **CSV / TSV**          | A grid, with cell-level changes and rows paired on a key                          |
| **Dependencies**       | `package.json` and lockfiles: bumps by severity, licence changes, what left       |
| **API**                | Two OpenAPI documents (which changes break callers) or two HAR captures           |
| **Config**             | `.env`, Kubernetes manifests, Terraform plans — **with secrets masked**           |
| **Web pages**          | Two saved pages: structure, styles, assets and accessibility                      |
| **PDF**                | Pages paired by their _content_, so an inserted page shifts nothing after it      |
| **Images**             | A pixel comparison with changed regions boxed                                     |
| **Screenshot sets**    | Two directories, worst-first, for visual regression in CI                         |
| **Folders · git refs** | Recursive with rename detection; any two refs, or a ref against your working tree |
| **Binaries**           | A verdict from size and SHA-256, rather than pages of mojibake                    |

## In CI

Exit code is the contract: **0** identical, **1** different, **2** could not compare.

```bash
twinscope api/openapi.json build/openapi.json --fail-on-breaking
twinscope baseline/ screenshots/ --engine visual --max-diff 0.1
twinscope --repo . main HEAD --max-changes 400
```

A threshold takes over exit 1: without one it means "these differ", with one it means
"these differ by more than you allowed". A threshold that cannot be evaluated **fails**,
because a silently-passing gate is worse than none. `--github` writes Actions annotations
and a job summary; there is a composite action and a worked workflow in
[docs/ci.md](https://github.com/codeAesthetic/twinscope/blob/main/docs/ci.md).

## Reports

```bash
twinscope before.ts after.ts --html --out report.html   # self-contained, no scripts
twinscope before.ts after.ts --md                       # for a pull request
twinscope before.ts after.ts --patch                    # a unified diff
twinscope before.ts after.ts --json                     # machine-readable
```

## It makes no network calls

Not one — no telemetry, no analytics, no update check, no fetching of the things you
compare. Everything happens on your machine. (The desktop app has a single opt-in update
check, off by default; this binary has none at all.)

Two limits worth knowing, both reported by the tool rather than hidden: PDF pages are
compared as **text**, since rendering them needs a rasteriser this does not carry, and
image comparison here decodes **PNG only**.

## Requirements

Node 22.12 or newer. No native modules, no post-install step, no `node_modules` beside
the binary — it is a single bundled file plus the pdfjs worker.

`twinscope --help` lists every engine and flag.

MIT licensed. Source, issues and the desktop app:
[github.com/codeAesthetic/twinscope](https://github.com/codeAesthetic/twinscope)
