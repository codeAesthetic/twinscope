const vscode = require('vscode');

/**
 * Compare in TwinScope — a thin VS Code extension (v0.2.12).
 *
 * Thin on purpose: it builds a `twinscope://compare` URL and hands it to the OS.
 * No spawning, no bundled binary, no settings to get wrong — and TwinScope itself
 * asks the user before it reads anything a link names, so this extension has no
 * security decision to make.
 *
 * Two ways in, because VS Code offers two: select two entries and compare them, or
 * mark one as BEFORE and later compare something against it (the same shape as the
 * editor's own "Select for Compare").
 *
 * **The URL is hand-built here.** This file cannot import `src/shared/deepLink.ts`:
 * it is a separate runtime, published separately, with no build step. The four lines
 * below mirror `buildCompareLink`, and `src/shared/deepLink.test.ts` asserts that the
 * parser accepts exactly this shape — change one and that test fails.
 */

/** The path a picked explorer entry has, or null for anything not on disk. */
function fsPathOf(uri) {
  if (!uri || uri.scheme !== 'file') return null;
  return uri.fsPath;
}

function linkFor(a, b) {
  return `twinscope://compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;
}

async function open(a, b) {
  await vscode.env.openExternal(vscode.Uri.parse(linkFor(a, b)));
}

function activate(context) {
  /** The entry marked as BEFORE, if any. Kept per window, not persisted. */
  let selected = null;

  const setSelected = (path) => {
    selected = path;
    // Drives the `twinscope.hasSelection` clause in package.json, so "Compare with
    // Selected" is absent until there is something to compare with rather than
    // present and inert.
    void vscode.commands.executeCommand('setContext', 'twinscope.hasSelection', path !== null);
  };

  setSelected(null);

  context.subscriptions.push(
    /**
     * Two or more selected: the first two are BEFORE and AFTER, in the order VS Code
     * reports them. Anything beyond two is ignored — TwinScope compares two things,
     * and silently picking a different pair would be worse than a clear refusal.
     */
    vscode.commands.registerCommand('twinscope.compareSelected', async (_clicked, uris) => {
      const paths = (uris ?? []).map(fsPathOf).filter((path) => path !== null);
      if (paths.length < 2) {
        void vscode.window.showWarningMessage('Select two files or folders to compare.');
        return;
      }
      if (paths.length > 2) {
        void vscode.window.showInformationMessage(
          `TwinScope compares two things — using the first two of ${paths.length}.`,
        );
      }
      await open(paths[0], paths[1]);
    }),

    vscode.commands.registerCommand('twinscope.selectForCompare', (clicked) => {
      const path = fsPathOf(clicked);
      if (path === null) {
        void vscode.window.showWarningMessage('That item is not a file on disk.');
        return;
      }
      setSelected(path);
      void vscode.window.setStatusBarMessage(`TwinScope: comparing against ${path}`, 4000);
    }),

    vscode.commands.registerCommand('twinscope.compareWithSelected', async (clicked) => {
      const path = fsPathOf(clicked);
      if (selected === null || path === null) {
        void vscode.window.showWarningMessage('Select something for comparison first.');
        return;
      }
      await open(selected, path);
      setSelected(null);
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
