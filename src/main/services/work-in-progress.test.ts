import { describe, it, expect } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { tracked, runningWork } from './work-in-progress'

const event = {} as IpcMainInvokeEvent

describe('work in progress', () => {
  it('names the operation while it runs, and forgets it after', async () => {
    let release!: () => void
    const handler = tracked('exporting', () => new Promise<string>(r => { release = () => r('done') }))
    const call = handler(event)
    expect(runningWork()).toBe('exporting')
    release()
    expect(await call).toBe('done')
    expect(runningWork()).toBeNull()
  })

  // A failed export must not leave the app believing it is still busy,
  // or an update would never be allowed to install.
  it('forgets an operation that failed', async () => {
    const handler = tracked('organising Drive', async () => { throw new Error('offline') })
    await expect(handler(event)).rejects.toThrow('offline')
    expect(runningWork()).toBeNull()
  })

  it('passes the arguments through', async () => {
    const handler = tracked('moving', async (_e, ids: string[], target: string) => `${ids.length} to ${target}`)
    expect(await handler(event, ['a', 'b'], 'x')).toBe('2 to x')
  })
})
