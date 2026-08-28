# Third-party notices

Cernix is MIT licensed (see [`LICENSE`](./LICENSE)). It ships and depends on third-party software under other licences; this file records the ones that carry obligations or that a redistributor should know about.

## ExifTool: GPL, bundled as an executable

Cernix bundles [ExifTool](https://exiftool.org/) by Phil Harvey, via the `exiftool-vendored.exe` npm package. It reads EXIF capture dates during ingest and copies EXIF/ICC metadata onto exported images.

The npm package metadata says MIT, but **that describes the wrapper, not the tool**. The bundled Windows build ships with Strawberry Perl and carries **GNU GPL v3** licence text. ExifTool itself is dual-licensed under the Perl Artistic License or the GPL.

Why this doesn't change Cernix's licence: ExifTool is invoked as a **separate child process** (`spawn`, see `src/main/services/export-postprocess.ts`), never linked into the application. Cernix is not a derivative work of it, and the two are distributed as an aggregate.

What that obliges, and where it's met:

- **The licence text travels with the binary.** It ships inside the package at `resources/app.asar.unpacked/node_modules/exiftool-vendored/node_modules/exiftool-vendored.exe/bin/exiftool_files/LICENSE`, together with `Licenses_Strawberry_Perl.zip`.
- **The source is available.** ExifTool's source is published at <https://exiftool.org/> and mirrored at <https://github.com/exiftool/exiftool>.

If you fork Cernix and redistribute builds, these obligations travel with you.

## SQLite: public domain

Via `better-sqlite3` (MIT). SQLite itself is in the [public domain](https://www.sqlite.org/copyright.html) and imposes no conditions.

## Electron and Chromium

Electron is MIT; Chromium and its dependencies carry BSD and other permissive licences. Both ship their own licence files next to the executable in a packaged build: `LICENSE.electron.txt` and `LICENSES.chromium.html`.

## Everything else

The runtime dependency tree is 241 packages, all under permissive licences:

| Licence | Packages |
|---|---|
| MIT | 203 |
| ISC | 15 |
| Apache-2.0 | 12 |
| BSD-3-Clause | 4 |
| BSD-2-Clause | 2 |
| Other permissive (CC0-1.0, 0BSD, dual-licensed) | 5 |

No copyleft appears in the JavaScript dependency tree, and no package is missing licence metadata. ExifTool above is the only copyleft component, and it enters as a bundled binary rather than as a dependency, which is exactly why a `package.json`-based licence scan does not surface it.

*Regenerate the table by walking the non-`dev` entries of `package-lock.json`; re-check bundled binaries by hand, since metadata does not describe them.*

---

## Security advisories

Last reviewed 2026-08-22. `npm audit` reports **14 advisories (1 critical, 13 high)**, and **none of them are in the runtime tree**: every one is in the build toolchain (`electron-builder` and its dependencies, `node-gyp`, `tar`, `extract-zip`, `cacache`).

That distinction is the whole triage. These packages run on a developer's machine or a CI runner during a build; none is bundled into the shipped app, so none is reachable by an attacker with a copy of Cernix. A build machine is worth protecting, but the threat model is "malicious dependency during build", not "remote attacker against a user".

They are not fixed because the fixes are `electron-builder` major bumps, and changing the tool that produces the installer is a larger, riskier change than the advisories justify. Revisit when electron-builder is upgraded for another reason.

Four advisories *were* in the runtime tree: `googleapis`, `googleapis-common`, `gaxios`, `uuid`, all moderate. They are gone: `googleapis` was declared as a dependency but never imported anywhere in `src/`. All Google Drive access goes through plain `fetch` against `googleapis.com` REST endpoints. Removing the unused dependency cleared all four.

One judgement call worth stating: `electron` itself carries a high advisory (ASAR Integrity Bypass via resource modification). It is listed as a devDependency, but the Electron runtime obviously ships. It is not treated as urgent because exploiting it requires the ability to modify files inside an installed application: an attacker who already has that access has better options. It will resolve with a routine Electron upgrade.

*Re-run with `npm audit`, and classify each advisory by whether its package appears with `dev: false` in `package-lock.json`. A raw total is not a useful number on its own.*
