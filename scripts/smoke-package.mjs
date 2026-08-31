#!/usr/bin/env node
/**
 * Launches the packaged app and checks it stays up.
 *
 * A build can succeed and still produce a binary that dies on startup.
 * A bad `asarUnpack`, a missing runtime file, a throw during module
 * evaluation. None of that shows up in `electron-builder`'s output, and
 * a GUI-subsystem Windows app writes nothing to a console, so the
 * failure is silent. This is the check that notices.
 *
 * The Linux build has more to get wrong here, not less: better-sqlite3
 * is rebuilt against the Electron ABI per platform, and a mismatch does
 * not surface until the app opens its database at startup.
 *
 * Usage:  node scripts/smoke-package.mjs [--dir release/linux-unpacked] [--seconds 12]
 *
 * `--dir` defaults to the unpacked directory electron-builder writes for
 * the host platform, so the same `npm run smoke` follows the same
 * `npm run release` on either.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

// electron-builder writes the mac bundle into a per-architecture
// directory — `mac-arm64` on Apple Silicon, `mac` on Intel — and builds
// both when asked for both. Probing beats guessing: on an arm64 Mac that
// also produced an x64 build, the native one is the one worth smoking.
function defaultAppDir() {
  if (process.platform === 'win32') return 'release/win-unpacked'
  if (process.platform === 'linux') return 'release/linux-unpacked'
  const macDirs = process.arch === 'arm64'
    ? ['release/mac-arm64', 'release/mac']
    : ['release/mac', 'release/mac-arm64']
  return macDirs.find(d => existsSync(path.resolve(d))) ?? macDirs[0]
}

const appDir = path.resolve(argOf('--dir', defaultAppDir()))
const seconds = Number(argOf('--seconds', '12'))

function fail(msg) {
  console.error(`\n  SMOKE FAILED: ${msg}\n`)
  process.exit(1)
}

if (!existsSync(appDir)) fail(`no packaged app at ${appDir}: run the build first`)

// electron-builder names the Linux binary after the product, lowercased.
// macOS keeps the capital inside the .app bundle.
const exeName = {
  win32: 'Cernix.exe',
  linux: 'cernix',
  darwin: 'Cernix.app/Contents/MacOS/Cernix',
}[process.platform] ?? 'Cernix'
const exe = path.join(appDir, exeName)
if (!existsSync(exe)) fail(`no ${exeName} in ${appDir}`)

const userData = mkdtempSync(path.join(tmpdir(), 'cernix-smoke-'))

// ELECTRON_RUN_AS_NODE makes any Electron binary run as plain Node: no
// window, no userData, instant exit. Inherited from the caller's shell
// it would make this check fail on a perfectly good build, which has
// happened. Strip it rather than trusting the environment.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

console.log(`  launching ${exeName}`)
console.log(`  userData  ${userData}`)

const child = spawn(exe, [`--user-data-dir=${userData}`], {
  env,
  cwd: tmpdir(), // never the build tree
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false,
})

let exitedEarly = null
child.on('exit', (code, signal) => { exitedEarly = { code, signal } })
child.on('error', (err) => fail(`could not start: ${err.message}`))

let stderr = ''
child.stderr?.on('data', (d) => { stderr += d.toString() })

await new Promise((r) => setTimeout(r, seconds * 1000))

if (exitedEarly) {
  const crash = path.join(userData, 'startup-error.log')
  const detail = existsSync(crash) ? `\n\n  startup-error.log:\n${readFileSync(crash, 'utf8')}` : ''
  fail(
    `exited after less than ${seconds}s ` +
    `(code=${exitedEarly.code}, signal=${exitedEarly.signal})` +
    (stderr.trim() ? `\n\n  stderr:\n${stderr.trim()}` : '') +
    detail,
  )
}

// Still alive. Confirm it did real work rather than idling in a
// half-initialised state: Electron writes its own files into userData,
// and Cernix creates its SQLite databases during initialize().
const entries = readdirSync(userData)
if (entries.length === 0) fail('process is alive but wrote nothing to userData')

const dbs = entries.filter((f) => f.endsWith('.db'))

child.kill()

// Staying alive is not the same as starting cleanly: an exception after
// module load leaves the process up with no window. main's fatal handler
// records those, so treat any startup-error.log as a failure.
const crashLog = path.join(userData, 'startup-error.log')
if (existsSync(crashLog)) {
  fail(`the app logged a startup error:\n\n${readFileSync(crashLog, 'utf8')}`)
}

console.log(`  alive after ${seconds}s, ${entries.length} entries in userData`)
console.log(`  databases: ${dbs.length ? dbs.join(', ') : 'none yet'}`)
console.log('\n  SMOKE PASSED\n')
