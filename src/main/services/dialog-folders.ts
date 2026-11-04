/**
 * Where each file dialog opens.
 *
 * Until Electron 43 the OS remembered the last folder a dialog was used
 * in, so the import picker came back to the card and the export picker
 * to the delivery folder. From 43 a dialog with no `defaultPath` opens
 * in Downloads every time, which for someone importing card after card
 * is a walk across the disk on every import. The app remembers instead,
 * one folder per kind of dialog, so importing does not move where
 * exports open.
 *
 * Remembered across launches (decision 17), in the app's own store, which
 * never leaves this machine: the first dialog after a launch opens where
 * the last one ended. Until a store is attached, as in tests, it is only
 * kept in memory.
 */
import path from 'node:path'

export type DialogKind = 'import-folder' | 'open-image' | 'download' | 'stage' | 'export' | 'archive-move'

const lastFolder = new Map<DialogKind, string>()

/** Where the map is kept between launches. */
export interface PickStore {
  getMeta(key: string): string | null
  setMeta(key: string, value: string): void
}
const STORE_KEY = 'dialog_folders'
let store: PickStore | null = null

/** Loads what was remembered and keeps it up to date from now on. */
export function attachPickStore(s: PickStore): void {
  store = s
  try {
    const saved = JSON.parse(s.getMeta(STORE_KEY) ?? '{}') as Record<string, unknown>
    for (const [kind, folder] of Object.entries(saved)) {
      if (typeof folder === 'string' && folder) lastFolder.set(kind as DialogKind, folder)
    }
  } catch { /* a damaged record is as good as none */ }
}

/** Folder pickers that should reopen inside the folder just chosen, not beside it. */
const REOPEN_INSIDE = new Set<DialogKind>(['download', 'stage'])

/**
 * The `defaultPath` for a dialog of this kind: the folder it was last
 * used in, joined with `fileName` for a save dialog.
 */
export function startPath(kind: DialogKind, fileName?: string): string | undefined {
  const folder = lastFolder.get(kind)
  if (!folder) return fileName
  return fileName ? path.join(folder, fileName) : folder
}

/**
 * Records what the user picked. A card or a delivery folder reopens on its
 * parent, so the next one sits beside it in the listing. A download or
 * staging folder reopens inside itself: the next pick is usually a folder
 * within it, or the same one again.
 */
export function rememberPick(kind: DialogKind, picked: string): void {
  lastFolder.set(kind, REOPEN_INSIDE.has(kind) ? picked : path.dirname(picked))
  try { store?.setMeta(STORE_KEY, JSON.stringify(Object.fromEntries(lastFolder))) } catch { /* not worth failing a pick over */ }
}

/** For tests. */
export function forgetPicks(): void {
  lastFolder.clear()
  store = null
}
