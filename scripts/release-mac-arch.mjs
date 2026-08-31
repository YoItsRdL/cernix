#!/usr/bin/env node
/**
 * Build the macOS bundle for one architecture, with native modules
 * compiled for that architecture.
 *
 * Why this is not just `electron-builder --mac`: that builds arm64 and
 * x64 in a single pass out of one `node_modules`, and `node_modules`
 * can only hold one build of a native module at a time.
 * `install-app-deps` compiles `better-sqlite3` for the host, so the
 * other bundle ships a `.node` it cannot load and the app dies opening
 * its database:
 *
 *     dlopen(better_sqlite3.node): tried: … (mach-o file, but is an
 *     incompatible architecture (have 'x86_64', need 'arm64'))
 *
 * It does not show up building on one Mac for that same Mac, which is
 * why it survived local verification and only appeared when CI built
 * both at once. The release smoke test is what caught it, and the
 * artifact was withheld rather than published.
 *
 * So: one architecture per pass, native modules prepared immediately
 * before each. The caller is responsible for restoring the host's
 * modules afterwards — `npm run release:mac` ends with a bare
 * `install-app-deps` for exactly that reason, because leaving x64
 * modules behind on an Apple Silicon machine breaks `npm run dev` with
 * the mirror image of this bug.
 *
 * Usage:  node scripts/release-mac-arch.mjs --arch=arm64|x64
 */
import { spawnSync } from 'node:child_process'

const arg = process.argv.slice(2).find(a => a.startsWith('--arch='))
const arch = arg?.split('=')[1]

if (arch !== 'arm64' && arch !== 'x64') {
  console.error('Usage: node scripts/release-mac-arch.mjs --arch=arm64|x64')
  process.exit(2)
}

if (process.platform !== 'darwin') {
  console.error(`A macOS bundle cannot be built on ${process.platform}: code signing,`)
  console.error('the dmg tooling and the app bundle format are all macOS-only.')
  process.exit(2)
}

/** Run a command, inheriting stdio, and stop the build if it fails. */
function run(label, command, args) {
  console.log(`\n  ${label}\n  $ ${command} ${args.join(' ')}\n`)
  const { status, error } = spawnSync(command, args, { stdio: 'inherit', shell: false })
  if (error) {
    console.error(`\n  ${label} could not start: ${error.message}`)
    process.exit(1)
  }
  if (status !== 0) {
    console.error(`\n  ${label} failed with exit code ${status}.`)
    process.exit(status ?? 1)
  }
}

const builder = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
const bin = new URL(`../node_modules/.bin/${builder}`, import.meta.url).pathname

// Order matters: the modules have to match the bundle being built, so
// they are prepared immediately before it and not once at the top.
run(`native modules for ${arch}`, bin, ['install-app-deps', `--arch=${arch}`])
run(`packaging macOS ${arch}`, bin, ['--mac', `--${arch}`, '--publish', 'never'])

console.log(`\n  macOS ${arch} built with ${arch} native modules.\n`)
