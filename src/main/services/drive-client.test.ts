import { describe, it, expect, vi, afterEach } from 'vitest'
import { DriveClient } from './drive-client'

/**
 * The library root is remembered by id because a folder renamed in Drive
 * no longer matches a name search. Only Google saying the id is gone may
 * send the lookup to find-or-create: a blip read as "gone" made a new,
 * empty "Cernix" and remembered it in place of the real library.
 */
describe('DriveClient.getRootFolderId with a remembered id', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const setup = (checkRoot: () => Promise<Response>) => {
    const created: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      if (url.includes('/files/renamed-root')) return checkRoot()
      if (init?.method === 'POST') { created.push(url); return new Response(JSON.stringify({ id: 'new-root' })) }
      return new Response(JSON.stringify({ files: [] }))   // the name search finds nothing
    }))
    let remembered: string | null = 'renamed-root'
    const client = new DriveClient(async () => 'token', { get: () => remembered, set: (id) => { remembered = id } })
    return { client, created, remembered: () => remembered }
  }

  it('keeps the remembered root when the check times out', async () => {
    const s = setup(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') })
    await expect(s.client.getRootFolderId()).rejects.toThrow(/timeout/)
    expect(s.created, 'no new root made').toEqual([])
    expect(s.remembered()).toBe('renamed-root')
  })

  it('keeps it on a server error or a rate limit', async () => {
    for (const status of [503, 403]) {
      const s = setup(async () => new Response('busy', { status }))
      await expect(s.client.getRootFolderId(), String(status)).rejects.toThrow(String(status))
      expect(s.created, String(status)).toEqual([])
      expect(s.remembered()).toBe('renamed-root')
    }
  })

  it('finds or makes a root only when Google says the remembered one is gone', async () => {
    const s = setup(async () => new Response('not found', { status: 404 }))
    await expect(s.client.getRootFolderId()).resolves.toBe('new-root')
    expect(s.remembered()).toBe('new-root')
  })
})
