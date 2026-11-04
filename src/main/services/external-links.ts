/**
 * Which links the window may hand to the user's browser.
 *
 * The handler used to pass any https URL to `shell.openExternal`, so a
 * hostile renderer could send data out through the browser's address
 * bar whatever the CSP said (F-036). The app itself only ever opens its
 * own Drive links and a few project pages, so that is all it forwards.
 */
import { SUPPORT_URL, RELEASES_URL } from '../constants'

const HOSTS = new Set(['drive.google.com', 'docs.google.com', 'cernix.app', 'www.cernix.app'])

/** Exact pages the app itself links to, beyond whole hosts. */
const PAGES = [SUPPORT_URL, RELEASES_URL]

export function isOpenableExternal(raw: string): boolean {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  if (HOSTS.has(url.hostname)) return true
  return PAGES.some(page => {
    const p = new URL(page)
    return url.hostname === p.hostname && (url.pathname === p.pathname || url.pathname.startsWith(p.pathname + '/'))
  })
}
