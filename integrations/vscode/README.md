# Compare in TwinScope — VS Code extension

Right-click in the explorer to compare two files or folders in
[TwinScope](https://codeaesthetic.github.io/twinscope-website/).

- **Compare in TwinScope** — select two entries, right-click, compare.
- **Select for TwinScope Compare** → **Compare with Selected (TwinScope)** — the
  two-step form, for entries that are not next to each other.

## How it works

The extension builds a `twinscope://compare?a=…&b=…` URL and hands it to the OS. It
never spawns anything and never reads your files: **TwinScope shows you both paths
and asks before it opens them**, and the comparison does not run until you press
Compare. Nothing leaves your machine at any point.

That also means the extension is useless without the app — install TwinScope first,
and launch it once so the `twinscope://` scheme is registered.

## Installing it (unpublished)

Not on the Marketplace: publishing needs a Marketplace publisher account, which is an
owner action. Until then:

```bash
cd integrations/vscode
npx @vscode/vsce package        # → twinscope-vscode-0.2.12.vsix
code --install-extension twinscope-vscode-0.2.12.vsix
```

There is no build step — the extension is one CommonJS file.

## Keeping it honest

`extension.js` hand-builds the URL, because it cannot import the app's own
`src/shared/deepLink.ts` (separate runtime, separate package, no bundler). The app's
test suite asserts that its parser accepts exactly the shape this file produces, so
the two cannot drift apart silently — see the last test in `src/shared/deepLink.test.ts`.
