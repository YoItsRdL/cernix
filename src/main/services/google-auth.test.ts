import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

/**
 * The credential path.
 *
 * The refresh token here is long-lived access to a photographer's Drive.
 * Two properties are worth pinning: it never sits on disk in a form
 * anything else can read, and it never leaves the main process through
 * the status the renderer is handed.
 *
 * The OAuth flow itself is covered by `oauth-pkce.test.ts` and the
 * state binding by CNX-1832. This is about what happens to the token
 * once it exists.
 */

let userData: string

// A stand-in for the OS keychain. Reversible so the round-trip can be
// asserted, and tagged so the test can prove the bytes on disk are not
// the plaintext JSON.
const CIPHER_TAG = Buffer.from('ENC:')

// Steerable, so the Linux case where Chromium reports encryption as
// available while selecting a hardcoded key can be reproduced. Reset in
// beforeEach; the default is a working keychain.
const keychain = { available: true, backend: undefined as string | undefined }

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  shell: { openExternal: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => keychain.available,
    getSelectedStorageBackend: () => keychain.backend,
    encryptString: (s: string) => Buffer.concat([CIPHER_TAG, Buffer.from(s, 'utf8').reverse()]),
    decryptString: (b: Buffer) => {
      if (!b.subarray(0, 4).equals(CIPHER_TAG)) throw new Error('not our ciphertext')
      return Buffer.from(b.subarray(4)).reverse().toString('utf8')
    },
  },
}))

const { GoogleAuthManager } = await import('./google-auth')

const TOKENS = {
  access_token: 'ya29.SECRET-ACCESS',
  refresh_token: '1//SECRET-REFRESH',
  token_type: 'Bearer',
  expiry_date: Date.now() + 3600_000,
  scope: 'https://www.googleapis.com/auth/drive.file',
}

type Innards = {
  tokens: typeof TOKENS | null
  saveTokensToDisk(): void
  loadTokensFromDisk(): typeof TOKENS | null
  deleteTokensFromDisk(): void
  isTokenExpired(): boolean
}
const inner = (m: unknown) => m as unknown as Innards
const tokenFile = () => path.join(userData, 'auth-tokens.enc')

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-auth-'))
  keychain.available = true
  keychain.backend = undefined
})
afterEach(() => { fs.rmSync(userData, { recursive: true, force: true }) })

describe('GoogleAuthManager token storage', () => {
  it('round-trips the tokens through the keychain', () => {
    const m = inner(new GoogleAuthManager())
    m.tokens = { ...TOKENS }
    m.saveTokensToDisk()
    expect(m.loadTokensFromDisk()).toEqual(TOKENS)
  })

  /**
   * The property that matters. A token file readable by anything that
   * can read the user's profile directory is the same as no encryption
   * at all, and this is the kind of regression a refactor introduces
   * quietly by dropping the safeStorage call.
   */
  it('never writes a token in a form anything can read', () => {
    const m = inner(new GoogleAuthManager())
    m.tokens = { ...TOKENS }
    m.saveTokensToDisk()

    const raw = fs.readFileSync(tokenFile())
    const asText = raw.toString('utf8')
    expect(asText).not.toContain('SECRET-ACCESS')
    expect(asText).not.toContain('SECRET-REFRESH')
    expect(asText).not.toContain('refresh_token')
    expect(() => JSON.parse(asText)).toThrow()
  })

  // A token file from another machine, another OS user, or a half-written
  // one must not take the app down on launch.
  it('returns null rather than throwing on a file it cannot decrypt', () => {
    const m = inner(new GoogleAuthManager())
    for (const junk of [Buffer.from(''), Buffer.from('plain text'), Buffer.from(JSON.stringify(TOKENS))]) {
      fs.writeFileSync(tokenFile(), junk)
      expect(() => m.loadTokensFromDisk()).not.toThrow()
      expect(m.loadTokensFromDisk()).toBeNull()
    }
  })

  it('returns null when there is no token file', () => {
    expect(inner(new GoogleAuthManager()).loadTokensFromDisk()).toBeNull()
  })

  it('removes the token file on disconnect', () => {
    const m = inner(new GoogleAuthManager())
    m.tokens = { ...TOKENS }
    m.saveTokensToDisk()
    expect(fs.existsSync(tokenFile())).toBe(true)
    m.deleteTokensFromDisk()
    expect(fs.existsSync(tokenFile())).toBe(false)
  })
})

describe('GoogleAuthManager status and expiry', () => {
  /**
   * `getStatus` crosses the bridge to the renderer. Whatever it returns
   * is readable by the page, so a token added to it later would put a
   * live credential where the CSP is the only thing standing between it
   * and the network.
   */
  it('hands the renderer no credential material', () => {
    const m = new GoogleAuthManager()
    inner(m).tokens = { ...TOKENS }
    const status = m.getStatus()
    const serialised = JSON.stringify(status)
    expect(serialised).not.toContain('SECRET-ACCESS')
    expect(serialised).not.toContain('SECRET-REFRESH')
    expect(Object.keys(status).sort()).toEqual(['avatar', 'connected', 'email', 'expiresAt'])
  })

  it('reports disconnected with no tokens', () => {
    const m = new GoogleAuthManager()
    expect(m.getStatus().connected).toBe(false)
    expect(m.isConnected()).toBe(false)
  })

  // Refreshing five minutes early is the point: a token that expires
  // mid-upload fails a chunk that was already in flight.
  it('treats a token as expired five minutes before it actually is', () => {
    const m = inner(new GoogleAuthManager())

    m.tokens = { ...TOKENS, expiry_date: Date.now() + 10 * 60_000 }
    expect(m.isTokenExpired(), 'ten minutes left').toBe(false)

    m.tokens = { ...TOKENS, expiry_date: Date.now() + 4 * 60_000 }
    expect(m.isTokenExpired(), 'four minutes left, inside the skew').toBe(true)

    m.tokens = { ...TOKENS, expiry_date: Date.now() - 1000 }
    expect(m.isTokenExpired(), 'already past').toBe(true)

    m.tokens = null
    expect(m.isTokenExpired(), 'no token at all').toBe(true)
  })
})

/**
 * What happens when the OS cannot really encrypt.
 *
 * This is Linux-specific in cause and not in consequence. Chromium
 * picks its keystore from the desktop environment, and on one it does
 * not recognise it selects a `basic_text` backend whose key is a
 * constant in Chromium's own source — the same on every machine. A
 * refresh token sealed with that is a refresh token in plaintext.
 *
 * The policy is that the token is not written at all rather than
 * written weakly, so the sibling test above — "never writes a token in
 * a form anything can read" — stays true on every platform.
 */
describe('GoogleAuthManager without a usable keychain', () => {
  const platform = process.platform
  const asLinux = () => Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  afterEach(() => Object.defineProperty(process, 'platform', { value: platform, configurable: true }))

  it('writes nothing when Chromium fell back to its hardcoded key', () => {
    asLinux()
    keychain.backend = 'basic_text'
    const m = new GoogleAuthManager()
    inner(m).tokens = { ...TOKENS }
    inner(m).saveTokensToDisk()
    expect(fs.existsSync(tokenFile())).toBe(false)
  })

  it('writes nothing when the OS reports no encryption at all', () => {
    keychain.available = false
    const m = new GoogleAuthManager()
    inner(m).tokens = { ...TOKENS }
    inner(m).saveTokensToDisk()
    expect(fs.existsSync(tokenFile())).toBe(false)
  })

  it('tells the user, rather than only the console it does not have', () => {
    asLinux()
    keychain.backend = 'basic_text'
    const m = new GoogleAuthManager()
    const errors: { message: string }[] = []
    m.on('auth:error', e => errors.push(e))
    inner(m).tokens = { ...TOKENS }
    inner(m).saveTokensToDisk()
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/reconnect next launch/i)
  })

  it('says it once, not on every token refresh', () => {
    asLinux()
    keychain.backend = 'basic_text'
    const m = new GoogleAuthManager()
    const errors: unknown[] = []
    m.on('auth:error', e => errors.push(e))
    inner(m).tokens = { ...TOKENS }
    inner(m).saveTokensToDisk()
    inner(m).saveTokensToDisk()
    inner(m).saveTokensToDisk()
    expect(errors).toHaveLength(1)
  })

  it('still writes on a Linux host with a real keyring', () => {
    asLinux()
    keychain.backend = 'gnome_libsecret'
    const m = new GoogleAuthManager()
    inner(m).tokens = { ...TOKENS }
    inner(m).saveTokensToDisk()
    expect(fs.existsSync(tokenFile())).toBe(true)
    expect(fs.readFileSync(tokenFile()).includes(Buffer.from(TOKENS.refresh_token))).toBe(false)
  })

  it('does not consult the Linux backend on Windows, where DPAPI is always there', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    keychain.backend = 'basic_text'   // would be refused if it were read
    const m = new GoogleAuthManager()
    inner(m).tokens = { ...TOKENS }
    inner(m).saveTokensToDisk()
    expect(fs.existsSync(tokenFile())).toBe(true)
  })
})
