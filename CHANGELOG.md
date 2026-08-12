# Changelog

All notable changes to TwinScope. Format follows [Keep a Changelog][kac]; the
project uses [semantic versioning][semver].

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/spec/v2.0.0.html

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
