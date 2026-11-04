import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * The sidecar write is a write next to a path the renderer names. It has to
 * refuse out loud, and only ever for a photograph, not a folder.
 */

const handlers = new Map<string, (...a: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => { handlers.set(ch, fn) } },
  dialog: {},
  BrowserWindow: { getFocusedWindow: () => null },
  app: { getPath: () => os.tmpdir(), isPackaged: false },
}))

const { registerEditorHandlers } = await import('./editor-ipc')
const { DEFAULT_PARAMS } = await import('../../shared/edit-params')

function register(allowed: (p: string) => boolean) {
  handlers.clear()
  registerEditorHandlers(null, {} as never, {} as never, {} as never, {} as never, allowed, () => undefined)
}
const write = (p: string, params: unknown = { ...DEFAULT_PARAMS }) =>
  handlers.get('editor:write-params')!({}, p, params) as Promise<void>

describe('editor:write-params', () => {
  let dir: string
  let photo: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-xmp-'))
    photo = path.join(dir, 'a.jpg')
    fs.writeFileSync(photo, 'x')
  })

  it('says so when the path is not one the guard admits, and writes nothing', async () => {
    register(() => false)
    await expect(write(photo)).rejects.toThrow('may not save')
    expect(fs.existsSync(photo + '.xmp')).toBe(false)
  })

  it('refuses a folder, whose sidecar would land outside it', async () => {
    register(() => true)
    await expect(write(dir)).rejects.toThrow('next to a photograph')
    expect(fs.existsSync(dir + '.xmp')).toBe(false)
  })

  it('refuses parameters that are not numbers where numbers belong', async () => {
    register(() => true)
    await expect(write(photo, { ...DEFAULT_PARAMS, exposure: 'NaN' })).rejects.toThrow('exposure')
    expect(fs.existsSync(photo + '.xmp')).toBe(false)
  })

  it('still writes the sidecar for a photograph', async () => {
    register(() => true)
    await write(photo)
    expect(fs.existsSync(photo + '.xmp')).toBe(true)
  })
})
