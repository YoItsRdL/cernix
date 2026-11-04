import { describe, it, expect } from 'vitest'
import { isGoogleMediaUrl, escapeDriveQueryValue, isDriveFileId, describeTrashFailure } from './drive-client'

/**
 * The guard on `getThumbnailBase64`. That method attaches a live Drive
 * bearer token to whatever URL the renderer names, from the main
 * process, where the page's CSP does not apply, so a URL that slips
 * past this check is a credential handed to a stranger.
 */
describe('isGoogleMediaUrl', () => {
  it('accepts the hosts Drive thumbnails actually come from', () => {
    for (const u of [
      'https://lh3.googleusercontent.com/abc=s220',
      'https://drive.google.com/thumbnail?id=x',
      'https://googleusercontent.com/x',
    ]) expect(isGoogleMediaUrl(u), u).toBe(true)
  })

  // Other Google hosts are Google's, and a thumbnail is not on them: the
  // API, the account pages and every other google.com subdomain would
  // each be handed the token.
  it('rejects Google hosts that do not serve thumbnails', () => {
    for (const u of [
      'https://www.googleapis.com/drive/v3/files/x?alt=media',
      'https://accounts.google.com/o/oauth2/revoke',
      'https://mail.google.com/x',
      'https://sites.google.com/x',
    ]) expect(isGoogleMediaUrl(u), u).toBe(false)
  })

  // The failure this shape of check is famous for: a substring match
  // treats an attacker's subdomain as Google's.
  it('rejects a host that merely contains a Google domain', () => {
    for (const u of [
      'https://googleapis.com.attacker.example/collect',
      'https://lh3.googleusercontent.com.evil.test/x',
      'https://notgoogleapis.com/x',
      'https://google.com.evil.test/x',
    ]) expect(isGoogleMediaUrl(u), u).toBe(false)
  })

  it('rejects anything not https, so the token cannot go in clear', () => {
    expect(isGoogleMediaUrl('http://lh3.googleusercontent.com/x')).toBe(false)
    expect(isGoogleMediaUrl('file:///C:/Windows/win.ini')).toBe(false)
    expect(isGoogleMediaUrl('data:text/plain,x')).toBe(false)
  })

  it('rejects an unparseable or empty URL rather than throwing', () => {
    for (const u of ['', 'not a url', '//lh3.googleusercontent.com/x'])
      expect(() => isGoogleMediaUrl(u)).not.toThrow()
    for (const u of ['', 'not a url', '//lh3.googleusercontent.com/x'])
      expect(isGoogleMediaUrl(u), u).toBe(false)
  })

  it('is case-insensitive on the host, as DNS is', () => {
    expect(isGoogleMediaUrl('https://LH3.GoogleUserContent.COM/x')).toBe(true)
  })
})

/**
 * Drive's `q=` filter delimits strings with single quotes and offers no
 * other way to express one, so an unescaped name or id carrying a quote
 * closes the literal and the remainder is parsed as query syntax.
 */
describe('escapeDriveQueryValue', () => {
  it('leaves an ordinary name untouched', () => {
    expect(escapeDriveQueryValue('Wedding 2026')).toBe('Wedding 2026')
  })

  it('escapes a quote so it cannot close the literal', () => {
    expect(escapeDriveQueryValue('Ana\'s shoot')).toBe('Ana\\\'s shoot')
  })

  // The injection this exists for: unescaped, the trailing clause
  // becomes query syntax and the filter matches far more than asked.
  it('neutralises a break-out attempt', () => {
    const escaped = escapeDriveQueryValue('x\' or name != \'')
    expect(escaped).not.toMatch(/(?<!\\)'/)
  })

  // Backslashes must be doubled first, or the ones added for quotes get
  // escaped in turn and the result is wrong.
  it('doubles backslashes before escaping quotes', () => {
    expect(escapeDriveQueryValue('a\\b')).toBe('a\\\\b')
    expect(escapeDriveQueryValue('a\\\'b')).toBe('a\\\\\\\'b')
  })
})

describe('isDriveFileId', () => {
  it('takes what a Drive id is made of', () => {
    expect(isDriveFileId('1AbC_dEf-GhIjKlMnOpQrStUvWxYz0123456')).toBe(true)
  })
  it('refuses anything that could steer the request elsewhere', () => {
    for (const id of ['', 'a', '../about', 'abc/def', 'abcdef?alt=json', 'abc def', 'x'.repeat(200)])
      expect(isDriveFileId(id), id).toBe(false)
  })
})

describe('describeTrashFailure', () => {
  const body = '{ "error": { "errors": [ { "reason": "appNotAuthorizedToChild" } ] } }'

  it('says in words why a folder with items the app cannot write will not trash', () => {
    const text = describeTrashFailure(true, 403, body)
    expect(text).toMatch(/no write access/)
    expect(text).not.toMatch(/appNotAuthorizedToChild|\{/)
  })

  it('keeps Google\'s own text for every other failure', () => {
    expect(describeTrashFailure(true, 404, 'gone')).toBe('Trash failed (404): gone')
    expect(describeTrashFailure(false, 403, body)).toBe(`Untrash failed (403): ${body}`)
  })
})
