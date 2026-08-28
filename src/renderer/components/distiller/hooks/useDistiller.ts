import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { toast } from 'sonner'
import { useListSelection } from '@/hooks/useListSelection'
import type { EditorFile } from '@/editor/EditorView'
import { useUndoStack } from '@/hooks/useUndoStack'
import { 
  DriveFile, DriveFolder, BreadcrumbItem, ContextMenuState
} from '../distiller-types'
import { RatingRecord, RatingStars, RatingFlag } from '../../../types'
import { 
  sortFilesOldestFirst, sortFolders 
} from '../utils/distiller-utils'
import { messageOf } from '../../../../shared/errors'

/** Everything the Workstation does to a Drive folder: browse, select,
 *  rename, move, trash and their undos. */
export function useDistiller(onOpenEditor?: (file: EditorFile) => void) {
  // ── State ──
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [rootFolderId, setRootFolderId] = useState<string | null>(null)
  const [folders, setFolders] = useState<DriveFolder[]>([])
  const [files, setFiles] = useState<DriveFile[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [ratings, setRatings] = useState<Map<string, RatingRecord>>(new Map())
  const [starsFilter, setStarsFilter] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid')
  // null means "no one has asked for a count, follow the width". The
  // viewport derives that from GRID_TARGET_THUMB and reports it back as
  // defaultColumns, because only it knows how wide it is.
  const [columnOverride, setColumnOverride] = useState<number | null>(null)
  const [defaultColumns, setDefaultColumns] = useState(1)
  const [autoMaxColumns, setAutoMaxColumns] = useState(1)
  const [lightboxId, setLightboxId] = useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [focusFiles, setFocusFiles] = useState<DriveFile[] | null>(null)

  /**
   * Ids currently being dragged. Held in state rather than read from
   * dataTransfer because a drop target has to decide whether to light up
   * during dragover, and dataTransfer.getData is deliberately blank until
   * the drop fires. The ids still go into dataTransfer as well, so the
   * drag is a real one and not a mouse gesture pretending to be one.
   */
  const [draggingIds, setDraggingIds] = useState<string[] | null>(null)

  // Ctrl+Z is bound inside the hook, so only push is needed here.
  const { push: pushUndo } = useUndoStack()

  // Where the user is *now*. An undo may run long after the action, from
  // a different folder, and it should refresh whatever is on screen then
  // rather than whatever was on screen at the time.
  const currentFolderRef = useRef<string | null>(null)

  /**
   * Ids armed by "Move to…" and waiting for a destination click. Null
   * when no move is pending. Same targets as a drag, so the two routes
   * cannot disagree about where an item may land.
   */
  const [pendingMove, setPendingMove] = useState<string[] | null>(null)
  const [focusLabel, setFocusLabel] = useState<string>('')
  const [showInspector, setShowInspector] = useState(false)
  
  // Refs
  const renameInputRef = useRef<HTMLInputElement>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)

  // ── Derived State ──
  useEffect(() => { currentFolderRef.current = currentFolderId })

  const visibleFiles = useMemo(() => {
    const visible: DriveFile[] = []
    for (const f of files) {
      const r = ratings.get(f.id)
      if (!r) {
         visible.push(f)
         continue
      }
      const eff = (r.userStars ?? 0) as number
      if (starsFilter !== null && eff !== starsFilter) continue
      visible.push(f)
    }
    return visible
  }, [files, ratings, starsFilter])

  // ── Stable Actions ──

  const loadContents = useCallback(async (folderId: string) => {
    try {
      setLoading(true)
      setFocusedId(null)
      setFocusFiles(null)
      setFocusLabel('')
      const data = await window.electronAPI.driveListContents(folderId)
      setFolders(sortFolders(data.folders))
      setFiles(sortFilesOldestFirst(data.files))

      // The selection belongs to the folder you are looking at.
      //
      // Navigating did not touch it, so a selection made in one folder
      // survived into the next: the header kept saying "3 selected"
      // about things nobody could see, and Trash and Download in that
      // header would have acted on them. Move and trash already cleared
      // it; this was the third door into the same room.
      //
      // Pruned to what actually arrived rather than emptied, so a plain
      // refresh of the folder you are standing in keeps your selection,
      // and anything that left it - moved, trashed, deleted by another
      // client - drops out of it.
      const present = new Set<string>([
        ...data.folders.map(f => f.id),
        ...data.files.map(f => f.id),
      ])
      setSelected(prev => {
        const kept = [...prev].filter(id => present.has(id))
        return kept.length === prev.size ? prev : new Set(kept)
      })
    } catch (err) {
      toast.error(messageOf(err) || 'Failed to load folder')
    } finally {
      setLoading(false)
    }
  }, [])

  // Boot sequence.
  //
  // This surface is mounted whether or not Drive is connected, so on a
  // first run the root cannot resolve yet. Two things follow, and both
  // were wrong: the failure path has to settle `loading`, because
  // nothing downstream will (only `loadContents` clears it, and that
  // waits on a folder id this never produced), and the boot has to be
  // retried when the connection arrives, because the effect that runs
  // it fires once on mount. Signing in used to leave the library
  // spinning until the window was reloaded.
  const bootedRef = useRef(false)
  useEffect(() => {
    let cancelled = false

    const init = async () => {
      try {
        const rootId = await window.electronAPI.driveGetRootId()
        if (cancelled) return
        bootedRef.current = true
        setRootFolderId(rootId)
        setCurrentFolderId(rootId)
        setBreadcrumbs([{ id: rootId, name: 'Cernix' }])
        const all = await window.electronAPI.ratingGetAll()
        if (cancelled) return
        setRatings(new Map(all.map(r => [r.fileId, r])))
      } catch (err) {
        if (cancelled) return
        // Settled, not spinning. There is nothing to show and the
        // empty state says so, which beats an indicator that never
        // resolves.
        setLoading(false)
        toast.error(messageOf(err) || 'Connection failed')
      }
    }

    init()

    // `auth:status` also fires on every token refresh, so a boot that
    // already succeeded must not be redone: it would drop the user back
    // to the root folder about once an hour.
    const unsubscribe = window.electronAPI.onAuthStatus((status) => {
      if (status?.connected && !bootedRef.current) void init()
    })

    return () => { cancelled = true; unsubscribe() }
  }, [])

  // Fetching the folder is what this effect is for, and loadContents
  // writes the result into state. There is nothing here to derive from
  // props instead.
  /* eslint-disable react-hooks/set-state-in-effect -- fetches a folder */
  useEffect(() => {
    if (currentFolderId) loadContents(currentFolderId)
  }, [currentFolderId, loadContents])
  /* eslint-enable react-hooks/set-state-in-effect */

  const navigateToFolder = useCallback((folder: DriveFolder) => {
    setCurrentFolderId(folder.id)
    setBreadcrumbs(prev => {
      if (prev.some(c => c.id === folder.id)) return prev
      return [...prev, { id: folder.id, name: folder.name }]
    })
  }, [])

  const navigateToBreadcrumb = useCallback((index: number) => {
    const crumb = breadcrumbs[index]
    if (!crumb) return
    setCurrentFolderId(crumb.id)
    setBreadcrumbs(prev => prev.slice(0, index + 1))
  }, [breadcrumbs])

  const handleSetStars = useCallback((fileId: string, stars: RatingStars | null) => {
    setRatings(prev => {
      const next = new Map(prev)
      const existing = next.get(fileId) ?? { fileId, userStars: null, flag: null, updatedAt: Date.now() }
      next.set(fileId, { ...existing, userStars: stars, updatedAt: Date.now() })
      return next
    })
    window.electronAPI.ratingSetStars(fileId, stars).catch(() => {})
  }, [])

  const handleSetFlag = useCallback((fileId: string, flag: RatingFlag) => {
    setRatings(prev => {
      const next = new Map(prev)
      const existing = next.get(fileId) ?? { fileId, userStars: null, flag: null, updatedAt: Date.now() }
      next.set(fileId, { ...existing, flag, updatedAt: Date.now() })
      return next
    })
    window.electronAPI.ratingSetFlag(fileId, flag).catch(() => {})
  }, [])

  // The order the viewport actually paints: folders first, then the
  // files that survived the filters. Ranges walk this, so it has to
  // match what is on screen rather than the unfiltered data.
  const orderedIds = useMemo(
    () => (focusFiles ?? [...folders, ...visibleFiles]).map(i => i.id),
    [focusFiles, folders, visibleFiles],
  )

  // The diff below needs the previous selection without applySelection
  // depending on it. Synced in an effect rather than during render.
  // Writing a ref while rendering is a React rule violation, and effects
  // flush before any click can arrive.
  const selectedRef = useRef(selected)
  useEffect(() => { selectedRef.current = selected })

  /**
   * Selection here doubles as the persisted "pick" flag, which the old
   * single-toggle handler could write inline because exactly one id
   * changed per click. Range-select changes many at once, so the write
   * is now a diff. Only ids that actually crossed the boundary are
   * sent, and a range over already-selected items costs nothing.
   *
   * Folders are skipped: they carry no rating record, and the previous
   * handler was writing pick flags for them.
   */
  const applySelection = useCallback((ids: string[]) => {
    const prev = selectedRef.current
    const next = new Set(ids)
    const isFile = new Set(files.map(f => f.id))
    for (const id of next) {
      if (!prev.has(id) && isFile.has(id)) window.electronAPI.ratingSetUserPick(id, true).catch(() => {})
    }
    for (const id of prev) {
      if (!next.has(id) && isFile.has(id)) window.electronAPI.ratingSetUserPick(id, false).catch(() => {})
    }
    setSelected(next)
  }, [files])

  // Same model as Local Archive. Plain replaces, Ctrl/Cmd ranges,
  // Shift toggles, because it is literally the same hook.
  const { handleSelectClick, toggle: toggleOne } = useListSelection({
    orderedIds,
    selected,
    onChange: applySelection,
    // Escape cancels the pending move first; clearing the selection
    // underneath it would strand the user in move mode with nothing
    // selected. Ctrl+A is disabled for the same window, which is correct:
    // nothing to select while choosing a destination.
    enabled: pendingMove === null,
  })

  const toggleSelect = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    handleSelectClick(id, e)
  }, [handleSelectClick])

  /**
   * The tile's checkbox. Always adds or removes exactly one, which is
   * what a checkbox promises. The modifier-aware handler above would
   * replace the whole selection on a plain click, leaving a checked box
   * with no way to uncheck itself.
   */
  const toggleSelectOne = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    toggleOne(id)
  }, [toggleOne])

  // Escape clears the selection everywhere, but a keyboard shortcut is
  // not an affordance. Nothing on screen said the selection could be
  // dropped. Local Archive has had visible Select All / Unselect All
  // controls all along; these are the same two, for the header.
  const clearSelection = useCallback(() => applySelection([]), [applySelection])
  const selectAllVisible = useCallback(() => applySelection(orderedIds), [applySelection, orderedIds])

  /**
   * Clears the drag no matter where it ends.
   *
   * A tile's own dragend only fires if the drag started on that tile and
   * finished normally. Drop outside the window, hit Escape mid-drag, or
   * have the browser cancel it, and the handler never runs. Leaving the
   * app convinced a drag is still in progress, with every drop target
   * lit up and nothing to drop.
   *
   * Listening on window with capture catches all of those.
   */
  useEffect(() => {
    if (draggingIds === null) return
    const clear = () => setDraggingIds(null)
    window.addEventListener('dragend', clear, true)
    window.addEventListener('drop', clear, true)
    return () => {
      window.removeEventListener('dragend', clear, true)
      window.removeEventListener('drop', clear, true)
    }
  }, [draggingIds])

  // Escape leaves move mode. useListSelection is disabled while a move is
  // pending, so this is the only Escape handler in play and there is no
  // race over which one wins.
  useEffect(() => {
    if (pendingMove === null) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setPendingMove(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pendingMove])

  const armMove = useCallback((ids: string[]) => {
    if (ids.length > 0) setPendingMove(ids)
  }, [])

  const cancelMove = useCallback(() => setPendingMove(null), [])

  /**
   * Move items into `targetId`.
   *
   * Refuses the two moves Drive would either reject or quietly corrupt:
   * into the folder the items already live in (a no-op that still costs
   * a round trip and a refresh), and a folder into itself (Drive orphans
   * the subtree).
   */
  const handleMoveTo = useCallback(async (targetId: string, idsOverride?: string[]) => {
    const ids = idsOverride ?? pendingMove ?? []
    setPendingMove(null)
    setDraggingIds(null)
    if (ids.length === 0 || !currentFolderId) return

    if (targetId === currentFolderId) {
      toast.info('Already in this folder.')
      return
    }
    if (ids.includes(targetId)) {
      toast.error('A folder cannot be moved into itself.')
      return
    }

    const tid = toast.loading(`Moving ${ids.length} item${ids.length === 1 ? '' : 's'}…`)
    try {
      const source = currentFolderId
      const result = await window.electronAPI.driveMoveBatch(ids, targetId, source)

      // Recorded here because this is the only moment that knows where
      // the items came from. Nothing can reconstruct it afterwards.
      const label = `Move ${ids.length} item${ids.length === 1 ? '' : 's'}`
      const undoMove = async () => {
        await window.electronAPI.driveMoveBatch(ids, source, targetId)
        toast.success('Move undone.')
        if (currentFolderRef.current) loadContents(currentFolderRef.current)
      }
      pushUndo({ label, undo: undoMove })

      const action = { label: 'Undo', onClick: () => { void undoMove() } }
      if (result.failed > 0) {
        toast.warning(`Moved ${result.done}/${result.total}. ${result.failed} failed.`, { id: tid, action })
      } else {
        toast.success(`Moved ${result.done} item${result.done === 1 ? '' : 's'}.`, { id: tid, action })
      }
      setSelected(new Set())
      setFocusFiles(null)
      loadContents(currentFolderId)
    } catch (err) {
      toast.error('Move failed: ' + messageOf(err), { id: tid })
    }
  }, [pendingMove, currentFolderId, loadContents, pushUndo])

  const handleRename = useCallback(async (id: string) => {
    if (!renameValue.trim()) { setRenaming(null); return }
    try {
      await window.electronAPI.driveRenameFile(id, renameValue.trim())
      setRenaming(null)
      if (currentFolderId) loadContents(currentFolderId)
    } catch (err) {
      toast.error(messageOf(err))
    }
  }, [renameValue, currentFolderId, loadContents])

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim() || !currentFolderId) return
    try {
      await window.electronAPI.driveCreateFolder(currentFolderId, newFolderName.trim())
      setCreatingFolder(false)
      setNewFolderName('')
      loadContents(currentFolderId)
    } catch (err) {
      toast.error(messageOf(err))
    }
  }, [newFolderName, currentFolderId, loadContents])

  const handleTrashBatch = useCallback(async (ids: string[]) => {
    const total = ids.length
    if (total === 0) return
    const tid = toast.loading(`Trashing 0 / ${total} items…`)
    const unsub = window.electronAPI.onTrashProgress((p) => {
       toast.loading(`Trashing ${p.done} / ${p.total} items…`, { id: tid })
    })
    try {
      const result = await window.electronAPI.driveTrashBatch(ids)
      unsub()

      const undoTrash = async () => {
        await window.electronAPI.driveUntrashBatch(ids)
        toast.success('Restored from trash.')
        if (currentFolderRef.current) loadContents(currentFolderRef.current)
      }
      pushUndo({ label: `Trash ${ids.length} item${ids.length === 1 ? '' : 's'}`, undo: undoTrash })

      const action = { label: 'Undo', onClick: () => { void undoTrash() } }
      if (result.failed > 0) toast.warning(`Trashed ${result.done}/${total}. ${result.failed} failed.`, { id: tid, action })
      else toast.success(`Trashed ${result.done} items.`, { id: tid, action })
      setFocusFiles(null)
      setSelected(new Set())
      if (currentFolderId) loadContents(currentFolderId)
    } catch (err) {
      if (unsub) unsub()
      toast.error('Trash failed: ' + messageOf(err), { id: tid })
    }
  }, [currentFolderId, loadContents, pushUndo])

  const handleDownloadBatch = useCallback(async (items: { id: string; name: string }[]) => {
    const total = items.length
    if (total === 0) return
    const tid = toast.loading(`Downloading 0 / ${total}…`)
    const unsub = window.electronAPI.onDownloadProgress((p) => {
      toast.loading(`Downloading ${p.done} / ${p.total}…`, { id: tid })
    })
    try {
      const result = await window.electronAPI.driveDownloadBatch(items)
      unsub()
      if (result.saved === 0) toast.dismiss(tid)
      else if (result.failed && result.failed > 0) toast.warning(`Saved ${result.saved}/${total}. ${result.failed} failed.`, { id: tid })
      else toast.success(`Saved ${result.saved} items.`, { id: tid })
    } catch (err) {
      if (unsub) unsub()
      toast.error('Download failed: ' + messageOf(err), { id: tid })
    }
  }, [])

  const handleStageForEditing = useCallback(async (items: { id: string; name: string }[]) => {
    const total = items.length
    if (total === 0) return
    const tid = toast.loading(`Staging 0 / ${total}…`)
    const unsub = window.electronAPI.onDownloadProgress((p) => {
      toast.loading(`Staging ${p.done} / ${p.total}…`, { id: tid })
    })
    try {
      const result = await window.electronAPI.driveStageForEditing(items)
      unsub()
      if (result.saved === 0) toast.dismiss(tid)
      else if (result.failed && result.failed > 0) toast.warning(`Staged ${result.saved}/${total}. ${result.failed} failed.`, { id: tid })
      else toast.success(`Staged ${result.saved} files. Open in Lightroom/Bridge.`, { id: tid })
    } catch (err) {
      if (unsub) unsub()
      toast.error('Staging failed: ' + messageOf(err), { id: tid })
    }
  }, [])


  // ── Stabilization Bridge ──

  const actions = useMemo(() => ({
    loadContents, navigateToFolder, navigateToBreadcrumb, handleSetStars, handleSetFlag,
    toggleSelect, toggleSelectOne, toggleOne, clearSelection, selectAllVisible, applySelection,
    armMove, cancelMove, handleMoveTo,
    // One trash. The context menu's single-item path used to be its own
    // serial implementation with no undo behind it.
    handleRename, handleCreateFolder, handleTrash: handleTrashBatch, handleTrashBatch,
    handleDownloadBatch, handleStageForEditing,
    onOpenEditor
  }), [
    loadContents, navigateToFolder, navigateToBreadcrumb, handleSetStars, handleSetFlag,
    toggleSelect, toggleSelectOne, toggleOne, clearSelection, selectAllVisible,
    applySelection, armMove, cancelMove, handleMoveTo,
    handleRename, handleCreateFolder, handleTrashBatch,
    handleDownloadBatch, handleStageForEditing,
    onOpenEditor
  ])

  const setters = useMemo(() => ({
    setStarsFilter, setViewMode, setColumnOverride, setAutoMaxColumns,
    setLightboxId, setRenaming, setRenameValue, setCreatingFolder, setNewFolderName,
    setDefaultColumns,
    setContextMenu, setFocusedId, setSelected, setShowInspector, setFocusFiles,
    setDraggingIds
  }), [])

  const refs = useMemo(() => ({
    renameInputRef, newFolderInputRef
  }), [])

  return {
    state: {
      currentFolderId, rootFolderId, folders, files, loading, selected, focusedId,
      ratings, starsFilter, viewMode, columnOverride, autoMaxColumns, defaultColumns,
      lightboxId, breadcrumbs, renaming, renameValue, creatingFolder, newFolderName,
      contextMenu, focusFiles, focusLabel, showInspector, visibleFiles,
      draggingIds, pendingMove,
    },
    refs,
    setters,
    actions
  }
}
