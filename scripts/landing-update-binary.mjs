#!/usr/bin/env node
/**
 * Updates `landing/binary.json` after a new release.
 *
 * Pulls the version from `package.json`, computes a sha256 against the
 * produced `release/Cernix-Setup-<version>.exe`, and writes a fresh
 * `binary.json` consumed by the landing-page CTA at runtime. The
 * inline script in `landing/index.html` reads this file on page load:
 *
 *   { "version": "1.0.0-RC1",
 *     "url":     "https://github.com/YoItsRdL/cernix/releases/download/v1.0.0-RC1/Cernix-Setup-1.0.0-RC1.exe",
 *     "sha256":  "..." }
 *
 * Usage (from the repo root):
 *
 *   node scripts/landing-update-binary.mjs --release-tag v1.0.0-RC1
 *
 * The release tag is the GitHub Release tag the binary was uploaded
 * under. It's required because there's no reliable way to infer it
 * from the local checkout (the version in `package.json` is the
 * binary's version, not the release tag, and the two aren't always
 * 1:1: a single release can host multiple binaries).
 *
 * Prerequisites:
 *   1. `npm run release` has produced `release/Cernix-Setup-<v>.exe`.
 *   2. That binary has been uploaded to a GitHub Release tagged
 *      `--release-tag`.
 *
 * Output: rewrites `landing/binary.json`. Run `git diff landing/binary.json`
 * to inspect before committing.
 */

import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')

const REPO_SLUG = 'YoItsRdL/cernix'

// ─── Argument parsing ────────────────────────────────────────────────
const args = process.argv.slice(2)
const tagIndex = args.indexOf('--release-tag')
if (tagIndex === -1 || !args[tagIndex + 1]) {
  console.error('Usage: node scripts/landing-update-binary.mjs --release-tag <vX.Y.Z>')
  console.error('')
  console.error('  --release-tag   GitHub Release tag the .exe was uploaded under.')
  console.error('                  Example: --release-tag v1.0.0-RC1')
  process.exit(2)
}
const releaseTag = args[tagIndex + 1]

// ─── Resolve version + binary path ────────────────────────────────────
const pkgPath = path.join(REPO_ROOT, 'package.json')
const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
const version = pkg.version

// ─── Find what this release actually produced ───────────────────────
//
// One entry per platform, and only for a file that is really in
// `release/`. A platform with no artifact gets no entry, and the page
// then says the build does not exist rather than offering a download
// that 404s. That is the whole contract: `binary.json` describes what
// was built, never what was intended.
//
// Each candidate list is in preference order, so a run that built both
// macOS architectures publishes the Apple Silicon one.
const CANDIDATES = {
  windows: [`Cernix-Setup-${version}.exe`],
  linux: [`Cernix-${version}-x86_64.AppImage`],
  macos: [`Cernix-${version}-arm64.dmg`, `Cernix-${version}-x64.dmg`],
}

const platforms = {}
for (const [platform, names] of Object.entries(CANDIDATES)) {
  for (const name of names) {
    const file = path.join(REPO_ROOT, 'release', name)
    try {
      await fs.access(file)
    } catch {
      continue
    }
    const bytes = await fs.readFile(file)
    platforms[platform] = {
      url: `https://github.com/${REPO_SLUG}/releases/download/${releaseTag}/${name}`,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }
    break
  }
}

if (Object.keys(platforms).length === 0) {
  console.error('No release artifacts found in release/ for version ' + version + '.')
  console.error('')
  console.error('Looked for:')
  for (const names of Object.values(CANDIDATES)) {
    for (const n of names) console.error(`  ${n}`)
  }
  console.error('')
  console.error('Run a release build first (npm run release / release:linux / release:mac).')
  process.exit(1)
}

// ─── Write binary.json ──────────────────────────────────────────────
// `url` stays at the top level as a compatibility anchor: a page cached
// before per-platform CTAs existed reads it, and Netlify serves HTML
// with a short cache while `binary.json` is no-cache, so the two can be
// a few minutes apart. It mirrors Windows, the one build that has
// always existed.
const binaryJson = {
  version,
  ...(platforms.windows ? { url: platforms.windows.url } : {}),
  platforms,
}
const binaryPath = path.join(REPO_ROOT, 'landing', 'binary.json')
await fs.writeFile(binaryPath, JSON.stringify(binaryJson, null, 2) + '\n')

// ─── Report ─────────────────────────────────────────────────────────
console.log(`Updated ${path.relative(REPO_ROOT, binaryPath)}:`)
console.log(`  version  ${version}`)
for (const [platform, entry] of Object.entries(platforms)) {
  console.log(`  ${platform.padEnd(8)} ${entry.url}`)
  console.log(`  ${' '.repeat(8)} sha256 ${entry.sha256}`)
}
for (const platform of Object.keys(CANDIDATES)) {
  if (!platforms[platform]) console.log(`  ${platform.padEnd(8)} (not built: the page will offer source instead)`)
}
console.log('')
console.log('Next: commit landing/binary.json and push. The landing deploy')
console.log('workflow (CNX-725) will rebuild the page with the new CTA target.')
