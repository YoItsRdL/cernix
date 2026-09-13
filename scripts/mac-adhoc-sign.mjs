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

  // `--deep` is deprecated by Apple for distribution signing, and is
  // still the right tool for ad-hoc: it seals the helpers and frameworks
  // inside the bundle, which is exactly what was missing. There is no
  // notarisation here for its deprecation to matter to.
  //
  // No `--options runtime`: the hardened runtime is a prerequisite for
  // notarisation, and without notarisation it only removes the
  // entitlements Electron expects and buys nothing.
  console.log(`  ad-hoc signing ${appName}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })

  // Verified here rather than trusted, because the whole defect was a
  // bundle that looked built and was not sealed. A signature that does
  // not verify must fail the build rather than reach a release page.
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit',
  })
  console.log(`  ${appName} is sealed`)
}
