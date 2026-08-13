# Changelog

All notable changes to TwinScope. Format follows [Keep a Changelog][kac]; the
project uses [semantic versioning][semver].

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/spec/v2.0.0.html

## Unreleased

## 0.3.9 — 2026-08-13

### Fixed

- **The quick-start cards all work.** Folders, Clipboard and Screenshots looked like
  buttons, and were: they just did nothing when clicked — only Git refs had ever been
  connected. Each one now opens the route it describes, the same one its keyboard
  shortcut uses, and each says what it will do when you hover it.
- **PDFs are compared as documents again.** Comparing two real PDFs showed the binary
  verdict — a size and a checksum — instead of a page-by-page diff. Every PDF a real
  program writes has compressed streams and embedded fonts, and those made TwinScope
  classify the file as an opaque blob before the PDF engine ever saw it. Hand-made test
  documents did not, which is why it went unnoticed.
- **Comparing two PDFs from the command line no longer crashes.** `twinscope a.pdf b.pdf`
  failed with an internal error about a missing worker; the file it needed was not being
  shipped alongside the binary.
- **`twinscope --help` lists every engine.** It named ten of the sixteen: YAML, XML, CSV,
  dependency and large-text comparisons all worked without being mentioned. The list is
  now generated, so it cannot drift again.

## 0.3.8 — 2026-08-13

First release since 0.1.0. It carries everything in the entries below — sixteen
comparison engines, the command line, projects, reports and the Diff Radar — plus one
new thing.

### Added

- **An update check, off by default.** Turn it on in Settings and TwinScope asks GitHub
  for the latest release number once per launch, then tells you if there is one. It is
  the only network call the app makes, and the Settings row says exactly that.
- **It checks; it does not install.** Nothing is downloaded, nothing is replaced, and no
  installer runs. When there is a newer version the release page opens in your browser
  and you decide. The builds are unsigned, and an app that cannot verify what it is about
  to install has no business installing it.
- **Off means off.** With the switch off nothing is contacted — not on launch, and not by
  anything inside the app. The refusal lives in the same process that would make the
  request, so it does not depend on the rest of the app behaving.
- **A failed check says it failed.** A server that is down, a reply that names no version,
  or a check that times out are all reported as such, rather than shown as "up to date".

### Changed

- **"Check for updates" starts off, for everyone.** It used to default to on while doing
  nothing at all; now that it does something, it needed asking for first — including on
  machines that already have a settings file.
- The Privacy section of Settings now states the one exception rather than claiming there
  are no network calls at all.

### Fixed

- **Fit returns to the same fit.** In the image viewer, zooming to 100% and then pressing
  Fit landed about 2% short of the view you started with, on any platform whose
  scrollbars take up space.

## 0.3.3 — 2026-08-13

### Added

- **PDF comparison, page by page.** Two PDFs compare as documents rather than as
  binaries: which pages changed, and what changed on them — with the word-level marks
  the text diff uses, because it _is_ the text diff, running inside each page.
- **Pages pair by their content, not by their number.** Insert a cover page and the rest
  of the document still reads as unchanged, instead of every page after it being
  reported as different.
- **A page with no text says so.** A scan, or a page that is one big image, has nothing
  for a text comparison to read, and that is stated rather than shown as "identical".
- Metadata (title, author, producer) is compared as its own table, and a page whose size
  changed is reported even when its words did not.
- **What it does not do is on screen**: pages are not rendered and not compared visually.
  Export the pages as PNGs and compare those two folders with the visual engine — the
  comparison says so itself.

## 0.3.5 — 2026-08-13

### Added

- **Visual regression over two directories of screenshots**, from the command line:
  `twinscope baseline/ current/ --engine visual --max-diff 0.1`. Shots pair on their
  path relative to the folder you gave, the list is ordered worst-first, and the whole
  set gates on its worst image.
- **Sensible budgets rather than zero.** A pixel has to differ by more than 10% of a
  channel to count, and an image by more than 0.1% of its pixels to be a regression —
  because font rasterisation and anti-aliasing move a handful of pixels between two runs
  on the same machine, and a suite that fails on that gets switched off.
- **One unreadable screenshot does not fail the run.** It is listed with the reason; the
  rest of the set still gives you an answer.
- **No adapters to install.** Whatever Playwright, Cypress or Storycap already writes is
  what gets compared. [docs/visual-regression.md](docs/visual-regression.md) shows each
  one, the CI wiring, and how to accept a new baseline (it is `rsync` — TwinScope will
  not overwrite one of its own inputs).

## 0.3.4 — 2026-08-13

### Added

- **Thresholds for CI.** `--max-changes`, `--max-diff` and `--fail-on-breaking` make a
  comparison fail a build. They take over the exit code, on purpose: without a
  threshold, exit 1 means "these two differ", which is usually true and rarely a
  failure. With one it means "these differ by more than you allowed", and the output
  names the threshold that failed.
- A threshold that cannot be judged **fails** rather than quietly passing — asking to
  fail over 1% different, against a comparison that has no percentage in it, is a
  mistake worth surfacing.
- **`--github`** writes GitHub Actions annotations and a job summary: the counts, a
  table of every threshold with a tick or a cross, and what the comparison did.
- **A GitHub Action** in `integrations/github-action/`, and [docs/ci.md](docs/ci.md)
  with a workflow you can copy — including posting the report as a PR comment, which
  uses the runner's own `gh`. TwinScope still makes no network calls of its own.

## 0.3.2 — 2026-08-13

### Added

- **Page comparison.** Two saved HTML pages, compared as pages rather than as text, in
  four sections you switch between: **Structure** (which elements moved, what their
  attributes and text say), **Style** (which declaration of which selector changed),
  **Assets** (what the page loads) and **Accessibility**.
- **A cache-busted asset is one change, not two.** `app.a1b2c3.js` becoming
  `app.998877.js` is the commonest real difference between two builds; it reads as one
  row, and there are switches for ignoring class changes and asset query strings when
  comparing two builds of the same site.
- **The accessibility section reports problems, not only differences.** A changed
  heading outline, images with no alt text, form controls with no label — including when
  both versions have the same problem, because that is still worth knowing while you
  are looking at the markup.
- **It says what it did not do.** Nothing is fetched, nothing is rendered and no
  screenshot is taken, so the comparison says so on screen and leaves the visual score
  blank rather than reporting a zero. Comparing two live URLs needs a decision that has
  not been made.

## 0.3.7 — 2026-08-13

### Added

- **Config comparison.** Two `.env` files, two Kubernetes manifests, or two Terraform
  plans, as a table of keys: what changed, what arrived, what left.
- **Secrets are masked, and the masking is not cosmetic.** A value TwinScope judges to
  be a credential — because of its name, or because it is a password inside a database
  URL, a JWT, a private key or a long generated-looking string — is replaced with a
  fingerprint before anything sees it. That means an exported report, a copied row and
  the command line carry the mask too, not just the screen. Two secrets that differ
  are still reported as differing; you just are not shown either of them. "Show
  secrets" exists, applies to one comparison, and is never remembered.
- **Empty is not the same as missing.** `KEY=` next to no `KEY` at all is its own
  state, because that difference is the one that causes outages.
- **Kubernetes objects are matched by kind, namespace and name**, so two manifests
  listing the same objects in a different order compare as identical. Secret values
  are base64-decoded before comparison, so two Secrets that differ only in encoding
  are correctly reported as the same secret.

## 0.3.1 — 2026-08-13

### Added

- **API comparison.** Two HAR captures, two OpenAPI documents, or two saved response
  bodies. TwinScope recognises them by their shape, so you drop two `.json` files and
  get an API report rather than a tree of keys.
- **Breaking-change detection for OpenAPI.** A removed operation, a removed response
  field, a narrowed type, a newly required request field, a response enum that lost a
  value — each one labelled breaking or compatible, with the rule that decided it on
  screen next to it. Compatible changes are listed too: "compatible" is not
  "uninteresting".
- **Captures pair by request, not by position.** Two recordings of the same session
  never agree on order or on cache-busting query values, so entries pair on method and
  path and the noise is set aside: volatile headers (dates, request ids, cookies) are
  ignored by default, counted, and listed.
- Nothing is fetched. Both sides are files you chose; comparing two live URLs is a
  separate decision that has not been made.

## 0.2.12 — 2026-08-13

### Added

- **Reports collapse by section.** Long reports open with everything visible and let
  you fold away what you have read. Still one self-contained file with no scripts in
  it, and printing still shows everything — a folded section is not a folded page.
- **A before/after slider in image reports.** Drag the handle to wipe between the two
  images. No JavaScript: the handle is the browser's own, which is what keeps the file
  something you can send to somebody.
- **"Open in TwinScope" in a report**, when both sides were files on disk. Clicking it
  opens the app on that comparison.
- **A `twinscope://` link opens a comparison.** TwinScope shows you both paths and
  asks before it opens anything — a link can come from any web page, and being asked
  is the point. Nothing is read until you say yes, and nothing ever leaves your
  machine.
- **A VS Code extension** (`integrations/vscode/`): right-click two files or folders
  and compare them, or mark one and compare against it later. It is not on the
  Marketplace yet; the folder has a README with how to build and install it locally.

## 0.2.9 — 2026-08-13

### Added

- **Saved comparisons.** Press ⌘S on any comparison to keep it. What is stored is the
  definition — the two inputs, the engine and the options — never the contents, so
  opening a saved comparison compares the files as they are _now_ rather than showing
  you an old answer. They live in the new Saved tab in History, and in the sidebar.
- **Projects.** A project remembers a folder, the options you like for it, and what to
  always ignore. Making one active means new comparisons start with those options
  already applied — including the normalisation rules, which is what "per-project
  defaults" meant when it was deferred in 0.2.6. Nothing requires a project: everything
  works exactly as before without one.
- **Presets are captured, not typed in.** Set a comparison up the way you want it, then
  "Capture from current comparison" in the project. No second set of option controls to
  keep in step with the real ones.
- Deleting a project keeps every comparison saved in it — they move to "Not in a
  project". A project is a way of looking at work, not the owner of it.

### Fixed

- The options shown in the toolbar are now the options that ran. A saved default (or a
  project preset) was applied to the comparison but left the toggles reading the
  engine's own defaults, so the counts and the controls could describe different
  comparisons.
- The status bar listed four engines; there are eleven, and it now asks the registry.
- The sidebar's three "pinned" comparisons were decoration and could not be clicked.
  They are real saved comparisons now, or the section is not there.

## 0.2.8 — 2026-08-13

### Added

- **Large-file mode.** A pair of text files over 8 MB is now compared by indexing
  rather than reading: TwinScope walks each file in 64-line blocks, matches the
  blocks that are identical on both sides, and diffs only the parts between them. A
  1 GB pair of logs is navigable in **9.4 seconds** using about 120 MB of memory —
  the file itself is never held in one piece.
- **Unchanged sections load when you open them.** In this mode a fold is a position
  in the file rather than lines held in memory, so clicking one fetches just that
  part. Sections too large to load in one go say so instead of pretending.
- **An Explain panel in the text diff**, beside the normalisation rules — where the
  rules have been pointing since 0.2.6. Large-file mode needs it: it lists what was
  indexed, what was anchored, and anything it stopped short of doing.

### Fixed

- The engine named on the Compare screen is now always the engine that runs. Main
  worked out the engine from a partial copy of the input and told the worker to use
  it, so a comparison could be announced as one thing and performed as another.
- A big pair no longer warns that it "may take a few seconds" when it will not:
  the heads-up now appears only for the engines that really are slow at that size.

## 0.2.14 — 2026-08-13

### Added

- **Global Quick Compare.** ⌘⇧D (Ctrl+Shift+D) opens a small always-on-top panel
  from wherever you are. Drop, paste or browse two things into it and press Compare;
  it hands them to the main window and the diff opens there, because a 420×320 panel
  is the wrong place to read one.
- **An opt-in clipboard watcher that offers rather than takes.** With it on, the
  panel notices when you copy something and shows a chip you can click. It never
  fills anything in by itself, and nothing is actually read until you accept — the
  watcher polls a length-and-fingerprint, not your clipboard's contents.
- Both are **off by default**, and both are in Settings with what they do spelled
  out. A global shortcut takes its combination from every other app on the machine,
  which is not something to switch on for someone.

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
