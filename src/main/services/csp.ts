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

/**
 * Every host the app may reach. The only network peer is the user's own
 * Google Drive, plus the typeface.
 */
const GOOGLE_HOSTS = [
  'https://*.googleapis.com',
  'https://oauth2.googleapis.com',
  'https://accounts.google.com',
  'https://*.googleusercontent.com',
].join(' ')

export function buildContentSecurityPolicy(isPackaged: boolean): string {
  // `unsafe-eval` is Vite's dev transform. The built bundle does not
  // need it, and keeping it in production widens any future XSS.
  const scriptSrc = isPackaged
    ? 'script-src \'self\' \'unsafe-inline\'; '
    : 'script-src \'self\' \'unsafe-inline\' \'unsafe-eval\'; '

  // `cernix-media:` is in connect-src, not only img-src: EditorCanvas
  // fetch()es the source through it to get an ImageBitmap, and fetch
  // is governed by connect-src. Scoping this list without it left the
  // editor unable to load a photograph at all.
  //
  // The wildcard was added for the dev server's HMR heartbeat and
  // carried into the packaged policy, where it meant any host at all.
  // That is what turns a token reaching the renderer into a token
  // reaching a stranger, so the relaxation is gated on not being
  // packaged.
  const connectSrc = isPackaged
    ? `connect-src 'self' cernix-media: blob: ${GOOGLE_HOSTS};`
    : `connect-src 'self' cernix-media: blob: ${GOOGLE_HOSTS} ws: http://localhost:*;`

  return (
    'default-src \'self\' \'unsafe-inline\'; ' +
    scriptSrc +
    'style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; ' +
    // blob: is required for renderer-generated images, such as preset
    // thumbnails from `URL.createObjectURL`. Same-origin object URLs,
    // no external risk.
    'img-src \'self\' blob: data: cernix-media: https://*.googleusercontent.com https://*.googleapis.com; ' +
    'media-src \'self\' https://*.googleapis.com; ' +
    'font-src \'self\' data: https://fonts.gstatic.com; ' +
    connectSrc
  )
}
