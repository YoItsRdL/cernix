/**
 * What the user did, in the Output drawer.
 *
 * The drawer began as a diagnostic surface fed only by the main process:
 * sweep progress, upload progress, and whatever `sys:log` carried. That
 * left the half of the app the user actually operates invisible. Moving a
 * hundred files logged "Moving 100 item(s)…" and then a progress count,
 * naming neither the files nor where they went, so the one question the
 * log exists to answer — what happened to my photographs — was the one it
 * could not answer.
 *
 * A renderer-side bus rather than an IPC round trip. The renderer is the
 * only side that knows the names, the folder it is looking at and the
 * trail that led there; main sees ids. Sending a line to main so it could
 * send it back would also mean exposing a general-purpose `log(string)`
 * across the bridge, which is exactly the shape `main-process.md` refuses:
 * expose the operation, not the capability.
 *
 * Nothing here leaves the process or reaches disk, matching the drawer's
 * existing promise.
 */

export type ActivityLevel = 'info' | 'warn' | 'error' | 'success'

/** Matches the drawer's existing source tints; no new ones are invented. */
export type ActivitySource = 'drive' | 'sweep' | 'editor' | 'system'

export interface Activity {
  level: ActivityLevel
  source: ActivitySource
  message: string
}

type Listener = (entry: Activity) => void

const listeners = new Set<Listener>()

/**
 * Record something the user did.
 *
 * Never throws: a log line must not be able to take down the action it
 * describes. A listener that fails is reported to the console and the
 * remaining listeners still run.
 */
export function logActivity(source: ActivitySource, level: ActivityLevel, message: string): void {
  for (const listener of [...listeners]) {
    try {
      listener({ level, source, message })
    } catch (err) {
      console.error('[activity-log] listener threw', err)
    }
  }
}

/** Subscribe. Returns the unsubscribe, like the IPC helpers next to it. */
export function onActivity(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * A Drive path, from the breadcrumb trail the user walked.
 *
 * `/Cernix/2025/Keepers/DSC_0001.ARW`. The trail is the only record of
 * where the current folder sits: Drive itself answers with parent ids,
 * and resolving those to names would be a request per level for a string
 * that is already on screen.
 *
 * Leading slash and no trailing one, so a folder and a file read the
 * same way and two paths can be compared by eye in a log line.
 */
export function drivePath(
  trail: ReadonlyArray<{ name: string }>,
  ...rest: ReadonlyArray<string | null | undefined>
): string {
  const parts = [...trail.map(c => c.name), ...rest]
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map(p => p.replace(/^\/+|\/+$/g, ''))
    .filter(p => p !== '')
  return '/' + parts.join('/')
}

/**
 * `3 files`, `1 file`. Counting is the most common thing these lines do
 * and getting the plural wrong in a log reads as a different bug.
 */
export function count(n: number, singular: string, plural = singular + 's'): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/**
 * Name a set of items without letting one line become a page.
 *
 * The log is meant to be read at full scale, so the names are what
 * matters; but a hundred-file move must not push everything else out of a
 * 500-line buffer. The first few are named and the remainder counted.
 */
export function nameList(names: ReadonlyArray<string>, limit = 5): string {
  if (names.length === 0) return ''
  if (names.length <= limit) return names.join(', ')
  return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`
}
