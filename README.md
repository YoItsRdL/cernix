# Cernix

**Photography ingest, RAW editing, and Google Drive distribution in one desktop app.**

Cernix is a desktop workstation for photographers. Plug in an SD card and it sweeps your media, pulls previews straight out of heavy RAW files, lets you cull and edit non-destructively, and pushes the results to Google Drive.

It is free, MIT licensed, and open source. There is no account, no subscription, no trial, and no telemetry.

## Capabilities

- **Ingest pipeline**: Automatic volume detection, recursive scanning, and resumable transfer with live progress.
- **RAW preview engine**: Embedded-preview extraction for `.arw`, `.cr3`, `.cr2`, `.nef`, `.dng`, `.orf`, `.raf`, `.rw2`, `.srw`, and `.pef`, so culling doesn't wait on a full decode.
- **Non-destructive editor**: Crop and rotate, tone curves, HSL, selective colour, black and white, plus linear, radial, and brush masks with heal. Edits are written to XMP sidecars; your originals are never modified.
- **Presets**: Save, rename, and apply your own looks, with cached thumbnails for instant preview.
- **Cloud vault**: Resumable, multi-threaded Google Drive sync with a "Cernix" root, and a sync ledger that survives restarts.
- **Street Share**: Generate a public link and QR code for a Drive folder, for handing photos to someone you just shot.
- **Field resilience**: Upload heartbeat and retry logic built for unreliable Wi-Fi.

Every bullet above maps to something you can do in the released build. If you find one that doesn't, that's a bug: please open an issue.

## Privacy

Cernix talks to two services, and only when you make it:

- **Google Drive**, after you connect an account. The OAuth scope is `drive.file`, which grants access only to files the app itself creates or that you explicitly open: it cannot see the rest of your Drive.
- **Google Fonts**, to load the interface typeface at launch.

That is not a promise you have to take on trust. The packaged app ships a Content Security Policy that allowlists Google's API, OAuth and user-content hosts for connections, and Google Fonts for the stylesheet and the font files. Everything else is refused by the browser engine itself, not by application code. It is one list, in `src/main/index.ts`, and the wildcard that dev builds need for hot reload is explicitly gated on the app not being packaged.

There is no analytics, no crash reporting, and no update check. Your photos, catalogue, and credentials stay on your machine.

## Architecture

| Layer | Technology |
|---|---|
| **App shell** | Electron + Vite |
| **Backend** | Node.js (main process services) |
| **Frontend** | React, Tailwind, Framer Motion |
| **Cloud** | Google Drive API v3 (OAuth2, `drive.file`) |
| **Storage** | SQLite, typed IPC context bridge |
| **Metadata** | ExifTool (bundled) |

```
cernix/
├── landing/            # Static site
├── scripts/            # Build, audit, and smoke-test tooling
├── src/
│   ├── main/           # Services and IPC handlers
│   ├── renderer/       # React workstation
│   └── shared/         # Types shared across the bridge
└── package.json
```

The main process owns everything privileged: the filesystem, the two
SQLite stores and the Google OAuth flow. The
renderer owns none of it and reaches main through a single typed bridge
in `src/main/preload.ts`, which exposes a closed set of named methods
rather than a general channel. `src/shared/` holds the types both sides
agree on, so a change to a payload breaks the build rather than the
app.

### Two names for the same thing

The interface and the source use different vocabulary, and the comments
follow the interface. The mapping:

| In the app | In the source | What it is |
|---|---|---|
| **Local Archive** | `components/ReviewView.tsx` | a card or folder on disk; decide what to import |
| **Workstation** | `components/Distiller.tsx` | the user's Google Drive; organise what was imported |

They are deliberately symmetrical: the same selection model
(`hooks/useListSelection.ts`), the same paging (`hooks/usePagination.ts`),
the same grid sizing (`lib/grid.ts`), the same keyboard. A comment
reading "same rule as Workstation" is pointing at `Distiller.tsx`.
Changing one and not the other is how most of this codebase's defects
got in.

The reasoning behind a given decision is in the comments beside it.
This codebase comments *why*, not *what*: a threshold carries the
measurement that chose it, a guard carries the failure that motivated
it.

## Install

Grab the installer from the [releases page](https://github.com/YoItsRdL/cernix/releases). The published builds are Windows only for now. Linux and macOS run from source, and both have been verified on real hardware: `npm run release:linux` produces an AppImage, `npm run release:mac` a dmg and a zip for Apple Silicon and Intel.

### Unsigned builds

Releases are **not code-signed**. A certificate is a recurring cost this project doesn't carry, so Windows SmartScreen shows *"Windows protected your PC"* on first run: choose **More info → Run anyway**.

Every release publishes a sha256 alongside the installer. If you'd rather not trust a binary at all, the source is here and `npm run build` produces the same app.

## Build from source

> **Prerequisites:** Node.js 20.19+ (and below 25 — the range in
> `engines`, which is enforced), npm 9+. Node 26 fails to install
> Electron at all, writing no binary and exiting 0.

```bash
git clone https://github.com/YoItsRdL/cernix.git
cd cernix
npm install

npm run dev            # development
npm run build          # production installer for this platform
npm run release:linux  # Linux AppImage
npm run release:mac    # macOS dmg + zip (arm64 and x64)
npm run smoke          # launch the packaged app and check it stays up
```

On Linux, `npm install` builds `better-sqlite3` from source if no prebuild
matches, which needs a C++ toolchain and Python. `npx electron-builder
install-app-deps` then rebuilds it against the Electron ABI; without that
step the packaged app starts and fails to open its database.

Drive sign-in persists only where a system keyring is running: without
one, Chromium has no key to seal the token with, and Cernix will not
write a token it cannot encrypt. See the note in `google-auth.ts`.

Google Drive sync needs your own OAuth client ID: see [`CONTRIBUTING.md`](./CONTRIBUTING.md). Everything else works without one.

## Contributing

Issues and pull requests are welcome. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the Node version, getting it running, and the checks that must pass before a commit lands. You don't need a ticket to send a fix. Security reports go through [`SECURITY.md`](./SECURITY.md): please don't file them as public issues.

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Support

If Cernix earns its place in your workflow, you can [buy me a coffee](https://buymeacoffee.com/ibonescalap). It is entirely optional, buys nothing, and gates nothing: every feature is available to everyone, forever.

## Licence

MIT: see [`LICENSE`](./LICENSE).

Cernix bundles ExifTool, which is GPL. It runs as a separate process rather than being linked in, so the MIT licence on Cernix's own code stands; see [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) for what that does and does not mean if you redistribute it.
