/**
 * A stand-in for the preload bridge.
 *
 * Every call is recorded on `window.__calls` so a test can assert what
 * the renderer actually asked the main process to do, which is the
 * boundary worth testing. Anything below it is Google's problem.
 */
export interface RecordedCall { fn: string; args: unknown[] }

export const FOLDERS = [
  { id: 'fold-A', name: 'Keepers', createdTime: '2026-01-01T00:00:00Z' },
]

/**
 * Twelve, not three: the grid pages now, and three files fit on any
 * page at any window size, so nothing about paging could be asserted.
 * The first three keep their names and ids, which is what the older
 * suites reach for.
 */
export const FILES = Array.from({ length: 12 }, (_, i) => {
  const n = i + 1
  const day = String(n).padStart(2, '0')
  return {
    id: `file-${n}`,
    name: `DSC_${String(n).padStart(4, '0')}.JPG`,
    mimeType: 'image/jpeg',
    size: 1024 * n,
    createdTime: `2026-01-${day}T00:00:00Z`,
    modifiedTime: `2026-01-${day}T00:00:00Z`,
  }
})

export function installMockApi(): RecordedCall[] {
  const calls: RecordedCall[] = []
  const record = (fn: string) => (...args: unknown[]) => { calls.push({ fn, args }); return args }

  const batch = (fn: string) => async (ids: string[], ...rest: unknown[]) => {
    calls.push({ fn, args: [ids, ...rest] })
    return { done: ids.length, failed: 0, total: ids.length }
  }

  // Lets a suite drive the boot's failure path. The Workstation mounts
  // whether or not Drive is connected, so "the root cannot resolve yet"
  // is a state the real app is in on every first run.
  const failRoot = (window as unknown as { __failRootId?: boolean }).__failRootId
  const authListeners: ((s: { connected: boolean }) => void)[] = []
  ;(window as unknown as {
    __emitAuthStatus?: (s: { connected: boolean }) => void
    __authListeners?: () => number
  }).__emitAuthStatus = (s) => { authListeners.forEach(l => l(s)) }
  ;(window as unknown as { __authListeners?: () => number })
    .__authListeners = () => authListeners.length

  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    driveGetRootId: async () => {
      // Recorded, because "how many times did the library boot" is the
      // question behind not re-booting on every token refresh.
      calls.push({ fn: 'driveGetRootId', args: [] })
      if ((window as unknown as { __failRootId?: boolean }).__failRootId) {
        throw new Error('Not connected')
      }
      return 'root'
    },
    onAuthStatus: (cb: (s: { connected: boolean }) => void) => {
      authListeners.push(cb)
      return () => {
        const i = authListeners.indexOf(cb)
        if (i >= 0) authListeners.splice(i, 1)
      }
    },
    authStatus: async () => ({ connected: !failRoot }),
    // Folder-aware, because "what is in this folder" is the question
    // half of these behaviours turn on. Returning one fixture for every
    // id made navigation invisible to the suite: a selection could
    // survive into another folder and nothing could tell, because the
    // other folder held the same twelve files.
    driveListContents: async (folderId: string) => (
      folderId === 'fold-A'
        ? { files: [], folders: [] }
        : { files: FILES, folders: FOLDERS }
    ),
    driveMoveBatch: batch('driveMoveBatch'),
    driveTrashBatch: batch('driveTrashBatch'),
    driveUntrashBatch: batch('driveUntrashBatch'),
    driveCreateFolder: async () => ({}),
    driveRenameFile: async () => ({}),
    driveTrashFile: async (id: string) => { record('driveTrashFile')(id) },
    driveDownloadBatch: async () => ({ done: 0, failed: 0, total: 0, dir: '' }),
    driveStageForEditing: async () => ({ done: 0, failed: 0, total: 0, dir: '' }),
    onDownloadProgress: () => () => {},
    onTrashProgress: () => () => {},
    ratingGetAll: async () => [],
    ratingSetStars: async () => {},
    ratingSetFlag: async () => {},
    ratingSetUserPick: async () => {},
    themeGet: () => 'light',
    themeSet: async () => {},
  }

  ;(window as unknown as { __calls: RecordedCall[] }).__calls = calls
  return calls
}
