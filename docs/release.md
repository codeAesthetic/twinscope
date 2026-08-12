# Releasing TwinScope

Everything here runs locally. There is no release server, no telemetry, and no
auto-updater — a release is a set of files you build and hand out.

## Build

```bash
npm ci
npm run gate            # typecheck · lint · format · unit tests · regression suite
npm run package:mac     # → release/TwinScope-<version>-arm64.dmg (+ x64, + zips)
```

`package:win` and `package:linux` exist and are best-effort: they have not been
smoke-tested on their own platforms, and neither is a supported target for 0.1.0.

The build has **no native modules**. History uses Node's built-in `node:sqlite`
(D9a), so there is nothing to rebuild per Electron ABI and nothing that can fail
during a user's install.

## Signing and notarisation — OWNER ACTION

An unsigned build is fine for your own machine and for private testing. macOS
will refuse to open it on anyone else's without a right-click → Open, and
Gatekeeper will keep complaining. To ship it properly you need an Apple
Developer account (99 USD/year) and:

1. **Developer ID Application certificate**, installed in the login keychain.
   `security find-identity -v -p codesigning` should list it.
2. **An app-specific password** for notarisation, from appleid.apple.com, stored
   in the keychain:
   ```bash
   xcrun notarytool store-credentials twinscope-notary \
     --apple-id you@example.com --team-id TEAMID --password app-specific-password
   ```
3. Add to `electron-builder.yml` under `mac:`
   ```yaml
   notarize:
     teamId: TEAMID
   ```
   and build with `CSC_IDENTITY_AUTO_DISCOVERY=true`.
4. Verify the result, rather than trusting that it worked:
   ```bash
   codesign --verify --deep --strict --verbose=2 release/mac-arm64/TwinScope.app
   xcrun stapler validate release/TwinScope-0.1.0-arm64.dmg
   spctl --assess --type execute --verbose release/mac-arm64/TwinScope.app
   ```

Until that is done, `hardenedRuntime: true` is set but nothing is signed, and
electron-builder will say so in its output.

## Before tagging — OWNER ACTIONS

- **Name availability.** `twinscope` needs checking on npm (the CLI in V1-2 will
  want it), on GitHub, and as a domain. Record the outcome in the plan's
  decision log; if it is taken, the fallback list belongs there too.
- **Smoke-test the packaged app on a clean account.** Install from the dmg on a
  macOS account without Node or Xcode and run through all five engines, history
  persistence (`~/Library/Application Support/TwinScope/twinscope.db`) and an export.
  `npm run gate` does not prove any of this: it tests the unpackaged build.
- **Re-measure RAM on the packaged build** (plan §3.8 follow-up). The unpackaged
  number, 543 MB across all processes, misses the budget; a packaged build drops
  devtools infrastructure and should be measured per process before anyone
  decides whether the budget or the app is wrong.

## Demo GIF (MD §48/§49)

Twenty seconds, no narration, recorded at 1280×800 on the dark theme:

1. (0–3 s) Empty Compare screen. Drag `users-v2.3.json` onto BEFORE.
2. (3–6 s) Drag `users-v2.4.json` onto AFTER. The detection chip resolves to
   _Structural JSON diff_.
3. (6–9 s) Press ⏎. The tree appears with the summary strip.
4. (9–14 s) Toggle **Ignore array order** off, then on. The counts change and the
   Explain block updates — this is the beat that shows the product's argument.
5. (14–18 s) Add `meta.updatedAt` as an ignored path; the suppressed chip appears.
6. (18–20 s) ⌘⇧E, save the HTML report, and open it in a browser.

Record with the built app, not `npm run dev` — the dev build shows the devtools
splitter and an unsigned-app badge.
