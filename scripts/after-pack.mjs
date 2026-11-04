/**
 * electron-builder's `afterPack` hook: fuses first, then the macOS seal.
 *
 * Fuses are switches compiled into the Electron binary. Left at their
 * defaults, the installed app obeys `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`
 * and `--inspect`, so anyone could run Cernix.exe as a general Node
 * interpreter, or attach a debugger to it, under Cernix's name. Nothing
 * in the app uses any of them; the dev and test tools run the
 * `electron` package, not the packaged binary.
 *
 * Flipped here rather than through electron-builder's `electronFuses`
 * option, because of order. electron-builder flips its fuses after this
 * hook, and flipping rewrites the binary, so on macOS it would break the
 * ad-hoc seal `mac-adhoc-sign.mjs` has just put on the bundle, and an
 * arm64 Mac kills a binary whose signature does not match. Flipped
 * first, the seal covers the binary as it ships.
 */
import { FuseVersion, FuseV1Options } from '@electron/fuses'
import macAdhocSign from './mac-adhoc-sign.mjs'

export default async function afterPack(context) {
  await context.packager.addElectronFuses(context, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // The app is always packed into an asar (`build.asar`), so a loose
    // `resources/app` folder dropped beside it is never loaded instead.
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // Without this, OnlyLoadAppFromAsar does not stop a swapped app.asar
    // in a per-user install the user can write to: the asar's own hash is
    // checked against the one electron-builder embeds in the binary
    // (decision 13). Untested on an installed build from here.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  })
  await macAdhocSign(context)
}
