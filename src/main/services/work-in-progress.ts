/**
 * The long operations a restart must not cut short.
 *
 * An update installs by quitting the app, and quitting in the middle of
 * an export, a download or a reorganisation of Drive leaves a file half
 * written or a folder tree half moved. Sweeps and uploads already know
 * whether they are running (their services hold their sessions); this
 * covers the operations that live only as long as one IPC call.
 */
import type { IpcMainInvokeEvent } from 'electron'

const running = new Map<number, string>()
let nextId = 0

/** Wraps an IPC handler so the app knows, while it runs, what it is doing. */
export function tracked<A extends unknown[], R>(
  what: string,
  handler: (event: IpcMainInvokeEvent, ...args: A) => Promise<R>,
): (event: IpcMainInvokeEvent, ...args: A) => Promise<R> {
  return async (event, ...args) => {
    const id = nextId++
    running.set(id, what)
    try {
      return await handler(event, ...args)
    } finally {
      running.delete(id)
    }
  }
}

/** What is running now, in words, or null when nothing is. */
export function runningWork(): string | null {
  for (const what of running.values()) return what
  return null
}
