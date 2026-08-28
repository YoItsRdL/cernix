import { describe, it, expect } from 'vitest'
import { buildContentSecurityPolicy } from './csp'

/**
 * The policy that decides where a compromised renderer may send a Drive
 * token.
 *
 * It is enforced by Chromium rather than by application code, which is
 * its strength and also why a mistake here is invisible: nothing throws,
 * a request simply becomes permitted. The dev build deliberately relaxes
 * two things, and the whole point is that the relaxations cannot reach a
 * packaged app.
 */

const packaged = () => buildContentSecurityPolicy(true)
const dev = () => buildContentSecurityPolicy(false)

/**
 * The sources listed for one directive.
 *
 * Split rather than matched. The first version built a RegExp from a
 * template literal, where `\s` is just `s`, so every lookup returned
 * empty and three tests failed against a policy that was correct.
 */
function directive(policy: string, name: string): string {
  const clause = policy.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' '))
  return clause ? clause.slice(name.length).trim() : ''
}

describe('the packaged Content Security Policy', () => {
  /**
   * The regression this guards. A wildcard was once carried from the dev
   * server's HMR heartbeat into the packaged policy, where it meant any
   * host at all, which turns a token reaching the renderer into a token
   * reaching a stranger.
   */
  it('lets the renderer connect only to Google, and to nothing wild', () => {
    const connect = directive(packaged(), 'connect-src')
    expect(connect).not.toContain('*;')
    expect(connect.split(/\s+/)).not.toContain('*')
    expect(connect).not.toContain('http://')
    expect(connect).not.toContain('ws:')
    // Named explicitly rather than pattern-matched. An allowlist test
    // whose pattern is looser than the allowlist proves nothing, and the
    // first version of this one accepted any host with a Google-ish
    // suffix while rejecting `oauth2.googleapis.com` for having a digit.
    const EXPECTED = new Set([
      '\'self\'', 'cernix-media:', 'blob:',
      'https://*.googleapis.com',
      'https://oauth2.googleapis.com',
      'https://accounts.google.com',
      'https://*.googleusercontent.com',
    ])
    for (const source of connect.split(/\s+/).filter(Boolean)) {
      expect(EXPECTED.has(source.replace(/;$/, '')), `unexpected connect-src source: ${source}`).toBe(true)
    }
  })

  it('does not allow unsafe-eval', () => {
    expect(packaged()).not.toContain('unsafe-eval')
  })

  it('never allows a plain http origin anywhere', () => {
    expect(packaged()).not.toMatch(/http:\/\//)
  })

  it('keeps every directive that the app needs to function', () => {
    for (const name of ['default-src', 'script-src', 'style-src', 'img-src', 'media-src', 'font-src', 'connect-src']) {
      expect(directive(packaged(), name), name).not.toBe('')
    }
  })

  // The editor fetches its source through this scheme to get an
  // ImageBitmap, and fetch is governed by connect-src. Dropping it from
  // there once left the editor unable to load a photograph at all.
  it('keeps cernix-media in connect-src, not only img-src', () => {
    expect(directive(packaged(), 'connect-src')).toContain('cernix-media:')
    expect(directive(packaged(), 'img-src')).toContain('cernix-media:')
  })
})

describe('the development policy', () => {
  it('relaxes exactly what the dev server needs, and only there', () => {
    expect(dev()).toContain('unsafe-eval')
    expect(directive(dev(), 'connect-src')).toContain('ws:')
    expect(directive(dev(), 'connect-src')).toContain('http://localhost:*')
  })

  /**
   * Every relaxation must be absent from the packaged policy. Asserted
   * as a set difference rather than one by one, so a relaxation added
   * later is caught without anyone remembering to extend this test.
   */
  it('adds nothing to the packaged policy that packaging does not remove', () => {
    const packagedSources = new Set(packaged().split(/[\s;]+/).filter(Boolean))
    const devOnly = dev().split(/[\s;]+/).filter(Boolean).filter(s => !packagedSources.has(s))
    expect(devOnly.sort()).toEqual(['\'unsafe-eval\'', 'http://localhost:*', 'ws:'])
  })
})
