# macOS: what still needs a Mac

The macOS support in this repo was written on Linux. Everything that
could be checked without a Mac has been: the parsing, the filters and the
platform dispatch are unit-tested, and the Linux and Windows paths are
unchanged and still verified.

Nothing below has ever run on macOS. This file is the list of what to
confirm, in the order that fails fastest. **Delete it once it passes** —
it describes a moment, not the project.

## Build

```bash
npm ci
npx electron-builder install-app-deps   # rebuilds better-sqlite3 for this ABI
npm run release:mac
npm run smoke                           # finds mac-arm64 or mac automatically
```

Node must be >= 20.19 and < 25. Node 26 fails to install Electron and
exits 0 having written nothing.

## 1. It starts at all

`npm run smoke` launches the bundle and requires it to stay up, write
`userData`, and log no startup error. If this fails, everything below is
moot.

- [ ] Smoke passes
- [ ] Both SQLite stores appear (`cernix-v1.db`, `cernix-ratings.db`)

The likely failure is `better-sqlite3` built for the wrong ABI or the
wrong architecture. Re-run `install-app-deps`.

## 2. Gatekeeper

The project ships unsigned by decision, and macOS is far less forgiving
about that than Windows. `identity: null` in the `mac` build config means
no signature at all.

- [ ] Does the built `.app` open on the build machine?
- [ ] Does it open after being zipped, downloaded and unquarantined?
      (`xattr -dr com.apple.quarantine /Applications/Cernix.app`)
- [ ] On Apple Silicon specifically: arm64 is stricter about unsigned
      code than Intel. If it refuses to launch, ad-hoc signing
      (`codesign --force --deep -s - Cernix.app`) is the next thing to
      try — and if that is what it takes, it belongs in the build config
      rather than in a README instruction to users.

This is the item most likely to change the distribution story. Decide it
before writing any download copy.

## 3. The title bar

`titleBarStyle: 'hiddenInset'` keeps Apple's traffic lights and places
them inside the app's own 48px row. `WindowControls` returns `null` on
darwin so the app does not draw a second set.

- [ ] Exactly three caption buttons, Apple's, top-left
- [ ] They are not sitting on top of the sidebar's mark tile
- [ ] The window can be dragged by the top strip
- [ ] The window can be resized from its edges
- [ ] Both light and dark themes look right at the top row

**The one number to tune:** `--titlebar-inset` in
`src/renderer/index.css`, currently `28px`. It is the vertical band
reserved above the content on macOS. Nothing else needs touching —
everything that depends on it reads the variable.

## 4. Card detection

The part with no equivalent anywhere else, and the reason the app exists.
`diskutil list -plist` finds what is mounted, `diskutil info -plist
<device>` says whether it can be ejected, and `plutil` converts both.
Nothing goes through a shell.

- [ ] Insert an SD card: it appears within ~2s
- [ ] Eject it: it disappears
- [ ] Its label, capacity and free space are right
- [ ] The boot volume never appears
- [ ] An external USB SSD is not offered as a card
- [ ] A mounted DMG is not offered as a card
- [ ] A network share is not offered as a card
- [ ] Console shows no `[VolumeWatcher] Poll error`

If a card is missed, log the raw output and compare it against the
fixtures in `volume-watcher.test.ts`:

```bash
diskutil list -plist | plutil -convert json -o - -
diskutil info -plist disk4s1 | plutil -convert json -o - -
```

## 5. The rest of the pipeline

- [ ] ExifTool runs (ingest dates folders correctly) — the `asarUnpack`
      fix was verified on Linux only
- [ ] An export carries EXIF and an ICC profile
- [ ] Drive sign-in persists across a restart (macOS Keychain; this is
      the one platform where `canEncryptTokens` should never refuse)
- [ ] Trash works from the app

## Known-different from Windows and Linux

- macOS keeps its application menu; `Menu.setApplicationMenu(null)` is
  already guarded on darwin, so cut, copy and paste survive.
- Closing the last window does not quit, by macOS convention. Already
  handled.
- `perl` ships with macOS, so ExifTool has its interpreter.
