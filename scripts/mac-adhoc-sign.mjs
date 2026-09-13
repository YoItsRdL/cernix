/**
 * Ad-hoc sign the macOS bundle, immediately after it is packed.
 *
 * Why this exists, precisely. Electron's own binary arrives ad-hoc
 * signed, and electron-builder then renames the executable and rewrites
 * `Info.plist` without re-sealing the bundle: the published 1.2.0 app
 * carried `LC_CODE_SIGNATURE` on its main executable and no
 * `_CodeSignature/CodeResources` at all. To macOS that is a bundle whose
 * contents no longer match its signature, which is indistinguishable
 * from tampering, so Gatekeeper reports:
 *
 *     "Cernix" is damaged and can't be opened. You should move it to
 *     the Trash.
 *
 * That is the wrong dialog to get, and not because it is rude. The
 * ordinary unsigned-app dialog offers a way through — right-click Open,
 * or Privacy & Security → Open Anyway. "Damaged" offers only Move to
 * Trash, so a first-time user has no path forward and every instruction
 * we published for macOS was useless to them.
 *
 * `mac.identity: null` tells electron-builder to skip signing outright,
 * and setting it to "-" does not help: `findIdentity` searches the
 * keychain for that qualifier, finds nothing, and skips anyway
 * (app-builder-lib/out/macPackager.js). So the sealing is done here.
 *
 * This does NOT make the app trusted. Ad-hoc means "signed by nobody",
 * so Gatekeeper still warns and the user still has to allow it once.
 * What it buys is a bundle whose seal is intact, which turns an
 * unrecoverable error into the normal warning. A clean first run needs a
 * Developer ID certificate and notarisation, which costs money and is
 * the user's decision — see "Code-signing certificate" in AGENTS.md.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export default async function afterPack(context) {
  // Only macOS has codesign, and only macOS needs this. Every other
  // platform's build must pass straight through untouched: this hook
  // runs for all three.
  if (context.electronPlatformName !== 'darwin') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  if (!fs.existsSync(appPath)) {
    throw new Error(`ad-hoc signing: no bundle at ${appPath}`)
  }

  // Signed inside-out, and deliberately not with `--deep`.
  //
  // `--deep` was the first attempt and it failed the same way twice, on
  // the same file:
  //
  //     file modified: .../app.asar.unpacked/node_modules/better-sqlite3/
  //                    build/Release/better_sqlite3.node
  //     Cernix.app: a sealed resource is missing or invalid
  //
  // A `.node` is a Mach-O living under `Contents/Resources`, so it is
  // both nested code and a sealed resource. `--deep` signs it, which
  // rewrites the file, after the enclosing bundle has already recorded
  // that resource's hash — so the seal describes the file as it was a
  // moment earlier. Apple deprecates `--deep` for exactly this class of
  // reason and says to sign nested code first and the bundle last, so
  // every hash is taken over a file that has stopped changing.
  const inner = []
  const resources = path.join(appPath, 'Contents', 'Resources')
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile() && e.name.endsWith('.node')) inner.push(full)
    }
  }
  if (fs.existsSync(resources)) walk(resources)

  // Then the helpers and frameworks, which are bundles of their own and
  // must be sealed before the app that contains them.
  const frameworks = path.join(appPath, 'Contents', 'Frameworks')
  if (fs.existsSync(frameworks)) {
    for (const e of fs.readdirSync(frameworks, { withFileTypes: true })) {
      if (e.name.endsWith('.app') || e.name.endsWith('.framework')) {
        inner.push(path.join(frameworks, e.name))
      }
    }
  }

  for (const target of inner) {
    execFileSync('codesign', ['--force', '--sign', '-', target], { stdio: 'inherit' })
  }
  console.log(`  sealed ${inner.length} nested items`)

  // The bundle last.
  execFileSync('codesign', ['--force', '--sign', '-', appPath], { stdio: 'inherit' })

  // Verified here rather than trusted, because the whole defect was a
  // bundle that looked built and was not sealed. `--deep` is right for
  // *verifying*: it walks everything and is what Gatekeeper does.
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit',
  })
  console.log(`  ${appName} is sealed`)
}
