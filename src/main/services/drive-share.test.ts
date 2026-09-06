import { describe, it, expect, afterEach, vi } from 'vitest'
import { DriveClient } from './drive-client'

/**
 * What a refused share tells you.
 *
 * `setPublic` grants `anyone` reader access so a photographer can hand a
 * client a link. `drive.file` is a deliberately narrow scope and that is
 * exactly the sort of call it can refuse, so the difference between a
 * scope error, a permissions error and a rate limit is the only thing
 * that makes the failure actionable — and Google puts it in the body,
 * not the status.
 *
 * The message used to be the status alone. The renderer then swallowed
 * the rejection entirely, so the Share button went "Sharing…" and back
 * with nothing shown. Both halves are fixed; this covers the half that
 * can be tested without a browser.
 */
const client = () => new DriveClient(async () => 'token')

const respondWith = (status: number, body: string) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => ({}),
  })))
}

afterEach(() => vi.unstubAllGlobals())

describe('setPublic', () => {
  it('carries the body Google sends, not just the status', async () => {
    respondWith(403, 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')
    await expect(client().setPublic('folder-1'))
      .rejects.toThrow(/ACCESS_TOKEN_SCOPE_INSUFFICIENT/)
  })

  it('still reports the status, so the class of failure is visible', async () => {
    respondWith(403, 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')
    await expect(client().setPublic('folder-1')).rejects.toThrow(/403/)
  })

  it('distinguishes two failures that share a status code', async () => {
    // The whole point: a 403 for a missing scope and a 403 for a
    // permission are the same number and different problems.
    respondWith(403, 'insufficientFilePermissions')
    await expect(client().setPublic('folder-1'))
      .rejects.toThrow(/insufficientFilePermissions/)
  })

  it('resolves when Drive accepts', async () => {
    respondWith(200, '')
    await expect(client().setPublic('folder-1')).resolves.toBeUndefined()
  })
})
