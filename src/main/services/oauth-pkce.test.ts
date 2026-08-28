import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { createFlowSecrets, matchesState } from './oauth-pkce'

/**
 * The flow these guard: the app opens a browser for Google consent and
 * listens on a fixed port 8899 for the redirect. Before this, it
 * resolved on the first `code` it saw, from anyone. A page the user had
 * open could deliver its own code during the five-minute window and
 * sign them into someone else's account, and their photographs would
 * upload to that account's Drive.
 */
describe('matchesState', () => {
  const issued = createFlowSecrets().state

  it('accepts the state it issued', () => {
    expect(matchesState(issued, issued)).toBe(true)
  })

  it('rejects a different state of the same length', () => {
    const forged = createFlowSecrets().state
    expect(forged).toHaveLength(issued.length)
    expect(matchesState(forged, issued)).toBe(false)
  })

  it('rejects a missing state rather than treating it as nothing to check', () => {
    expect(matchesState(null, issued)).toBe(false)
    expect(matchesState(undefined, issued)).toBe(false)
    expect(matchesState('', issued)).toBe(false)
  })

  // timingSafeEqual throws on a length mismatch instead of returning
  // false, so an unguarded comparison would surface as a crash on a
  // truncated callback rather than a rejection.
  it('returns false, not throws, when the lengths differ', () => {
    expect(() => matchesState(issued.slice(0, -1), issued)).not.toThrow()
    expect(matchesState(issued.slice(0, -1), issued)).toBe(false)
    expect(matchesState(issued + 'x', issued)).toBe(false)
  })
})

describe('createFlowSecrets', () => {
  it('never repeats a state or a verifier', () => {
    const states = new Set<string>()
    const verifiers = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const s = createFlowSecrets()
      states.add(s.state)
      verifiers.add(s.codeVerifier)
    }
    expect(states.size).toBe(200)
    expect(verifiers.size).toBe(200)
  })

  it('derives the challenge as the base64url SHA-256 of the verifier', () => {
    const { codeVerifier, codeChallenge } = createFlowSecrets()
    expect(codeChallenge)
      .toBe(createHash('sha256').update(codeVerifier).digest('base64url'))
  })

  // Anything outside [A-Za-z0-9-._~] has to be percent-encoded on the
  // consent URL, and a verifier that survives the round trip re-encoded
  // no longer matches its own challenge.
  it('produces URL-safe values that need no encoding', () => {
    const { state, codeVerifier, codeChallenge } = createFlowSecrets()
    for (const v of [state, codeVerifier, codeChallenge]) {
      expect(v).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(encodeURIComponent(v)).toBe(v)
    }
  })

  // RFC 7636 requires 43 to 128 characters. 32 random bytes is 43.
  it('sizes the verifier within the range Google accepts', () => {
    const { codeVerifier } = createFlowSecrets()
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43)
    expect(codeVerifier.length).toBeLessThanOrEqual(128)
  })
})
