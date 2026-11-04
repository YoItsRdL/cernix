import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The sweep handlers must refuse a path the user never chose.
 *
 * `createPathGuard` is unit-tested next door; this asserts the wiring,
 * which is what was actually missing: the guard existed and both sweep
 * entry points handed the renderer's path straight to `FileSweeper`
 * without consulting it. The assertion that matters is not the return
 * value but that the sweeper is never reached, because reaching it is
 * the recursive scan.
 */

const handlers = new Map<string, (...a: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => { handlers.set(ch, fn) },
    // The synchronous channels (theme:get); none is under test here.
    on: () => {},
  },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, fromWebContents: () => null },
  shell: { openExternal: vi.fn(), trashItem: (p: string) => trashItem(p) },
  app: { getPath: () => 'C:\\Users\\test\\AppData\\Roaming\\Cernix' },
}))

const { registerSystemHandlers } = await import('./system-ipc')

const trashItem = vi.fn(async (_p: string) => undefined)
const scan = vi.fn(async () => [])
const sweep = vi.fn(async () => undefined)
const sent: Array<[string, unknown]> = []

function register(isAllowedPath: (p: string) => boolean) {
  handlers.clear(); sent.length = 0
  scan.mockClear(); sweep.mockClear()
  registerSystemHandlers(
    null,
    { getVolumes: () => [] } as never,
    {} as never,
    { scan, sweep, cancelAll: () => 0, on: () => undefined } as never,
    {} as never,
    {} as never,
    new Set<string>(),
    isAllowedPath,
    (ch: string, payload: unknown) => { sent.push([ch, payload]) }
  )
}

describe('sweep handlers refuse an unapproved path', () => {
  beforeEach(() => register((p: string) => p === 'D:\\Shoot'))

  it('sweep:scan does not reach the filesystem for a path the user never chose', async () => {
    const result = await handlers.get('sweep:scan')!({}, 'C:\\Users\\test\\Pictures')
    expect(scan).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('sweep:start does not reach the sweeper for a path the user never chose', async () => {
    await handlers.get('sweep:start')!({}, 'C:\\Users\\test\\Pictures', [], undefined)
    expect(sweep).not.toHaveBeenCalled()
  })

  // A silent refusal is indistinguishable from an empty card, so the
  // renderer has to be told the way every other sweep failure tells it.
  it('reports the refusal on sweep:error rather than failing silently', async () => {
    await handlers.get('sweep:scan')!({}, 'C:\\Windows\\System32')
    expect(sent.map(([ch]) => ch)).toContain('sweep:error')
  })

  it('still sweeps a path the user did choose', async () => {
    await handlers.get('sweep:scan')!({}, 'D:\\Shoot')
    expect(scan).toHaveBeenCalledWith('D:\\Shoot')
    await handlers.get('sweep:start')!({}, 'D:\\Shoot', ['a.arw'], undefined)
    expect(sweep).toHaveBeenCalled()
  })
})

type TrashResult = { trashedPaths: string[]; missingPaths: string[]; failures: { path: string; reason: string; message: string }[] }
const trash = (paths: string[]) =>
  handlers.get('media:trash')!({}, paths) as Promise<TrashResult>

describe('media:trash refuses a path the user never chose', () => {
  beforeEach(() => { register((p: string) => p === 'D:\\Shoot\\keep.arw'); trashItem.mockClear() })

  // Trash is destructive and irreversible from the app's side. It used
  // to carry its own copy of the root check; this asserts the shared
  // guard is really the one being asked now.
  it('does not trash a file outside the approved roots', async () => {
    const res = await trash(['C:\\Users\\test\\Documents\\taxes.pdf'])
    expect(trashItem).not.toHaveBeenCalled()
    expect(res.trashedPaths).toEqual([])
    expect(res.failures[0].reason).toBe('forbidden')
  })

  it('still trashes a file the guard admits', async () => {
    const res = await trash(['D:\\Shoot\\keep.arw'])
    expect(trashItem).toHaveBeenCalledWith('D:\\Shoot\\keep.arw')
    expect(res.trashedPaths).toEqual(['D:\\Shoot\\keep.arw'])
  })

  it('trashes only the admitted paths in a mixed batch', async () => {
    const res = await trash(['D:\\Shoot\\keep.arw', 'C:\\Windows\\System32\\x.dll'])
    expect(trashItem).toHaveBeenCalledTimes(1)
    expect(res.trashedPaths).toEqual(['D:\\Shoot\\keep.arw'])
    expect(res.failures).toHaveLength(1)
  })
})

describe('media:trash takes files, never a folder', () => {
  it('refuses a directory the guard admits, so one call cannot recycle a whole archive', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-trash-'))
    const file = path.join(dir, 'a.jpg')
    fs.writeFileSync(file, 'x')
    try {
      register(() => true)
      trashItem.mockClear()
      const res = await trash([dir, file])
      expect(trashItem).toHaveBeenCalledTimes(1)
      expect(trashItem).toHaveBeenCalledWith(file)
      expect(res.trashedPaths).toEqual([file])
      expect(res.failures.map(f => f.path)).toEqual([dir])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
