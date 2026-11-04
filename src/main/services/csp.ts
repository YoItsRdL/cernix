/**
 * The renderer's Content Security Policy.
 *
 * This is the boundary that decides where a compromised renderer may
 * send a Drive token. It lived inline in `setupSecurityPolicy`, tangled
 * with the Electron session call, which made it unassertable: the only
 * way to know what the packaged app allows was to read it.
 *
 * Pure and parameterised on `isPackaged` so both policies can be
 * inspected, in particular the one that ships.
 */

export function buildContentSecurityPolicy(isPackaged: boolean): string {
  // `unsafe-eval` is Vite's dev transform, and `unsafe-inline` is the dev
  // server's React-refresh preamble. The built page loads one external
  // module script and has no inline script, so neither is needed in the
  // package, and either would widen any future XSS.
  const scriptSrc = isPackaged
    ? 'script-src \'self\'; '
    : 'script-src \'self\' \'unsafe-inline\' \'unsafe-eval\'; '

  // No Google host appears anywhere. The renderer never fetches from
  // Google: Drive thumbnails and video arrive through main (`drive:get-
  // thumbnail`, `cernix-media://drive`), as data URLs and as a custom
  // scheme that bypasses this policy. The allowlist was a way for a
  // compromised renderer to talk to Google with a token it should not
  // hold, for access the app never uses (F-036, decision 16).
  //
  // `cernix-media:` is in connect-src, not only img-src: EditorCanvas
  // fetch()es the source through it to get an ImageBitmap, and fetch
  // is governed by connect-src.
  //
  // The dev server's HMR heartbeat needs ws and localhost, gated on not
  // being packaged; carried into the package it meant any host at all.
  const connectSrc = isPackaged
    ? 'connect-src \'self\' cernix-media: blob:;'
    : 'connect-src \'self\' cernix-media: blob: ws: http://localhost:*;'

  return (
    'default-src \'self\'; ' +
    scriptSrc +
    'style-src \'self\' \'unsafe-inline\'; ' +
    // blob: is required for renderer-generated images, such as preset
    // thumbnails from `URL.createObjectURL`. Same-origin object URLs,
    // no external risk.
    'img-src \'self\' blob: data: cernix-media:; ' +
    'media-src \'self\' cernix-media: blob:; ' +
    // The typefaces are bundled (src/shared/fonts.css); nothing is fetched.
    'font-src \'self\' data:; ' +
    'object-src \'none\'; base-uri \'none\'; form-action \'none\'; ' +
    connectSrc
  )
}
