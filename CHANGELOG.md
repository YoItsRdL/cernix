# Cernix Workstation Changelog

## [1.2.0] - 2026-09-07

### Added
- **Filter the library by rating.** All, one star and above through five,
  or picks only. The app has stored a star and a pick for every
  photograph since it was written and offered no way to act on either:
  you could spend an hour rating two thousand frames and the grid still
  showed all of them, in the same order.

  Workstation only for now. Local Archive records no ratings at all yet,
  so a filter there would be a control over a permanently empty set.

- **The Output drawer records what you did.** It was fed only by the
  main process, which sees Drive ids, so moving three files logged
  "Moving 3 item(s)…" and a progress count — naming neither the files
  nor where they went. A move now reads
  `MOVE /Cernix/2025/DSC_0001.ARW  ->  /Cernix/2026/Keepers/DSC_0001.ARW`,
  one line per file, and opening a folder, renaming, trashing,
  restoring, downloading, rating, flagging, scanning, importing and
  sharing each say what happened. Local paths are absolute, because the
  point of a line about a file leaving is being able to go and find it.

- **The sidebar shows where you are.** It listed only the current
  folder's children, so arriving anywhere with none of its own emptied
  the panel to "No folders" — at the point where knowing your position
  matters most. It draws the trail as a tree now, with the folder you
  are in marked and its children below, walkable with the arrow keys.

- **Zoom the interface** with Ctrl and `-`, `+` or `0`, remembered
  between launches. Removing the menu bar took Chromium's own zoom
  accelerators with it, so on Windows and Linux there was no way to zoom
  at all. macOS keeps its menu and already had them.

- **A landscape frame preset**: the same card as Classic, with the
  photograph in a landscape window and a band above and below.

### Fixed
- **The Share button says when Drive refuses.** It discarded the
  response body, so a scope error and a rate limit were indistinguishable
  and the button simply appeared to do nothing.
- **Enter during a crop crops.** The crop overlay and the Workstation
  grid both listened for Enter on the window, so Enter committed the
  crop and also opened whatever folder still held the focus behind the
  editor, which read as being thrown out of the editor.
- **Auto-crop no longer overwrites a crop you saved.** It ran when the
  editor opened, not only when you straightened, and the panel is created
  fresh for every photograph — so a composition made by hand did not
  survive being looked at.
- **Removing a frame removes its positioning.** Choosing None left the
  photograph scaled and panned to fit a cutout that no longer existed, so
  it stayed zoomed in as though the frame were still applied.
- **A frame under 4KB is no longer shipped unreachable.** Vite inlines
  small assets as data URIs, and the packaged security policy allows
  those for images but not for `fetch`, which is how frames are loaded.
  Such a frame appeared correctly in the picker and then failed on
  export.

## [1.1.2] - 2026-09-05

### Fixed
- **ExifTool actually runs in a packaged build.** 1.1.0 unpacked it from
  the asar and 1.1.1 shipped that, but the app still could not use it,
  for two further reasons that only exist in a packaged artifact.

  npm hoists `exiftool-vendored.pl` to the top level in a development
  tree and nests it under `exiftool-vendored/node_modules/` when
  packaged. Node resolves by walking *up* from the calling file, never
  down into a sibling package's `node_modules`, so the bare require
  succeeded in dev and failed in the artifact. It is anchored inside
  `exiftool-vendored` now, the way that package resolves its own
  platform binary.

  The path that comes back is then computed from a `__dirname` inside
  the asar, so it points through `app.asar` even though `asarUnpack` put
  the binary on real disk. `fs` traverses that transparently; `spawn`
  does not, because the OS sees `app.asar` as a single file and fails
  with `ENOTDIR`. The path is rewritten to the unpacked location before
  spawning.

  The practical effect: EXIF dates that name the ingest folders, and the
  EXIF and ICC profile copied onto an export, both worked in `npm run
  dev` and silently degraded in every release until now.

- **A failed Drive folder search says what went wrong.** It threw
  `Folder search failed (403)` and discarded the response body, so an
  `ACCESS_TOKEN_SCOPE_INSUFFICIENT` was indistinguishable from a
  permissions or rate-limit 403. The body is in the message, so the next
  Drive failure is diagnosable from the log rather than from a source
  change.

## [1.1.1] - 2026-08-31

### macOS
- **The macOS build ships native modules for the architecture it was
  built for.** `electron-builder --mac` builds arm64 and x64 in one
  pass out of one `node_modules`, and `node_modules` holds one build of
  a native module at a time: `install-app-deps` compiled
  `better-sqlite3` for the host, so the other bundle carried a `.node`
  it could not load and the app died opening its database with
  `dlopen … incompatible architecture`.

  It cannot show up building on one Mac for that same Mac, which is why
  it survived verification on real hardware and appeared only when CI
  built both architectures at once. 1.1.0's release smoke test caught
  it and withheld the artifact, so no macOS build was ever published
  with the defect — the same shape as the ExifTool bug in 1.1.0, and
  caught by the same check.

  `npm run release:mac` now runs one pass per architecture with native
  modules prepared immediately before each, then restores the host's
  modules. That last step is not tidiness: leaving x64 modules behind on
  an Apple Silicon machine breaks `npm run dev` with the mirror image of
  this bug.

## [1.1.0] - 2026-08-31

### Packaging
- **ExifTool now ships where the OS can run it.** `asarUnpack` was never
  set, so the bundled ExifTool sat inside `app.asar`. An asar is a single
  file to the operating system and `execve` cannot reach inside one, so
  every packaged build has resolved an ExifTool path that does not exist
  on disk. `better-sqlite3` escaped this automatically, because of its
  `.node`; nothing did the same for a Perl script. EXIF reads during
  ingest — which is what dates the folders — and the EXIF/ICC copy on
  export both failed and fell back to their degraded paths. This is not
  Linux-specific: it is the same configuration on every target, and it
  was found while checking the Linux package. Verified fixed on Linux;
  worth confirming against a Windows build before the next release.

### macOS
Cernix builds and runs on macOS, on Apple Silicon and Intel. Verified
on a Mac: the build, the launch, both SQLite stores, the window chrome,
card detection through `diskutil`, Gatekeeper on an unsigned bundle,
ExifTool, and Drive sign-in surviving a restart. The checklist that
carried the unverified work, `MACOS-VERIFICATION.md`, was deleted once
it passed.

**There is no macOS build in this release.** `npm run release:mac`
builds arm64 and x64 from a single `install-app-deps`, which compiles
`better-sqlite3` once for the host architecture, so the arm64 bundle
ships an x64 native module and dies opening its database. The release
smoke test caught it and the artifact was not published — which is the
same shape as the ExifTool defect below: a packaged app that starts and
then fails on its own dependency. Building for one architecture at a
time is the fix, and it ships separately. Until then macOS builds from
source, which is what the install page says.

- **Cards are found with `diskutil`.** `diskutil list` says what is
  mounted and nothing about removability; `diskutil info` answers that
  for one device at a time, and `plutil` converts both from plist. The
  second call is cached per device, because whether a disk can be
  ejected cannot change while it stays mounted, and a two-second poll
  should not spawn a pair of processes per volume forever on a laptop.
  Ejectable or removable media counts, an internal disk never does, and
  the boot volume is refused by mount point rather than by trusting a
  flag — a Mac booted from an external disk reports that disk as
  genuinely ejectable.
- **Nothing macOS-side goes through a shell.** A volume label is chosen
  by whoever formatted the card, and this app exists to have untrusted
  cards plugged into it, so `exec` would hand that label to `/bin/sh`.
  Every call uses `execFile`, and the only value ever interpolated is a
  kernel-assigned device identifier checked against a pattern first — a
  name from the media never reaches a command line.
- **The traffic lights are Apple's, and the app draws none of its own.**
  `titleBarStyle: 'hiddenInset'` keeps them and places them inside the
  app's 48px row; `WindowControls` returns null on darwin, which would
  otherwise have put six caption buttons on one window. The row reserves
  a band above the content so they do not land on the sidebar's mark:
  one variable, `--titlebar-inset`, which is the only thing here that
  has to be eyeballed on a real Mac.
- **The renderer can tell which OS it is on.** `platform` is exposed on
  the bridge as a value rather than a call, set in the preload, because
  the caption row is a first-paint decision and an IPC round trip would
  render one frame of the wrong chrome.
- **`npm run release:mac` builds a dmg and a zip** for arm64 and x64,
  and `npm run smoke` resolves `mac-arm64` or `mac` by architecture
  rather than guessing. Builds are unsigned, consistent with the
  project's existing decision — but Gatekeeper is markedly harsher about
  that than SmartScreen, which is the first thing the checklist asks
  about.

### Linux
Cernix runs on Linux. The app was Windows-only in a handful of specific
places rather than in its architecture, and this replaces each of them.

- **Removable volumes are found with `lsblk`.** The card watcher asked
  Windows via PowerShell and got nothing anywhere else. The Linux path
  takes RM for USB readers and HOTPLUG for built-in SD slots, and reads
  capacity from `statfs` on the mount rather than the block device, which
  knows nothing about free space. Mounts that are removable but are still
  the running system — `/`, `/boot`, `/home` — are refused: offering to
  sweep the disk you booted from is worse than missing a card.
- **The window is frameless.** `titleBarStyle` is a Windows and macOS
  option that Linux ignores, which left the window manager's buttons
  sitting above the app's own three. Linux gets `frame: false`, which
  asks the same question in a way it answers.
- **The Drive token is only written when it will really be encrypted.**
  `safeStorage` takes its key from the OS keystore, and Chromium picks
  the keystore from `XDG_CURRENT_DESKTOP`. It recognises the large
  desktops by name; anything else — Hyprland, sway, i3 — fell through to
  a backend that "encrypts" with a key hardcoded in Chromium's source,
  identical on every machine. Cernix now hints `gnome-libsecret` on
  unrecognised desktops (KDE is left to KWallet, and an explicit
  `--password-store` always wins), and then checks what was actually
  selected. If it would not be real encryption the token is not written:
  the session stays connected, the next launch asks again, and the app
  says so rather than appearing to sign you out at random. The privacy
  policy says the token is sealed with the OS keystore, so a quiet
  downgrade is not available.
- **A hung `statfs` can no longer stop the watcher.** Capacity is read
  from the mount point, and statfs on a stale mount — a card pulled while
  the kernel still has it mounted, which is how cards get removed —
  blocks in uninterruptible I/O and never returns. The poll clears its
  re-entry flag in a `finally`, so one call that never settled would have
  left the flag set and every later poll returning at the guard: no card
  detected again until restart. The wait is now bounded at five seconds,
  the same bound the Windows path already had on its exec.
- **`npm run release:linux` builds an AppImage**, and `npm run smoke`
  finds and launches it. Windows packaging is unchanged; the icon and
  target moved under a `win` key so each platform gets its own.

Not in this release: a Linux job in CI, per-platform downloads on the
landing page, and the site copy, which still says Windows.

---

## [1.0.0] - 2026-08-28

**Cernix is now free, open source, and MIT licensed.** This is the first
public release. There is no prior published version, so nothing here is an
upgrade note.

### The model
- **No account, no trial, no licence key, no subscription.** The activation
  gate, licence store, Paddle client, and update gate are gone from the
  codebase, not disabled.
- **Support is voluntary.** One Buy Me a Coffee link in Settings. It buys
  nothing and gates nothing: no tiers, no sponsor wall, no prompt that
  interrupts you.

### Removed
- **Smart Select** and AI preset-name suggestions (Gemini).
- **Generative Fill** and AI subject/sky masks (local segmentation model).
- Organize-by-date and empty-folder cleanup are unaffected: they never used
  a model and still work.

### Privacy
- **The Google Drive scope narrowed to `drive.file`.** Cernix can no longer
  see files it did not create or that you did not explicitly open. This also
  fixed a real bug: the cloud ledger rebuild had been scanning your whole
  Drive and matching on name and size, so an unrelated file could mark one of
  your card files as already synced and silently skip its upload.
- The app contacts two hosts, both only when you make it: Google Drive after
  you connect an account, and Google Fonts for the interface typeface. No
  analytics, no crash reporting, no update check.

### Install
- Windows installer, published with a sha256 alongside it.
- **Not code-signed.** SmartScreen will warn on first run: choose
  *More info → Run anyway*, or verify the sha256, or build from source.

### Notes
- Bundles ExifTool, which is GPL. It runs as a separate process rather than
  being linked in, so Cernix's own MIT licence stands. See
  `THIRD-PARTY-NOTICES.md` if you plan to redistribute.

---

## [1.0.0-RC1] - 2026-04-01

### 🛠️ Phase 4: Street Share Protocol & Industrial Polish
This release transforms Cernix from an ingest utility into a high-density, professional-grade workstation.

#### 🛰️ Street Share Protocol
- **Discovery Engine:** Implemented `driveListSessions` to discover previous syncs directly from the cloud.
- **Permission Handshake:** Automated Google Drive permission conversion (`root` to `anyone with link`).
- **Distribution Hub:** New `StreetShare.tsx` hub with high-density QR mapping for field distribution.
- **Success Loops:** Staggered success screens with integrated sharing controls.

#### 🛡️ Industrial Resilience
- **Connectivity Heartbeat:** Added pre-flight network checks to ensure safe cloud bursts.
- **Fault-Tolerant Engine:** Enhanced error detection for low-level socket and DNS failures during RAW uploads.
- **Auto-Backoff:** Implemented asymmetrical retry physics for field Wi-Fi stability.

#### ✨ Workstation UI & UX
- **Module Activation:** Activated the `Cloud Vault` and `Street Share` tabs (removing development placeholders).
- **Haptic-Style Motion:** Applied spring-based (`stiffness: 300`) micro-interactions to the entire workspace.
- **Success Reveal:** Implemented sequential, motion-staggered reveals for the Ingest Completion flow.

---

### [0.8.0] - 2026-03-31
### 🏗️ Phase 2 & 3: Command Center & AI Engine
- **RAW Engine:** Intelligent preview extraction from RAW files.
- **AI Audit:** Rule-based metadata categorization and folder mapping.
- **Cloud Gateway:** Initial Google Drive integration with resumable chunked uploads.
