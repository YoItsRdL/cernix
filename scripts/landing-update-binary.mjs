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

const exeName = `Cernix-Setup-${version}.exe`
const exePath = path.join(REPO_ROOT, 'release', exeName)

try {
  await fs.access(exePath)
} catch {
  console.error(`Binary not found at ${exePath}`)
  console.error('')
  console.error('Run `npm run release` first to produce it, then re-run this script.')
  process.exit(1)
}

// ─── Compute sha256 ─────────────────────────────────────────────────
const exeBytes = await fs.readFile(exePath)
const sha256 = crypto.createHash('sha256').update(exeBytes).digest('hex')

// ─── Build the public URL ───────────────────────────────────────────
// Anchored to the GitHub Release page so the landing page works the
// moment the binary is uploaded. No CDN, no extra infrastructure.
const url = `https://github.com/${REPO_SLUG}/releases/download/${releaseTag}/${exeName}`

// ─── Write binary.json ──────────────────────────────────────────────
const binaryJson = { version, url, sha256 }
const binaryPath = path.join(REPO_ROOT, 'landing', 'binary.json')
await fs.writeFile(binaryPath, JSON.stringify(binaryJson, null, 2) + '\n')

// ─── Report ─────────────────────────────────────────────────────────
console.log(`Updated ${path.relative(REPO_ROOT, binaryPath)}:`)
console.log(`  version  ${version}`)
console.log(`  url      ${url}`)
console.log(`  sha256   ${sha256}`)
console.log('')
console.log('Next: commit landing/binary.json and push. The landing deploy')
console.log('workflow (CNX-725) will rebuild the page with the new CTA target.')
