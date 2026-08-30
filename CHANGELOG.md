# Cernix Workstation Changelog

## [Unreleased]

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
