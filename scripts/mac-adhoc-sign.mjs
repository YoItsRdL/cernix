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
 * ── Why @electron/osx-sign and not codesign directly ──
 *
 * Two hand-rolled attempts failed, each on a real ordering rule:
 *
 *   `codesign --deep` — a `.node` is a Mach-O under `Contents/Resources`,
 *   so it is both nested code and a sealed resource. `--deep` signs it,
 *   rewriting the file, after the bundle recorded that resource's hash,
 *   leaving "a sealed resource is missing or invalid" on exactly that
 *   file. Apple deprecates `--deep` for this class of reason.
 *
 *   Signing inside-out by hand — "Electron Framework.framework: code
 *   object is not signed at all, In subcomponent: .../Helpers/
 *   chrome_crashpad_handler". Frameworks contain their own nested
 *   helpers and dylibs, so one level of "inside" is not enough.
 *
 * The order is the whole problem, and it is a solved one: this is the
 * library electron-builder itself signs with. Hand-rolling it again
 * would be writing a third implementation of something already correct.
 *
 * ── What this does and does not buy ──
 *
 * Ad-hoc means signed by nobody, so macOS still warns once and `spctl`
 * still refuses. What it buys is a bundle whose seal is intact, which
 * turns an unrecoverable error into the normal warning with a way
 * through. A clean first run needs a Developer ID certificate and
 * notarisation, which costs money and is the user's call — the
 * "Code-signing certificate" open decision in AGENTS.md.
 */
import { execFileSync } from 'node:child_process'
import { sign } from '@electron/osx-sign'
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
  await sign({
    app: appPath,
    // "-" is codesign's ad-hoc identity. `identityValidation: false` is
    // required with it: the default searches the keychain for a
    // certificate matching the string, and there is no certificate
    // called "-" to find.
    identity: '-',
    identityValidation: false,
    platform: 'darwin',
    // No hardened runtime: it is a prerequisite for notarisation, and
    // without notarisation it only removes entitlements Electron wants.
    ignore: [],
  })

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
