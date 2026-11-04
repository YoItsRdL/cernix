import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { UpdateStatus } from '../../shared/ipc-types'
import { UpdateService, CHECK_INTERVAL_MS, type UpdaterEngine } from './updater'

/** Stands in for electron-updater's autoUpdater, driven by the test. */
class FakeEngine extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  checks = 0
  installs: [boolean | undefined, boolean | undefined][] = []
  async checkForUpdates() { this.checks++ }
  quitAndInstall(silent?: boolean, runAfter?: boolean) { this.installs.push([silent, runAfter]) }
}

function setup(over: { packaged?: boolean; platform?: NodeJS.Platform; enabled?: boolean; busy?: string | null } = {}) {
  const engine = new FakeEngine()
  let enabled = over.enabled ?? true
  const sent: UpdateStatus[] = []
  const service = new UpdateService({
    engine: engine as unknown as UpdaterEngine,
    packaged: over.packaged ?? true,
    platform: over.platform ?? 'win32',
    readEnabled: () => enabled,
    writeEnabled: (e) => { enabled = e },
    busy: () => over.busy ?? null,
    send: (s) => sent.push(s),
    log: () => {},
  })
  return { engine, service, sent, isEnabled: () => enabled }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('UpdateService: when it asks', () => {
  it('checks at launch and on an interval', () => {
    const { engine, service } = setup()
    service.start()
    expect(engine.checks).toBe(1)
    vi.advanceTimersByTime(CHECK_INTERVAL_MS)
    expect(engine.checks).toBe(2)
    service.stop()
  })

  // The privacy promise: turned off means no request, not a quieter one.
  it('asks nothing when the user turned it off', async () => {
    const { engine, service } = setup({ enabled: false })
    service.start()
    await service.check()
    vi.advanceTimersByTime(CHECK_INTERVAL_MS * 3)
    expect(engine.checks).toBe(0)
  })

  it('asks nothing from a dev build', async () => {
    const { engine, service } = setup({ packaged: false })
    service.start()
    await service.check()
    expect(engine.checks).toBe(0)
    expect(service.status().supported).toBe(false)
  })

  it('stops asking the moment it is turned off, and resumes when turned on', () => {
    const { engine, service, isEnabled } = setup()
    service.start()
    service.setEnabled(false)
    expect(isEnabled()).toBe(false)
    vi.advanceTimersByTime(CHECK_INTERVAL_MS * 2)
    expect(engine.checks).toBe(1)
    service.setEnabled(true)
    expect(engine.checks).toBe(2)
    service.stop()
  })
})

describe('UpdateService: Windows and Linux install in place', () => {
  it('downloads on its own, then waits for a restart', () => {
    const { engine, service } = setup({ platform: 'win32' })
    expect(engine.autoDownload).toBe(true)
    engine.emit('update-available', { version: '1.3.0' })
    expect(service.status().state).toEqual({ kind: 'downloading', version: '1.3.0', percent: 0 })
    engine.emit('download-progress', { percent: 41.6 })
    expect(service.status().state).toEqual({ kind: 'downloading', version: '1.3.0', percent: 42 })
    engine.emit('update-downloaded', { version: '1.3.0' })
    expect(service.status().state).toEqual({ kind: 'ready', version: '1.3.0' })
  })

  it('restarts silently and comes back', () => {
    const { engine, service } = setup()
    engine.emit('update-downloaded', { version: '1.3.0' })
    expect(service.install()).toEqual({ ok: true })
    expect(engine.installs).toEqual([[true, true]])
  })

  it('refuses to restart in the middle of an upload, and says why', () => {
    const { engine, service } = setup({ busy: 'uploading to Drive' })
    engine.emit('update-downloaded', { version: '1.3.0' })
    const result = service.install()
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/uploading to Drive/)
    expect(engine.installs).toEqual([])
  })

  it('has nothing to install before a download finishes', () => {
    const { engine, service } = setup()
    engine.emit('update-available', { version: '1.3.0' })
    expect(service.install().ok).toBe(false)
    expect(engine.installs).toEqual([])
  })

  it('stops checking once an update is waiting', () => {
    const { engine, service } = setup()
    service.start()
    engine.emit('update-downloaded', { version: '1.3.0' })
    vi.advanceTimersByTime(CHECK_INTERVAL_MS * 2)
    expect(engine.checks).toBe(1)
    service.stop()
  })
})

describe('UpdateService: macOS announces', () => {
  it('never downloads, and points at the release', () => {
    const { engine, service } = setup({ platform: 'darwin' })
    expect(engine.autoDownload).toBe(false)
    expect(engine.autoInstallOnAppQuit).toBe(false)
    engine.emit('update-available', { version: '1.3.0' })
    expect(service.status().installsInPlace).toBe(false)
    expect(service.status().state).toEqual({
      kind: 'available', version: '1.3.0',
      releaseUrl: 'https://github.com/YoItsRdL/cernix/releases/tag/v1.3.0',
    })
  })
})

describe('UpdateService: failures', () => {
  // A raw "HttpError: 404 ... https://github.com/..." is for the log.
  it('tells the user a sentence, not the error', () => {
    const { engine, service, sent } = setup()
    engine.emit('error', new Error('HttpError: 404 "method: GET url: https://github.com/YoItsRdL/cernix/releases.atom"'))
    const state = service.status().state
    expect(state.kind).toBe('error')
    expect(state.kind === 'error' && state.message).not.toMatch(/HttpError|404|https/)
    expect(sent.at(-1)?.state.kind).toBe('error')
  })
})
