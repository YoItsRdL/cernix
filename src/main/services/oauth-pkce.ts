import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

/**
 * The two per-flow secrets a Google consent round needs, and the check
 * that binds the callback back to it.
 *
 * Separate from `google-auth.ts` because that module imports Electron
 * and so cannot be loaded under Vitest. The same reason `upload-key.ts`
 * is its own file.
 */

/** One consent round's secrets. Generated per call, never stored on the
 *  service: two concurrent sign-ins sharing a field would each verify
 *  against the other's value. */
export interface FlowSecrets {
  /** Round-trips through the consent URL and back on the callback. */
  state: string
  /** Kept locally; proves at exchange time that this process asked. */
  codeVerifier: string
  /** The verifier's SHA-256, sent on the consent URL. */
  codeChallenge: string
}

export function createFlowSecrets(): FlowSecrets {
  // 32 bytes rather than 16: this is the only thing standing between a
  // forged callback and a token, and the cost of the extra entropy is a
  // longer query string.
  const state = randomBytes(32).toString('base64url')
  const codeVerifier = randomBytes(32).toString('base64url')
  // base64url already, so it is not re-encoded. Doing so would produce
  // a challenge Google cannot match against the verifier.
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { state, codeVerifier, codeChallenge }
}

/**
 * Constant-time comparison of a callback's `state` against the one
 * issued.
 *
 * `timingSafeEqual` throws rather than returning false when the buffers
 * differ in length, so the length is checked first and both branches
 * fail closed. A missing `state` is a mismatch, not a special case:
 * treating absence as "nothing to check" is the usual way this defence
 * is lost.
 */
export function matchesState(received: string | null | undefined, expected: string): boolean {
  if (!received) return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
