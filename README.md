# DevDiff

**Compare anything. Understand what changed.**

A local-first universal comparison tool for developers. Drop two files, folders, images or clipboard contents — DevDiff detects what they are, picks the right diff engine, and shows what changed.

Your files never leave your machine: no telemetry, no uploads, no account.

> **Status: early development.** The Electron shell, design system and engine contract are in place; the comparison engines themselves are next. Not yet usable as a product.

---

## Requirements

|          |                                                                   |
| -------- | ----------------------------------------------------------------- |
| **Node** | 24 (LTS) — `nvm use` picks it up from `.nvmrc`                    |
| **npm**  | 11+ (ships with Node 24)                                          |
| **OS**   | macOS, Windows or Linux. macOS is the primary development target. |

## Getting started

```bash
nvm use          # or: nvm install 24
npm install      # postinstall also fetches the Electron binary
npm run dev      # opens the app with hot reload
```

That's the whole setup. If `npm run dev` complains that Electron is missing, re-run `npm install` — see [Troubleshooting](#troubleshooting).

## Scripts

| Command             | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `npm run dev`       | Electron + Vite with hot reload                                |
| `npm run build`     | Production build into `out/`                                   |
| `npm run verify`    | Builds, boots the app, and checks it really works (Playwright) |
| `npm run typecheck` | TypeScript across three projects: main/preload, renderer, e2e  |
| `npm test`          | Unit tests (vitest)                                            |
| `npm run lint`      | ESLint, including the import-boundary rules                    |
| `npm run format`    | Prettier                                                       |

## Layout

```
src/
├── main/       Electron main process — windows, security, IPC
├── preload/    the only bridge between renderer and main
├── renderer/   React UI
├── shared/     cross-process contracts (channel names, types)
└── engines/    comparison engines — pure logic, no Electron, no DOM
e2e/            verification harness (see below)
```

Three boundaries are enforced by ESLint rather than convention:

- The **renderer** cannot import `node:*` or `electron`. It talks to the main process only through `window.devdiff`, exposed by the preload script.
- **Engines** cannot import `electron`, so the planned CLI can reuse them unchanged.
- `src/shared/channels.ts` stays dependency-free, because the sandboxed preload imports it.

## Verifying changes

`npm run verify` is a harness, not a test suite. It builds the app, boots it in Electron, and gives you a real page to drive:

```ts
const harness = await launchApp();
await harness.page.getByTestId('…').click();
await harness.screenshot('what-i-changed');
expect(harness.errors).toEqual([]);
```

Screenshots land in `e2e/.artifacts/screenshots/`. Keep `e2e/verify.spec.ts` small — its security assertions are permanent; for one-off checks, write a throwaway spec and delete it after.

## Security posture

The renderer is treated as untrusted. `src/main/security.ts` enables the sandbox and context isolation, disables node integration, sets a Content-Security-Policy, and denies navigation, new windows, `<webview>` embedding and every permission request. `npm run verify` asserts these hold — a regression there is a remote-code-execution bug, not a UI bug.

## Troubleshooting

**"Electron failed to install correctly" / no window opens.** npm gates dependency install scripts, so Electron's own postinstall never runs and the binary is missing. `scripts/ensure-electron.mjs` handles this from the root `postinstall`; run `npm install`, or `node scripts/ensure-electron.mjs` directly.

**Don't bump Vite past 7 or TypeScript past 6.0.** `electron-vite` peers on Vite `^5 || ^6 || ^7`, and `typescript-eslint` peers on TypeScript `<6.1.0` — TypeScript 7 is the native compiler and has no lint support yet. These are the newest versions the whole toolchain agrees on.

## License

MIT
