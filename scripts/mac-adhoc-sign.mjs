/**
 * Ad-hoc sign the macOS bundle, immediately after it is packed.
 *
 * Why this exists. Electron's binary arrives ad-hoc signed;
 * electron-builder then renames the executable and rewrites
 * `Info.plist` and does not re-seal. Unzipping the published 1.2.0 app:
 * the main executable carried `LC_CODE_SIGNATURE` and the bundle had no
 * `_CodeSignature/CodeResources` at all. To macOS that is contents which
 * no longer match their signature, so Gatekeeper reported:
 *
 *     "Cernix" is damaged and can't be opened. You should move it to
 *     the Trash.
 *
 * That dialog matters more than its rudeness: the ordinary unsigned-app
 * warning offers a way through, and this one offers only Move to Trash,
 * so a first-time user had no path forward at all.
 *
 * `mac.identity: null` tells electron-builder to skip signing, and "-"
 * does not help — `findIdentity` searches the keychain for that
 * qualifier, finds nothing, and skips anyway. So the sealing happens
 * here.
 *
 * ── One pass, with --deep ──
 *
 * Signed in a single `codesign --force --deep --sign -` over the whole
 * bundle, and this took three wrong turns to arrive at.
 *
 * Signing each nested item separately — which is what
 * @electron/osx-sign does, and what signing inside-out by hand does —
 * produces a bundle that verifies perfectly and cannot launch. On
 * macOS 26 the loader refuses it:
 *
 *     Library not loaded: @rpath/Electron Framework.framework/...
 *     not valid for use in process: mapping process and mapped file
 *     (non-platform) have different Team IDs
 *
 * Each separate ad-hoc signature is its own identity, and library
 * validation requires the framework's to match the executable's. One
 * pass over the bundle gives them all the same one. Confirmed on the
 * reporter's own machine: re-signing the installed app with exactly
 * this command turned a launch crash into a working app.
 *
 * `--deep` is deprecated by Apple for distribution signing. That
 * deprecation is about Developer ID and notarisation, neither of which
 * applies here, and the alternative it points to — signing each piece
 * individually — is precisely what does not work for ad-hoc.
 *
 * ── What this does and does not buy ──
 * Ad-hoc means signed by nobody, so macOS still warns once and `spctl`
 * still refuses. What it buys is a bundle whose seal is intact, which
 * turns an unrecoverable error into the normal warning with a way
 * through. A clean first run needs a Developer ID certificate and
 * notarisation, which costs money and is the user's call — the
 * "Code-signing certificate" open decision in AGENTS.md.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export default async function afterPack(context) {
  // Only macOS has codesign, and this hook runs for every platform.
  if (context.electronPlatformName !== 'darwin') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  if (!fs.existsSync(appPath)) {
    throw new Error(`ad-hoc signing: no bundle at ${appPath}`)
  }

  console.log(`  ad-hoc signing ${appName}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })

  // Verified rather than trusted, because the defect was a bundle that
  // looked built and was not sealed. `--deep` is wrong for signing and
  // right for verifying: it walks everything, which is what Gatekeeper
  // does. A seal that does not hold must fail the build rather than
  // reach a release page.
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit',
  })
  console.log(`  ${appName} is sealed`)
}
