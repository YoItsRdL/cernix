# Contributing to Cernix

Cernix is a Windows desktop app for photographers: ingest from a card, stage locally, sync to Drive, edit RAW non-destructively. It's MIT licensed and free: see [`README.md`](./README.md).

## Before you start: Node version

**Use Node 20.19+, 22, or 24. Not 26.**

This isn't a preference. On Node 26 the Electron install fails in a way that looks like success: `extract-zip` emits a single entry from the Electron archive, its promise never settles, the event loop drains, and `install.js` exits `0` having written no binary. You get `Electron failed to install correctly` on first run, and reinstalling doesn't help because npm believes the package is fine.

`package.json` declares the range in `engines`, but npm only warns by default. If you hit it, the fix is to switch Node and delete `node_modules/electron` before reinstalling.

## Getting it running

```bash
git clone https://github.com/YoItsRdL/cernix.git
cd cernix
npm install
npm run dev
```

That's enough for everything except Google Drive.

### Google Drive (optional)

Drive features need OAuth credentials. Without them the app runs fine and the Drive surfaces report that they're unconfigured.

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/) and an OAuth client of type **Desktop app**.
2. Copy `.env.example` to `.env` and fill in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

`.env` is gitignored and must stay that way. Released builds get their credentials compiled in at build time from CI secrets: see `vite.config.ts`.

The app requests only `drive.file`, which grants access to files it creates rather than your whole Drive. Please don't widen that without discussion: broader scopes drag in Google verification and an annual third-party security assessment, which this project can't carry.

## What runs before your commit lands

`.husky/pre-commit` runs:

1. `lint-staged`: ESLint over changed `.ts`/`.tsx`
2. `npm run typecheck`: `tsc --noEmit` across the project

Both must pass. ESLint treats the design-system and hand-rolled-control rules as errors; warnings are visible but don't block.

Worth running yourself before pushing:

| Command | What it's for |
|---|---|
| `npm run lint` | the whole tree, not just staged files |
| `npm run typecheck` | same gate the hook runs |
| `npm run check:design` | design-token violations: should stay at zero |
| `npm run check:contrast` | WCAG contrast on the token palette |
| `npm test` | Vitest, pure logic, runs in plain Node |
| `npm run test:ui` | the Electron behavioural suite, after `npx vite build` |

**Two suites, and they cover different things.** `npm test` is Vitest over
pure logic: parsers, path guards, the ledger key, the grid arithmetic. Anything
needing a real browser lives in `tests/ui/`, which runs each suite in its own
Electron window, because jsdom models neither drag-and-drop nor WebGL.

One convention is worth knowing before you add either: **a test is not trusted
until it has failed.** Break the thing it covers, watch it go red, restore it.
That has repeatedly caught tests here that passed against broken code.

## Testing a packaged build

`npm run dev` is not the same as the shipped app: different module resolution, no `.env` in the package, real `asar` paths.

```bash
npx electron-builder --win --dir   # produces release/win-unpacked
npm run smoke                      # launches it and checks it stays up
```

Two traps here, both of which have cost real time:

- **`ELECTRON_RUN_AS_NODE`**: if this is set in your shell (some terminals set it, including VS Code's in certain configurations), *any* Electron binary runs as plain Node: no window, no data directory, instant exit, no error. It looks exactly like a broken build. `npm run smoke` strips it from the child environment for this reason; if you're launching the binary by hand, clear it first.
- **Building the installer** (`--win nsis` rather than `--dir`) needs `SeCreateSymbolicLinkPrivilege`. electron-builder extracts a code-signing package containing macOS symlinks, and without the privilege the extraction fails and the build never completes. Turn on **Windows Developer Mode** (Settings → System → For developers), or let CI build it.

## Before you write

You don't need a ticket to send a fix. For anything larger than a bug fix, open an issue first so we can agree the shape before you write it.

Two conventions worth knowing, because the review will ask about both. **Values come from tokens, not literals**: `src/shared/tokens.css` is the single source for colour, radius, spacing and duration, and a component that writes a hex or a bare `px` radius is a defect even when it looks right. And **comments explain why, not what**, the diff already says what changed; a comment earns its place by holding the measurement behind a threshold or the failure that motivated a guard.

## Reporting bugs

Use the issue templates. The three things that make a desktop bug actionable are your **OS version**, the **app version**, and **whether Drive is connected**: the templates ask for all three.

If the app fails at startup it writes `startup-error.log` into its data directory (`%APPDATA%\cernix`). Attach it.

## Security

Don't open a public issue for a vulnerability. See [`SECURITY.md`](./SECURITY.md).

## Licence

Contributions are MIT, same as the project.
