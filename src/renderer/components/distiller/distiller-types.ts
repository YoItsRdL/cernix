export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size: string
  createdTime: string
  modifiedTime?: string
  captureTime?: string | null
  thumbnailLink?: string
  webViewLink?: string
}

export interface DriveFolder {
  id: string
  name: string
  createdTime: string
}

export interface BreadcrumbItem {
  id: string
  name: string
}

// Grid sizing lives in lib/grid.ts. It is not about Drive, and
// keeping it here is what let a second copy grow in PhotoGrid.

/** Payload type for a move drag. Also how a target recognises one. */
export const MOVE_DRAG_MIME = 'application/x-cernix-ids'

/**
 * Ids carried by a drag, read at drop time.
 *
 * dataTransfer is the authority rather than React state. State is only
 * populated after a re-render, so a drop handler reading it depends on a
 * render landing between dragstart and drop. True when a human drags,
 * false the moment anything is fast, and untestable either way.
 *
 * During dragover the data is deliberately unreadable and only `types`
 * is exposed, which is why validity there is checked by MIME and the
 * self-drop check is repeated here where the ids are actually available.
 */
export function readMoveDragIds(e: React.DragEvent): string[] | null {
  try {
    const raw = e.dataTransfer.getData(MOVE_DRAG_MIME)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every(x => typeof x === 'string') ? parsed : null
  } catch {
    return null
  }
}

/** Where a context menu opened and what it opened on. */
export interface ContextMenuState {
  x: number
  y: number
  id: string
  type: 'file' | 'folder'
}
