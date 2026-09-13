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
import fs from 'node:fs'

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

/**
 * Throw away whatever the previous pass built.
 *
 * `install-app-deps --arch=x64` reported success and left an arm64
 * module in the bundle, and the x64 dmg shipped a native module an Intel
 * Mac cannot load. electron-builder does pass `npm_config_arch=x64`, and
 * it sets `npm_config_force` only when the *platform* differs — darwin
 * to darwin is the same platform, so a cross-*architecture* pass runs
 * unforced over a tree that already holds the other architecture's
 * build.
 *
 * Removing it first means the pass has nothing to leave alone. Cheaper
 * than forcing every dependency to compile from source, which was the
 * other way to be sure and which makes Linux and Windows depend on a
 * toolchain to fix a macOS architecture.
 */
const moduleBuild = new URL('../node_modules/better-sqlite3/build', import.meta.url).pathname
if (fs.existsSync(moduleBuild)) {
  fs.rmSync(moduleBuild, { recursive: true, force: true })
  console.log(`\n  cleared the previous native build so ${arch} cannot inherit it`)
}

/**
 * Report the architecture of the native module at each stage.
 *
 * Three theories about why the x64 bundle carries an arm64 module have
 * each been wrong: a hardlink into node_modules, the trailing host
 * rebuild, and a stale build the arch pass declined to replace. Each was
 * reasoned from the outside and cost a run. electron-builder does pass
 * `npm_config_arch`, @electron/rebuild does pass `--arch` to
 * prebuild-install, and the module is still arm64 in the artifact — so
 * the answer is somewhere between those two facts, and guessing at it
 * from a Linux machine has stopped being useful.
 */
const nodeFile = new URL(
  '../node_modules/better-sqlite3/build/Release/better_sqlite3.node', import.meta.url).pathname
const archOf = (where) => {
  if (!fs.existsSync(nodeFile)) return console.log(`  [arch] ${where}: absent`)
  const out = spawnSync('lipo', ['-archs', nodeFile], { encoding: 'utf-8' })
  console.log(`  [arch] ${where}: ${(out.stdout || out.stderr || '?').trim()}`)
}

archOf('in node_modules, before install-app-deps')
run(`native modules for ${arch}`, bin, ['install-app-deps', `--arch=${arch}`])
archOf('in node_modules, after install-app-deps')
run(`packaging macOS ${arch}`, bin, ['--mac', `--${arch}`, '--publish', 'never'])
archOf('in node_modules, after packaging')
const packed = new URL(
  `../release/${arch === 'arm64' ? 'mac-arm64' : 'mac'}/Cernix.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node`,
  import.meta.url).pathname
if (fs.existsSync(packed)) {
  const out = spawnSync('lipo', ['-archs', packed], { encoding: 'utf-8' })
  console.log(`  [arch] inside the packed bundle: ${(out.stdout || out.stderr || '?').trim()}`)
}

console.log(`\n  macOS ${arch} built with ${arch} native modules.\n`)
