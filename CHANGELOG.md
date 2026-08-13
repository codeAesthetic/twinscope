# Changelog

All notable changes to TwinScope. Format follows [Keep a Changelog][kac]; the
project uses [semantic versioning][semver].

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/spec/v2.0.0.html

## Unreleased

## 0.2.2 — 2026-08-13

### Added

- **A `twinscope` command line.** `twinscope before.json after.json` prints what
  changed and exits 0 when the two are the same, 1 when they differ and 2 when
  something went wrong — so it drops into a script or a CI step without parsing
  output. `--json` for a machine-readable result, `--md`, `--html` and `--patch`
  for the same reports the app exports (the same renderers, so the files are
  identical), `--out` to write one, `-` to read a side from stdin, `--repo` to
  compare two git refs, and `-q` to say nothing and rely on the exit code.
  Every engine is the app's: detection picks one the same way, and normalisation
  notes are printed rather than hidden, because "explain what you did" applies to
  a terminal too. Images are PNG-only here — the app decodes whatever the OS can,
  and the CLI says so plainly instead of guessing.

### Fixed

- **A working-tree comparison now includes untracked files.** `git diff` never
  reports them, so a brand-new file was silently missing from "what have I
  changed" — the one case where the answer being wrong looked exactly like the
  answer being right. Ignored files stay ignored, and the notes say when
  untracked files were folded in.
- **An image comparison never reports "0 modified" while pixels differ.** Region
  detection works on a coarse grid, so a very small image, or a difference spread
  too thinly to cluster, could produce a summary that contradicted its own
  percentage.

## 0.2.1 — 2026-08-13

### Added

- **Compare two git refs.** The Git card on the Compare screen opens a repository,
  reads its branches, tags and recent commits, and compares any two of them — or
  either one against the working tree, which is what "what have I changed?" means.
  The result is one row per changed file with git's own line counts, and
  double-clicking a row opens that file's text diff, read straight out of the two
  revisions rather than off disk. Renames are git's, at a similarity threshold you
  can turn off; turning it off re-runs the comparison, so the counts always come
  from git rather than from a filtered view.
  TwinScope shells out to the `git` already on your machine. No git implementation
  is bundled, nothing is downloaded, and the repository is only ever read.
- **The JSON comparison opens side by side**, and switches view the way the text
  one does: side-by-side, unified, inline, tree and raw. Every diff mode draws the
  same structural comparison — the change count never depends on which one you are
  looking at — so side-by-side aligns by path rather than by line, and reformatting
  a file still changes nothing. Raw shows the two documents as they arrived, and
  says so by disabling the filter and the change stepper.

### Fixed

- **⌘\ cycles the view mode.** It was declared, printed in Settings and listened
  for by nothing — the known limit recorded in 0.1.0 below. Both the text and JSON
  views now cycle with it, and the mode survives a normalisation toggle instead of
  snapping back to the default.
- **A history row's star and delete buttons are on the row**, at its right edge on
  hover or focus, rather than stacked underneath it.

## 0.1.0 — 2026-08-13

First release. Drop two things in, get a comparison that explains itself.

### Compare

- **Text and code** — side-by-side, unified and inline, with edited lines paired
  and marked word by word instead of appearing as unrelated deletes and adds.
  Long unchanged runs fold. Virtualised, so a 100k-line pair scrolls.
  **Syntax highlighting** for nine languages, loaded on demand, with changed-word
  marks and search hits staying visible on top of it. **Ignore whitespace**,
  **ignore case** and **collapse unchanged** re-run the comparison, so the counts
  always describe what is on screen.
- **JSON** — a structural tree, not a line diff: reformatting a file changes
  nothing. Arrays match by identity so a reorder does not read as a rewrite,
  objects compare as key sets, and type changes get their own row kind.
- **Folders** — recursive, with per-file status, rename pairing, filters, and
  double-click to open any file pair as its own comparison.
- **Images** — side-by-side, overlay, blink and difference, with changed regions
  boxed and a threshold you can move.
- **Binary files** — a verdict from sizes and a SHA-256, rather than pages of
  mojibake.

### Understand

- Every comparison opens with counts, then the detail.
- Normalisation is explainable and reversible: anything hidden is counted, named,
  and one click from coming back.
- ‹ › and ⌥↑/⌥↓ step through changes from the same index the view uses.
- **Search within a diff (⌘F)** for text and code: a match count, ⏎ / ⇧⏎ to walk
  the hits, Esc to clear. A find, not a filter — nothing is hidden, and a hit
  inside a changed word keeps both highlights.

### Keep

- History in SQLite, searchable and starrable, reopening a comparison by
  re-reading its inputs. **File contents are never stored** — paths, sizes and
  summaries only.
- Preferences persist, including per-engine defaults that seed new comparisons.

### Share

- Self-contained HTML reports (no scripts, no network, print styles), Markdown
  for pull requests, and a unified patch straight to the clipboard.

### Everything else

- ⌘K command palette and a keyboard map generated from one registry, so the
  Settings grid can never describe a key the app does not have.
- Dark and light themes, both first-class.
- **No network calls at runtime, at all.** Nothing leaves the machine.

### Known limits

- **⌘\ (cycle view mode) does not fire.** The shortcut registry declares it and
  the Settings grid prints it, but nothing dispatches or listens for it. Use the
  toolbar control. Every other binding works.
- Syntax highlighting tokenises each row without its neighbours, so an
  unterminated multi-line string colours as if it started on that line.
- Windows and Linux builds exist but are untested on their own platforms.
- The macOS build is unsigned unless you build it with your own Developer ID.
