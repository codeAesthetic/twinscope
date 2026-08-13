# TwinScope in CI (v0.3.4)

`twinscope` is a single bundled file with no runtime dependencies to install, so a CI
step is `node out/cli/index.js before after`. What v0.3.4 adds is the part a pipeline
needs: **thresholds that decide**, annotations the runner renders, and a job summary
somebody will actually read.

## The exit code, and the one thing to know about it

|     | Without a threshold          | With a threshold                         |
| --- | ---------------------------- | ---------------------------------------- |
| `0` | the two inputs are identical | they are within the threshold            |
| `1` | **they differ**              | **they differ by more than you allowed** |
| `2` | something went wrong         | something went wrong                     |

Both meanings of `1` are useful, and they are not the same. A build step that treats
"these differ" as a failure fails on every commit that changes anything — which is why
the CLI only takes over the exit code once you give it a number:

```bash
twinscope api.v1.json api.v2.json --fail-on-breaking     # 1 only if a consumer breaks
twinscope before.png after.png --max-diff 0.5            # 1 only over half a percent
twinscope src/ dist/ --max-changes 0                     # 1 if anything differs at all
```

A threshold that cannot be evaluated **fails**. `--max-diff` against a comparison with
no percentage in it, or `--fail-on-breaking` against a comparison that never looks for
breaking changes, is a mistake in the pipeline — and a silent pass would hide it forever.

## Annotations and the job summary

`--github` writes GitHub Actions annotations to stdout and a Markdown summary to
`$GITHUB_STEP_SUMMARY`:

```bash
twinscope api.v1.json api.v2.json --fail-on-breaking --github
```

The summary carries the counts, a table of every threshold with a ✅ or ❌, and — folded
away — the list of what the comparison actually did, which is the same explainability
rule the app follows (Rule 3).

## A workflow that works

TwinScope is not on npm yet (that is an owner action), so the CLI is built from source.
It takes a few seconds and needs no browser download.

```yaml
name: contract
on: pull_request

jobs:
  api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      # Build the CLI once. `npm ci` here is TwinScope's own install, not your project's.
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci && npm run build:cli
        working-directory: tools/twinscope # wherever you vendored or submoduled it

      # The contract as it is on main, against the contract in this PR.
      - run: git show origin/${{ github.base_ref }}:openapi.json > /tmp/openapi.base.json

      - uses: ./tools/twinscope/integrations/github-action
        with:
          before: /tmp/openapi.base.json
          after: openapi.json
          fail-on-breaking: 'true'
          report: twinscope-report.html

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: twinscope-report
          path: twinscope-report.html
```

### Comparing two git refs directly

The git engine needs no checkout gymnastics — point it at the repository and name two
refs. `WORKTREE` is the files as they are on disk:

```yaml
- uses: ./tools/twinscope/integrations/github-action
  with:
    repo: .
    before: origin/main
    after: WORKTREE
    max-changes: '400'
```

### A comment on the pull request

Posting a comment is the runner's job, not the app's — TwinScope makes no network calls,
in CI or anywhere else. `gh` is already on every GitHub runner:

```yaml
- name: Comment
  if: always()
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    node tools/twinscope/out/cli/index.js \
      /tmp/openapi.base.json openapi.json --md > /tmp/twinscope.md
    gh pr comment ${{ github.event.number }} --body-file /tmp/twinscope.md
```

## Visual regression

For a whole directory of screenshots against a baseline directory, use the folder engine
— it compares trees and finds renames — or `twinscope baseline` (v0.3.5) for the
accept/compare loop. See [visual-regression.md](visual-regression.md).

## What is deliberately not here

- **No network calls, in either direction.** TwinScope does not fetch, phone home or
  check for updates in CI any more than it does on a desktop. Anything that leaves the
  runner is a step you wrote.
- **No live URL comparison.** Comparing two deployed URLs needs a runtime fetch and a
  headless browser; both are pending an owner decision (plan §6.3.0). Two _saved_ pages
  compare fine today — see the page engine.
