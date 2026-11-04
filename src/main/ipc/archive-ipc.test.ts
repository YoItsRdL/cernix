import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * The flow the Settings screen drives: pick a folder, be told what moving
 * there means, then move. Run with the real handlers and real folders in
 * the temp directory, and a dialog that "picks" what the test says.
 */

const handlers = new Map<string, (...a: unknown[]) => unknown>()
let picked: string | null = null
let home = ''

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => { handlers.set(ch, fn) } },
  dialog: {
    showOpenDialog: async () => (picked ? { canceled: false, filePaths: [picked] } : { canceled: true, filePaths: [] }),
  },
  BrowserWindow: { getFocusedWindow: () => null },
  app: { getPath: (n: string) => (n === 'home' ? home : path.join(home, 'AppData')) },
}))

const { registerArchiveHandlers } = await import('./archive-ipc')

let base: string
let library: string
const sent: Array<[string, unknown]> = []

function fakeSweeper(initial: string) {
  let root = initial
  let frozen = false
  return {
    getLibraryRoot: () => root,
    setLibraryRoot: (p: string) => { root = p },
    isBusy: () => false,
    freeze: (on: boolean) => { frozen = on },
    get frozen() { return frozen },
  }
}

function setup(opts: { sweeperBusy?: boolean; uploading?: boolean } = {}) {
  handlers.clear(); sent.length = 0
  const sweeper = fakeSweeper(library)
  if (opts.sweeperBusy) sweeper.isBusy = () => true
  registerArchiveHandlers(null, sweeper as never, { isBusy: () => !!opts.uploading } as never, (ch: string, payload: unknown) => { sent.push([ch, payload]) })
  return sweeper
}
const pick = () => handlers.get('archive:pick-destination')!() as Promise<Record<string, unknown>>
const move = () => handlers.get('archive:move')!() as Promise<Record<string, unknown>>

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-archive-ipc-'))
  home = path.join(base, 'home')
  fs.mkdirSync(home)
  library = path.join(base, 'old', 'library')
  fs.mkdirSync(path.join(library, '2026', 'October', '24'), { recursive: true })
  fs.writeFileSync(path.join(library, '2026', 'October', '24', 'a.jpg'), 'aaaa')
  picked = path.join(base, 'disk', 'Photos')
  fs.mkdirSync(picked, { recursive: true })
})
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }) })

describe('archive:pick-destination and archive:move', () => {
  it('says what moving would mean, then moves it into a folder of its own and switches over', async () => {
    const sweeper = setup()
    const offer = await pick()
    expect(offer).toMatchObject({ destination: path.join(picked!, 'Cernix Archive'), files: 1, bytes: 4 })

    const done = await move()
    expect(done).toMatchObject({ ok: true, files: 1, leftovers: [] })
    expect(sweeper.getLibraryRoot()).toBe(path.join(picked!, 'Cernix Archive'))
    expect(fs.readFileSync(path.join(picked!, 'Cernix Archive', '2026', 'October', '24', 'a.jpg'), 'utf8')).toBe('aaaa')
    expect(fs.existsSync(path.join(library, '2026'))).toBe(false)
    expect(sweeper.frozen).toBe(false)
    expect(sent.some(([ch]) => ch === 'archive:progress')).toBe(true)
  })

  it('does nothing when the dialog is cancelled', async () => {
    setup(); picked = null
    expect(await pick()).toEqual({ cancelled: true })
    expect(await move()).toMatchObject({ error: expect.stringContaining('Choose a folder first') })
  })

  it('refuses to move without a pick, and the pick is good for one move only', async () => {
    setup()
    await pick(); await move()
    expect(await move()).toMatchObject({ error: expect.stringContaining('Choose a folder first') })
  })

  it('refuses a pick that is the profile folder', async () => {
    setup(); picked = home
    expect(await pick()).toMatchObject({ error: expect.stringContaining('too broad') })
  })

  it('refuses a folder inside the archive, and tells why', async () => {
    setup(); picked = path.join(library, '2026')
    expect(await pick()).toMatchObject({ error: expect.stringContaining('inside the archive') })
    expect(fs.existsSync(path.join(library, '2026', 'October', '24', 'a.jpg'))).toBe(true)
  })

  it('will not move while an import or an upload is running, and leaves the pick unused', async () => {
    setup({ sweeperBusy: true })
    await pick()
    expect(await move()).toMatchObject({ error: expect.stringContaining('still running') })
    expect(fs.existsSync(path.join(library, '2026', 'October', '24', 'a.jpg'))).toBe(true)

    setup({ uploading: true })
    await pick()
    expect(await move()).toMatchObject({ error: expect.stringContaining('still running') })
  })

  it('keeps the old archive and the old location when the copy cannot be completed', async () => {
    const sweeper = setup()
    await pick()
    // a link in the archive cannot be copied as a file, so the move is refused up front
    fs.symlinkSync(path.join(base, 'disk'), path.join(library, 'link'), 'junction')
    const reply = await move()
    expect(reply).toHaveProperty('error')
    expect(sweeper.getLibraryRoot()).toBe(library)
    expect(fs.existsSync(path.join(library, '2026', 'October', '24', 'a.jpg'))).toBe(true)
    expect(sweeper.frozen).toBe(false)
  })
})
