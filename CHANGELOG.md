# Changelog

All notable changes to TwinScope. Format follows [Keep a Changelog][kac]; the
project uses [semantic versioning][semver].

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/spec/v2.0.0.html

## Unreleased

## 0.2.11 — 2026-08-13

### Added

- **Renames and moves are found properly now.** A file that moved to another folder
  is one rename instead of a deletion plus an addition — the commonest rename there
  is, and the old rule could not see it at all, because it required the same folder
  _and_ the same byte count. A file that was renamed _and_ edited is found too, by
  comparing sampled chunks of its content.
- **The note carries a score**: `renamed from src/deep/config.ts (100%)`, so a
  confident match and a marginal one look different. 100% means byte-identical.
- Two files too small for their content to mean anything are judged on their names
  alone — at 27 bytes, two unrelated one-line modules genuinely look 60% alike.
- On a very large pair of trees, scoring every candidate would be quadratic, so it
  falls back to the old cheap rule and says that it did.

## 0.2.7 — 2026-08-13

### Added

- **The Diff Radar.** Six axes — Structure, Content, Visual, Metadata, Deps, Weight —
  giving the shape of a change at a glance, from a Radar button beside the counts.
  Every score comes from a number the engine already worked out, and clicking an axis
  says what it means.
- **An axis nothing could measure is drawn hollow and named**, not plotted at zero.
  A comparison of two images has nothing to say about licences, and "we did not
  measure this" is a different statement from "nothing changed here" — the chart says
  which. Identical inputs get no radar at all rather than a ring of zeroes.

## 0.2.10 — 2026-08-13

Built before 0.2.7 on purpose: the Diff Radar's Dependencies axis needs this data
to be honest, and the plan says not to ship it otherwise.

### Added

- **Dependency comparison.** Two `package.json` files now answer the question you
  actually asked — which packages were added, removed, or moved, and how far —
  instead of showing you that a string changed from `^4.17.20` to `^4.18.0`. Every
  change is sized (major, minor, patch, or just a pinned range), and a version that
  moved _down_ is flagged as the rollback it is.
- **Lockfiles too**, for npm, pnpm and yarn: resolved versions rather than ranges,
  a count of every transitive package, and — for npm lockfiles, the only kind that
  records them — licence changes. A "needs a look" filter shows just the major
  bumps, downgrades and licence changes.
- TwinScope will not read the lockfile sitting next to a manifest, because that
  would mean giving a comparison access to whole directories rather than the two
  files you chose. Pick the two lockfiles instead; the app says so when it matters,
  and says what a manifest pair cannot tell you.

## 0.2.6 — 2026-08-13

### Added

- **Ignore the noise: one set of rules, in every engine.** A panel beside the diff
  turns off the differences that are never the point — regenerated UUIDs, build
  timestamps, content hashes — plus tolerances (two timestamps within a minute, two
  numbers within 0.01) and up to eight custom regexes of your own. Two runs of the
  same generator can now compare as identical.
  The rules work _inside_ a value, not only on a whole one, so an id embedded in a
  log line or an error message is masked while the rest of the line still compares.
  The same rules apply to text, JSON, YAML, XML and CSV, because they are literally
  the same rules.
- Every rule that fires is named and counted. Turning a rule on re-runs the
  comparison, so the counts always come from the engine rather than from a filtered
  view, and turning it off brings the difference straight back.

### Fixed

- **A context row now shows both sides when they are not identical.** A line that
  paired only because normalisation hid the difference — with "ignore case", or with
  any of the new rules — used to display the AFTER text on both sides. Normalisation
  changes what is _compared_, never what is _displayed_.

## 0.2.5 — 2026-08-13

### Added

- **CSV and TSV comparison, as a table.** A grid with a sticky header and a
  row-number gutter, so you can see which record changed in each file and which
  _cell_ changed in it — a changed cell shows the old value struck through beside
  the new one.
- **Pair rows on a key column.** Two exports of the same table usually differ in
  row order for no reason at all; pairing on `id` makes order irrelevant, which is
  the only correct way to compare them. Without a key, rows are aligned first, so
  inserting one row reports one addition instead of changing every row below it.
- Columns are compared too: a column only one side has is marked, and columns you
  do not care about can be ignored — with the differences they hide still counted.
- The delimiter is detected outside quoted fields, so a semicolon-delimited file
  whose values contain commas reads correctly, and a `.tsv` is tab-delimited by its
  name rather than by guesswork.

## 0.2.4 — 2026-08-13

### Added

- **XML comparison.** `.xml`, `.xsd`, `.xsl`, `.svg`, `.rss`, `.atom` and `.plist`
  now get a structural comparison instead of a line diff. Attributes and text are
  separate rows, so changing an attribute reads as an attribute change rather than
  "this element is different", and the summary counts attributes on their own.
  Reindenting a document changes nothing; reordering children does, because in XML
  document order is part of the meaning — you can turn that off per comparison.
  Values are compared as text, so `007` and `7` are different, and adding a second
  repeated child reads as an addition rather than a change of type. A malformed
  document names the line and column and offers to compare as text.

### Fixed

- **A spec no longer depends on the first keypress landing.** The first shortcut
  of a test run could arrive before the renderer had attached its listener, which
  showed up as a test that passed alone and failed after another had run.

## 0.2.3 — 2026-08-13

### Added

- **YAML comparison.** Drop two `.yaml` or `.yml` files and TwinScope compares the
  data, not the lines — reordering keys or reindenting changes nothing, exactly as
  it already does for JSON. Anchors, aliases and merge keys (`<<`) are resolved
  before comparing, so a file using `&defaults` and a file with the block written
  out twice come back identical, and the result says that is why. A `---`-separated
  stream is compared document by document. A YAML that will not parse names the line
  and offers to compare as text instead.
- **A YAML can be compared against a JSON.** YAML is a superset of JSON, so a config
  and its JSON equivalent now compare structurally rather than falling through to a
  line diff of two files that say the same thing.

### Fixed

- **The "different kinds" note says which engine will actually run**, instead of
  always claiming text.

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
