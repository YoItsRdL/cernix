import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { logActivity } from '@/lib/activity-log'
import { messageOf } from '../../shared/errors'
import { summariseTrash } from '../../shared/trash-report'

/** Height of one row in list view. The page arithmetic needs it too. */
const LIST_ROW_HEIGHT = 36
import { useListSelection } from '@/hooks/useListSelection'
import { Toolbar, TOOLBAR_CONTROL, ToolbarSeparator } from '@/components/ui/toolbar'
import { Modal } from '@/components/ui/modal'
import { List as ListIcon, Grid3x3 as GridIcon, CheckCircle2, RefreshCw, Trash2, ClipboardList, Star, Flag } from 'lucide-react'
import { FixedSizeList as List } from 'react-window'
import { PhotoGrid } from './PhotoGrid'
import { autoColumnCount, defaultColumnCount, photoGridPageSize } from '@/lib/photo-grid'
import { GRID_GUTTER, thumbEdgeFor, usableWidth } from '@/lib/grid'
import { Lightbox } from './Lightbox'
import { useToast } from '../hooks/useToast'
import { type ScannedFile, type RatingRecord, type RatingStars, type RatingFlag } from '@/types'
import { matchesRatingFilter, type RatingFilter } from '@/lib/rating-filter'
import { RatingFilterControl } from './ui/rating-filter-control'
import { ReviewContextMenu, type ReviewMenuState } from './ReviewContextMenu'
import { localRatingKey, baseName } from '@/../shared/local-rating-key'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { IconButton } from './ui/icon-button'
import { Separator } from './ui/separator'
import { Pager } from './ui/pager'
import { SyncBadge } from './ui/sync-badge'
import { syncStateFor } from '@/lib/sync-state'
import { usePagination } from '@/hooks/usePagination'
import { useGridNavigation } from '@/hooks/useGridNavigation'
import { sortOldestFirst } from '@/lib/review-order'
import { findPairs, withCompanions, filesOfTiles } from '@/lib/raw-pairs'
import { formatBytes } from '@/lib/format-bytes'
import { Inspector, InspectorSection, InspectorRow } from './ui/inspector'
import { MediaFrame } from './ui/frame-ground'
import { Checkbox } from './ui/checkbox'
import { isVideoPath } from '../../shared/media-types'

interface ReviewViewProps {
  scannedFiles: ScannedFile[]
  selectedFiles: Set<string>
  /** True while the selection is the scan's own; Trash waits for one the user made. */
  selectionIsPreset: boolean
  onSetSelection: (paths: string[]) => void
  /** Drop the given relative paths from the local review state: called
   *  after the OS-level trash IPC has accepted them. */
  onRemoveFiles: (relativePaths: string[]) => void
  onCancel: () => void
  onBeginIngest: () => void
  /** Take keyboard focus on arrival, when the control that led here was just replaced. */
  focusOnMount?: boolean
  onFocused?: () => void
}

export function ReviewView({
  scannedFiles,
  selectedFiles,
  selectionIsPreset,
  onSetSelection: onSetFiles,
  onRemoveFiles,
  onCancel,
  onBeginIngest,
  focusOnMount = false,
  onFocused,
}: ReviewViewProps) {
  // Arriving by a keyboard press on a control that no longer exists:
  // focus goes to the first photograph, once the grid has drawn it.
  useEffect(() => {
    if (!focusOnMount) return
    let tries = 0
    const attempt = () => {
      const first = document.querySelector<HTMLElement>('[data-grid-key]')
      if (first) { first.focus(); onFocused?.(); return }
      if (++tries < 20) timer = window.setTimeout(attempt, 100)
    }
    let timer = window.setTimeout(attempt, 100)
    return () => window.clearTimeout(timer)
  }, [focusOnMount, onFocused])

  /** Inflight trash op: disables the button and swaps in a spinner so
   *  a slow OS trash dispatch can't be re-clicked into a duplicate run. */
  const [isTrashing, setIsTrashing] = useState(false)
  /** The trash confirmation is open. */
  const [confirmTrash, setConfirmTrash] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [filter, setFilter] = useState<'all' | 'unsynced' | 'synced'>('all')
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all')
  const [menu, setMenu] = useState<ReviewMenuState | null>(null)
  // Stars and picks made on the card, kept under a key of name, size and
  // time (decision 21), and carried to the Drive id when the file uploads.
  const [ratings, setRatings] = useState<Map<string, RatingRecord>>(new Map())
  useEffect(() => {
    let cancelled = false
    window.electronAPI.ratingGetAll()
      .then(all => { if (!cancelled) setRatings(new Map(all.map(r => [r.fileId, r]))) })
      .catch(() => { /* no marks to show is not a reason to fail the review */ })
    return () => { cancelled = true }
  }, [])
  const [lightboxPath, setLightboxPath] = useState<string | null>(null)
  /** User-overridden column count, or null when auto-fit. Clamped to
   *  the container's natural max via `effectiveColumns` so the override
   *  re-syncs gracefully when the panel is resized. */
  const [columnOverride, setColumnOverride] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  const autoMaxColumns = Math.max(1, autoColumnCount(dimensions.width))
  // Same rule as Workstation, from the same function: open at the
  // target thumbnail size rather than at "as many as fit", clamped by
  // what actually fits.
  const effectiveColumns = Math.min(
    columnOverride ?? defaultColumnCount(dimensions.width),
    autoMaxColumns,
  )
  const atMinColumns = effectiveColumns <= 1
  const atMaxColumns = effectiveColumns >= autoMaxColumns
  const toast = useToast()

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // Oldest first, by capture date when the scan found one, else file time
  // (decision 41). Memoised so selection toggles don't re-sort 1000s of
  // items on every render.
  //
  // A RAW that has a JPEG beside it is that JPEG's companion and has no tile
  // of its own (decision 25): one tile per shot, and what is done to the tile
  // is done to both files.
  const pairs = useMemo(() => findPairs(scannedFiles.map(f => f.relativePath)), [scannedFiles])
  const sortedFiles = useMemo(
    () => sortOldestFirst(scannedFiles.filter(f => !pairs.tileOf.has(f.relativePath))),
    [scannedFiles, pairs],
  )
  /**
   * Replace the selection, in tiles: a tile brings its RAW, and a RAW passed
   * alone is ignored, so un-ticking a tile cannot leave its RAW ticked.
   */
  const onSetSelection = useCallback(
    (paths: string[]) => onSetFiles(withCompanions(paths.filter(p => !pairs.tileOf.has(p)), pairs)),
    [onSetFiles, pairs],
  )
  const pairsSelected = useMemo(
    () => sortedFiles.reduce((n, f) => n + (pairs.companionOf.has(f.relativePath) && selectedFiles.has(f.relativePath) ? 1 : 0), 0),
    [sortedFiles, selectedFiles, pairs],
  )
  const selectedTileCount = useMemo(
    () => sortedFiles.reduce((n, f) => n + (selectedFiles.has(f.relativePath) ? 1 : 0), 0),
    [sortedFiles, selectedFiles],
  )
  // Split on the ledger, not on the import flag, because the words say
  // so. These tabs read "New" and "Imported" and split on `isImported`,
  // which is a third vocabulary for a question the tiles already answer
  // in a second one: a file imported but not yet uploaded wears the
  // amber IMPORTED mark and would have sat under a tab labelled Synced.
  // One axis (has this frame reached Drive) and the tabs, the marks
  // and the summary all report the same one.
  const { unsyncedFiles, syncedFiles } = useMemo(() => ({
    unsyncedFiles: sortedFiles.filter(f => !f.isUploaded),
    syncedFiles: sortedFiles.filter(f => f.isUploaded),
  }), [sortedFiles])
  const syncFiltered = filter === 'unsynced' ? unsyncedFiles : filter === 'synced' ? syncedFiles : sortedFiles
  /** Each file's rating key, once per scan. */
  const keyByPath = useMemo(
    () => new Map(scannedFiles.map(f => [f.relativePath, localRatingKey({ name: baseName(f.relativePath), sizeBytes: f.sizeBytes, mtime: f.mtime })])),
    [scannedFiles],
  )
  const ratingOf = useCallback((path: string) => ratings.get(keyByPath.get(path) ?? ''), [ratings, keyByPath])
  const filteredFiles = useMemo(
    () => (ratingFilter === 'all'
      ? syncFiltered
      : syncFiltered.filter(f => matchesRatingFilter(ratings.get(keyByPath.get(f.relativePath) ?? ''), ratingFilter))),
    [syncFiltered, ratingFilter, ratings, keyByPath],
  )

  const setStars = useCallback((path: string, stars: RatingStars | null) => {
    const companion = pairs.companionOf.get(path)
    const keys = [keyByPath.get(path), companion ? keyByPath.get(companion) : undefined].filter((k): k is string => !!k)
    if (keys.length === 0) return
    setRatings(prev => {
      const next = new Map(prev)
      for (const key of keys) {
        next.set(key, { ...(prev.get(key) ?? { fileId: key, userStars: null, flag: null }), fileId: key, userStars: stars, updatedAt: Date.now() })
      }
      return next
    })
    for (const key of keys) window.electronAPI.ratingSetStars(key, stars).catch(() => {})
  }, [keyByPath, pairs])
  const setFlag = useCallback((path: string, flag: RatingFlag) => {
    const companion = pairs.companionOf.get(path)
    const keys = [keyByPath.get(path), companion ? keyByPath.get(companion) : undefined].filter((k): k is string => !!k)
    if (keys.length === 0) return
    setRatings(prev => {
      const next = new Map(prev)
      for (const key of keys) {
        next.set(key, { ...(prev.get(key) ?? { fileId: key, userStars: null, flag: null }), fileId: key, flag, updatedAt: Date.now() })
      }
      return next
    })
    for (const key of keys) window.electronAPI.ratingSetFlag(key, flag).catch(() => {})
  }, [keyByPath, pairs])

  // A page is whatever fills the viewport in whole rows, so the two
  // views page differently: the grid's row height follows the column
  // count, the list's is a flat 36px.
  const pageSize = viewMode === 'grid'
    ? photoGridPageSize(dimensions.width, dimensions.height, effectiveColumns)
    : Math.max(1, Math.floor(dimensions.height / LIST_ROW_HEIGHT))
  // Identity is the active filter: narrowing to Synced starts at its
  // first file, not wherever the unfiltered page number landed.
  const pagination = usePagination(filteredFiles.length, pageSize, `${filter}|${ratingFilter}`)
  const visibleFiles = useMemo(
    () => filteredFiles.slice(pagination.start, pagination.end),
    [filteredFiles, pagination.start, pagination.end],
  )

  // The edge the grid asked the thumbnailer for at this column width,
  // so the viewer can reuse what it already produced.
  const lightboxThumbEdge = thumbEdgeFor(
    usableWidth(dimensions.width) / Math.max(1, effectiveColumns) - GRID_GUTTER,
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  )

  // A size per path, once per scan, then a sum once per selection change.
  // It searched every scanned file for every selected path on every
  // render: 25 million comparisons for a 5,000-file card, which held
  // each page change, click and viewer step for 300 to 500 ms.
  const sizeByPath = useMemo(
    () => new Map(scannedFiles.map(f => [f.relativePath, f.sizeBytes || 0])),
    [scannedFiles],
  )
  const selectedSize = useMemo(() => {
    let total = 0
    for (const path of selectedFiles) total += sizeByPath.get(path) ?? 0
    return total
  }, [selectedFiles, sizeByPath])

  // Lightbox navigation.
  //
  // Over the filtered list, not every file scanned. Stepping through a
  // narrowed tab used to walk straight into files the filter was
  // hiding, so the arrow keys quietly disagreed with the grid behind
  // them about what you were looking at.
  const lightboxIndex = filteredFiles.findIndex(f => f.absolutePath === lightboxPath)
  // Wraps, as in the Distiller lightbox. See the note there. The
  // lightboxIndex >= 0 guard stays: findIndex returns -1 when the open
  // path is no longer in the list, and -1 would otherwise wrap to the
  // last file rather than doing nothing.
  const canCycleLightbox = lightboxIndex >= 0 && filteredFiles.length > 1
  /** The file the viewer is showing, or null when it is closed. */
  const lightboxFile = lightboxIndex >= 0 ? filteredFiles[lightboxIndex] : null
  /** Modified time, so a file replaced on the card is not served from the cache. */
  const lightboxVersion = lightboxFile ? new Date(lightboxFile.mtime).getTime() : 0

  /**
   * Open the file at `index`, and bring its page up behind the lightbox.
   *
   * Without the second half, stepping past the end of a page left the
   * grid showing the page you started on: close the lightbox and the
   * photograph you were just looking at is not on screen, with nothing
   * to say where it went.
   */
  const openLightboxAt = (index: number) => {
    const file = filteredFiles[index]
    if (!file) return
    setLightboxPath(file.absolutePath)
    // The grid's own focus follows the viewer, so closing it and pressing
    // an arrow goes on from the photograph you were looking at and not
    // from wherever the focus was before it opened (page 1, usually).
    setFocusedIndex(index)
    const wanted = Math.floor(index / pagination.pageSize)
    if (wanted !== pagination.page) pagination.setPage(wanted)
  }

  const handleNextLightbox = canCycleLightbox
    ? () => openLightboxAt((lightboxIndex + 1) % filteredFiles.length)
    : undefined
  const handlePrevLightbox = canCycleLightbox
    ? () => openLightboxAt((lightboxIndex - 1 + filteredFiles.length) % filteredFiles.length)
    : undefined

  // "All" means all the filter shows. The selection never reaches past
  // the filter (see changeFilter), so every visible file selected is
  // everything selected.
  const allSelected = filteredFiles.length > 0 && filteredFiles.every(f => selectedFiles.has(f.relativePath))

  /**
   * Switch the filter, and narrow the selection to what it shows.
   *
   * The selection used to survive a filter change: with 17 selected,
   * "Synced (0)" said "No files" while "Trash 17" and Initiate Transfer
   * acted on the 17 nobody could see. The Workstation already narrows on
   * a filter change; this is the same rule.
   */
  const narrowSelectionTo = (shown: Set<string>) => {
    const keep = filesOfTiles([...shown], pairs)
    const kept = Array.from(selectedFiles).filter(p => keep.has(p))
    if (kept.length !== selectedFiles.size) onSetFiles(kept)
  }
  const changeFilter = (next: typeof filter) => {
    setFilter(next)
    const base = next === 'unsynced' ? unsyncedFiles : next === 'synced' ? syncedFiles : sortedFiles
    narrowSelectionTo(new Set(base.filter(f => matchesRatingFilter(ratingOf(f.relativePath), ratingFilter)).map(f => f.relativePath)))
  }
  /**
   * Right-click, as Finder has it: a photograph outside the selection
   * becomes the selection before the menu opens, so what the menu acts on
   * is what was clicked.
   */
  const openMenu = useCallback((path: string, e: React.MouseEvent) => {
    if (!selectedFiles.has(path)) onSetSelection([path])
    setMenu({ x: e.clientX, y: e.clientY, path })
  }, [selectedFiles, onSetSelection])

  // The same rule for the rating filter: what is selected is what is shown.
  const changeRatingFilter = (next: RatingFilter) => {
    setRatingFilter(next)
    narrowSelectionTo(new Set(syncFiltered.filter(f => matchesRatingFilter(ratingOf(f.relativePath), next)).map(f => f.relativePath)))
  }

  // The selection model lives in useListSelection, so Local Archive and
  // Workstation behave identically. See that file for the modifier map
  // and why the anchor is a ref.
  // `handleToggleClick`, not `handleSelectClick`: on this surface the
  // tile is the checkbox, so clicking a selected photograph unticks it.
  // Workstation uses the other entry point because there the chip is
  // the checkbox and the tile's click focuses. Both come from the one
  // model in useListSelection.
  const { handleToggleClick, toggle } = useListSelection({
    orderedIds: filteredFiles.map(f => f.relativePath),
    selected: selectedFiles,
    onChange: onSetSelection,
  })

  // Arrow keys, Home/End and the page keys. Off while the lightbox is
  // open. The arrows belong to the photograph on screen then.
  const { focusedIndex, setFocusedIndex } = useGridNavigation({
    total: filteredFiles.length,
    columns: viewMode === 'grid' ? effectiveColumns : 1,
    pagination,
    idAt: i => filteredFiles[i]?.relativePath,
    onSelect: onSetSelection,
    enabled: !lightboxPath,
    // The import is what is selected, and starts as everything: an
    // arrow press must not shrink it to one file (decision 23).
    moveOnly: true,
  })
  const focusedPath = focusedIndex === null ? undefined : filteredFiles[focusedIndex]?.relativePath

  // How far a trash has got: it runs file by file, and a long one showed
  // a spinner and nothing else.
  const [trashProgress, setTrashProgress] = useState<{ done: number; total: number } | null>(null)
  useEffect(() => window.electronAPI.onTrashProgress(p => setTrashProgress({ done: p.done + p.failed, total: p.total })), [])

  const handleTrashSelected = async () => {
    if (selectedFiles.size === 0 || isTrashing) return
    const targets = scannedFiles.filter(f => selectedFiles.has(f.relativePath))
    // Absolute, not relative. The whole point of a log line about a file
    // leaving is being able to go and find it, and a path relative to a
    // card that is no longer mounted finds nothing.
    for (const f of targets) logActivity('sweep', 'info', `TRASH ${f.absolutePath}`)
    setIsTrashing(true)
    try {
      const result = await window.electronAPI.mediaTrash(targets.map(f => f.absolutePath))
      // Map the OS-accepted absolute paths back to the relative paths
      // the UI uses, so we only drop the files that actually got
      // trashed. Anything that failed stays in the list. The user can
      // see what didn't go through.
      // A file that was already gone is where the user wanted it: its
      // tile goes too, and it is not counted as a failure.
      const goneSet = new Set([...result.trashedPaths, ...result.missingPaths])
      const goneRelative = targets
        .filter(f => goneSet.has(f.absolutePath))
        .map(f => f.relativePath)
      if (goneRelative.length > 0) onRemoveFiles(goneRelative)
      const trashed = result.trashedPaths.length
      const missing = result.missingPaths.length
      for (const f of result.failures) {
        logActivity('sweep', 'error', `TRASH failed: ${f.path}: ${f.message}`)
      }
      const said = summariseTrash(trashed, missing, result.failures)
      if (result.failures.length === 0) {
        logActivity('sweep', 'success', said)
        toast(said, 'success')
      } else if (trashed === 0 && missing === 0) {
        logActivity('sweep', 'error', said)
        toast(said, 'error')
      } else {
        logActivity('sweep', 'warn', said)
        toast(said, 'info')
      }
    } catch (err) {
      console.error('mediaTrash failed', err)
      logActivity('sweep', 'error', `TRASH failed: ${messageOf(err)}`)
      toast('Trash failed.', 'error')
    } finally {
      setIsTrashing(false)
      setTrashProgress(null)
    }
  }

  return (
    <div className="w-full flex-1 flex flex-col p-0 overflow-hidden bg-surface-workspace">
      {/* Toolbar */}
      {/* Same shell as Workstation: one Toolbar, so both regions get the
          same element, background, height, padding and container. The two
          used to differ in all of those while doing the same job. */}
      <Toolbar
        className="z-50 overflow-hidden"
        left={
          <>
            <div className="flex items-center gap-space-2 @2xl:gap-space-3 shrink-0">
              <h2 className="text-body font-medium text-text-emphatic whitespace-nowrap">
                <span className="@3xl:hidden">Audit</span>
                <span className="hidden @3xl:inline">Audit Batch Review</span>
              </h2>
              <span className="text-code text-text-muted">[{sortedFiles.length}]</span>
            </div>
  
            {(
              <div className="hidden @2xl:flex items-center gap-2 shrink-0 ml-4">
                <div className="flex items-center h-7 bg-surface-workspace p-0.5 rounded-soft border border-border-subtle">
                  <IconButton
                    aria-label="Grid view"
                    title="Grid view"
                    icon={<GridIcon size={12} strokeWidth={1.5} />}
                    aria-pressed={viewMode === 'grid'}
                    onClick={() => setViewMode('grid')}
                    className={cn(
                      'h-6 w-6 rounded-nested',
                      viewMode === 'grid'
                        ? 'bg-overlay-active text-text-emphatic hover:bg-overlay-active'
                        : 'text-text-muted hover:text-text-emphatic',
                    )}
                  />
                  <IconButton
                    aria-label="List view"
                    title="List view"
                    icon={<ListIcon size={12} strokeWidth={1.5} />}
                    aria-pressed={viewMode === 'list'}
                    onClick={() => setViewMode('list')}
                    className={cn(
                      'h-6 w-6 rounded-nested',
                      viewMode === 'list'
                        ? 'bg-overlay-active text-text-emphatic hover:bg-overlay-active'
                        : 'text-text-muted hover:text-text-emphatic',
                    )}
                  />
                </div>
  
                {/* Column-density adjuster: only in grid mode and only
                    when there's room. Mirrors the Distiller pattern:
                    override is clamped to the container's natural max,
                    so the cluster re-syncs gracefully on panel resize. */}
                {viewMode === 'grid' && (
                  <div className="hidden @3xl:flex items-center bg-surface-workspace border border-border-subtle rounded-soft h-7 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setColumnOverride(Math.max(1, effectiveColumns - 1))}
                      disabled={atMinColumns}
                      aria-label="Fewer columns"
                      title="Fewer columns"
                      className="h-full px-2 rounded-flush rounded-r-none border-r border-border-subtle text-body"
                    >
                      −
                    </Button>
                    <span className="px-2 text-code text-text-muted min-w-counter-sm text-center">{effectiveColumns}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setColumnOverride(Math.min(autoMaxColumns, effectiveColumns + 1))}
                      disabled={atMaxColumns}
                      aria-label="More columns"
                      title="More columns"
                      className="h-full px-2 rounded-flush rounded-l-none border-l border-border-subtle text-body"
                    >
                      +
                    </Button>
                  </div>
                )}
              </div>
            )}
  
            <ToolbarSeparator className="hidden @5xl:block" />

            <div className="hidden @5xl:flex items-center gap-space-3 min-w-0">
              {/* Filter tabs */}
              <div className="flex items-center h-7 gap-0.5 bg-surface-workspace border border-border-subtle p-0.5 rounded-soft shrink-0">
                {([
                  { key: 'all', label: 'All', count: sortedFiles.length },
                  { key: 'unsynced', label: 'Not synced', count: unsyncedFiles.length },
                  { key: 'synced', label: 'Synced', count: syncedFiles.length },
                ] as const).map(t => (
                  <Button
                    key={t.key}
                    variant="ghost"
                    size="sm"
                    aria-pressed={filter === t.key}
                    onClick={() => changeFilter(t.key)}
                    className={cn(
                      'h-6 px-2 text-caption font-medium rounded-nested',
                      filter === t.key
                        ? 'bg-overlay-active text-text-emphatic hover:bg-overlay-active'
                        : 'text-text-muted hover:text-text-emphatic hover:bg-transparent',
                    )}
                  >
                    {t.label}
                    <span className="hidden @6xl:inline">&nbsp;({t.count})</span>
                  </Button>
                ))}
              </div>
  
              {/* The rating filter, as in the Workstation: one button, so it
                  is affordable at every width. */}
              <RatingFilterControl value={ratingFilter} onChange={changeRatingFilter} />

              {/* One segmented group, like every other cluster in these
                  headers. Loose coloured text reads as a label until the
                  cursor happens to cross it. */}
              <div className={cn('hidden @5xl:flex items-center h-7 p-0.5 shrink-0', TOOLBAR_CONTROL)}>
                <Button
                  variant="ghost"
                  size="sm"
                  // The files on show, like mod+A: the button selected all
                  // 678 under any filter while the shortcut selected what
                  // the filter showed.
                  onClick={() => onSetSelection(allSelected ? [] : filteredFiles.map(f => f.relativePath))}
                  className="h-6 px-2 rounded-nested text-caption font-medium text-accent-text hover:text-accent-text hover:bg-overlay-hover whitespace-nowrap"
                >
                  {allSelected ? 'Deselect' : 'Select All'}
                </Button>
  
                {selectedTileCount > 0 && selectedTileCount < sortedFiles.length && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSetSelection([])}
                    title="Unselect all (Esc)"
                    aria-label="Unselect all"
                    className="h-6 px-2 rounded-nested text-caption font-medium text-text-muted hover:text-text-default hover:bg-overlay-hover whitespace-nowrap"
                  >
                    {/* Both selection buttons at 1280 wide were wider than
                        the toolbar and the second was cut off. */}
                    <span className="@7xl:hidden">Clear</span>
                    <span className="hidden @7xl:inline">Unselect All</span>
                  </Button>
                )}
              </div>
  
              {(
                <div className="hidden @7xl:flex items-center gap-space-3 min-w-0">
                  <ToolbarSeparator />
                  <span className="text-code text-text-muted truncate min-w-0">
                    {selectedTileCount} / {sortedFiles.length} selected
                  </span>
                </div>
              )}
            </div>
          </>
        }
        right={
          <>
            <Button
              variant="neutral"
              size="sm"
              onClick={onCancel}
              className="h-7 px-2 text-caption font-medium"
            >
              Discard
            </Button>
  
            {selectedFiles.size > 0 && !selectionIsPreset && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmTrash(true)}
                disabled={isTrashing}
                title={`Move ${selectedFiles.size} file${selectedFiles.size === 1 ? '' : 's'} to Trash`}
                className={cn(
                  'h-7 px-2 gap-1.5 text-caption font-medium',
                  'border border-status-danger/40 bg-status-danger/10 text-status-danger',
                  'hover:bg-status-danger/20 hover:text-status-danger',
                )}
              >
                {isTrashing ? <RefreshCw size={11} className="animate-spin" /> : <Trash2 size={11} />}
                <span className="sr-only @xl:not-sr-only">
                  {isTrashing && trashProgress
                    ? `Moving ${trashProgress.done} of ${trashProgress.total}`
                    : <>Trash {selectedFiles.size > 0 ? selectedFiles.size : ''}</>}
                </span>
              </Button>
            )}
  
            <Button
              variant="primary"
              size="sm"
              onClick={() => onBeginIngest()}
              disabled={selectedFiles.size === 0}
              className="h-7 border border-transparent px-3 @4xl:px-5 gap-2 rounded-soft text-caption"
            >
              <span className="sr-only @md:not-sr-only">
                <span className="@4xl:hidden">Transfer</span>
                <span className="hidden @4xl:inline">Initiate Transfer</span>
              </span>
              <CheckCircle2 size={10} strokeWidth={3} />
            </Button>
          </>
        }
      />

      <div className="flex-1 flex overflow-hidden">
        <section className="flex-1 bg-surface-workspace flex flex-col overflow-hidden">
          <div ref={containerRef} className="flex-1 overflow-hidden relative">
          {viewMode === 'grid' ? (
            <PhotoGrid
              files={visibleFiles}
              selectedFiles={selectedFiles}
              onSelectClick={handleToggleClick}
              ratingOf={ratingOf}
              isPair={(path) => pairs.companionOf.has(path)}
              onSetStars={setStars}
              onSetFlag={setFlag}
              onContextMenuFile={openMenu}
              onDoubleClickFile={(path) => {
                const f = scannedFiles.find(sf => sf.relativePath === path)
                if (f) setLightboxPath(f.absolutePath)
              }}
              width={dimensions.width}
              height={dimensions.height}
              columnCount={effectiveColumns}
              focusedPath={focusedPath}
            />
          ) : (
            <List
              height={dimensions.height}
              itemCount={visibleFiles.length}
              itemSize={LIST_ROW_HEIGHT}
              width={dimensions.width}
            >
              {({ index, style }) => {
                const f = visibleFiles[index]
                const isSelected = selectedFiles.has(f.relativePath)
                return (
                  <div
                    style={style}
                    role="button"
                    tabIndex={0}
                    data-grid-key={f.relativePath}
                    aria-pressed={isSelected}
                    aria-label={f.relativePath}
                    className={cn(
                      'flex items-center px-8 border-b border-border-subtle group transition-all',
                      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-text-emphatic',
                      isSelected ? 'bg-accent-primary/5 text-text-emphatic' : 'hover:bg-overlay-hover text-text-muted',
                      // Recedes once it is on Drive, not once it is
                      // imported: a file imported and not yet uploaded is
                      // still waiting for something, and dimming it says
                      // it is done.
                      (f.isUploaded || f.isCopied || f.damage) && !isSelected && 'opacity-40',
                      focusedPath === f.relativePath && !isSelected && 'ring-1 ring-inset ring-overlay-strong',
                    )}
                    onClick={(e) => handleToggleClick(f.relativePath, e)}
                    onDoubleClick={() => setLightboxPath(f.absolutePath)}
                    onContextMenu={(e) => { e.preventDefault(); openMenu(f.relativePath, e) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        setLightboxPath(f.absolutePath)
                      } else if (e.key === ' ') {
                        e.preventDefault()
                        handleToggleClick(f.relativePath, e)
                      }
                    }}
                  >
                    <div className="flex items-center gap-6 w-full h-full">
                      <Checkbox checked={isSelected} size="sm" />

                      <div className="flex-1 flex items-center min-w-0">
                        <span title={f.relativePath} className="text-body truncate flex-1 font-mono text-text-muted group-hover:text-text-default">{f.relativePath}</span>
                        <div className="flex items-center gap-8 px-4 shrink-0 text-code">
                          <span className="w-20 text-right text-text-muted">{formatBytes(f.sizeBytes)}</span>
                          <span className="w-14 flex items-center justify-end gap-1.5 text-text-muted">
                            {(ratingOf(f.relativePath)?.userStars ?? 0) > 0 && (
                              <span className="flex items-center gap-0.5" title={`${ratingOf(f.relativePath)?.userStars} stars`}>
                                <Star size={10} className="text-status-warn" fill="currentColor" aria-hidden />
                                {ratingOf(f.relativePath)?.userStars}
                              </span>
                            )}
                            {ratingOf(f.relativePath)?.flag === 'pick' && <Flag size={10} className="text-accent-text" aria-label="Pick" />}
                          </span>
                          <span className="w-16 uppercase text-text-muted whitespace-nowrap" title={pairs.companionOf.has(f.relativePath) ? 'A RAW and a JPEG of the same shot' : undefined}>
                            {f.relativePath.split('.').pop()}{pairs.companionOf.has(f.relativePath) ? '+RAW' : ''}
                          </span>
                          <div className="w-20 flex justify-end">
                            <SyncBadge state={syncStateFor(f)} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }}
            </List>
          )}
          </div>

          <Pager pagination={pagination} noun="file" />
        </section>

        <Inspector title="Summary" icon={<ClipboardList size={12} className="text-text-muted" />}>
          <InspectorSection>
            <InspectorRow label="Total" value={scannedFiles.length} mono />
            {pairs.companionOf.size > 0 && (
              <InspectorRow label="RAW + JPEG pairs" value={pairs.companionOf.size} mono />
            )}
            <InspectorRow label="Not synced" value={unsyncedFiles.length} mono valueClassName="text-text-emphatic" />
            <InspectorRow label="Synced" value={syncedFiles.length} mono valueClassName="text-text-muted" />
            <Separator className="my-space-2" />
            <InspectorRow label="Selected" value={selectedFiles.size} mono valueClassName="text-accent-text" />
            <InspectorRow label="Transfer size" value={formatBytes(selectedSize)} mono />
          </InspectorSection>
        </Inspector>
      </div>

      <ReviewContextMenu
        menu={menu}
        isSelected={!!menu && selectedFiles.has(menu.path)}
        canTrash={selectedFiles.size > 0 && !selectionIsPreset && !isTrashing}
        onOpen={(path) => { const f = scannedFiles.find(sf => sf.relativePath === path); if (f) setLightboxPath(f.absolutePath) }}
        onToggleSelect={toggle}
        onReveal={(path) => {
          const f = scannedFiles.find(sf => sf.relativePath === path)
          if (f) window.electronAPI.mediaReveal(f.absolutePath).catch((err) => toast(messageOf(err) || 'Could not show that file.', 'error'))
        }}
        onTrash={() => setConfirmTrash(true)}
        onClose={() => setMenu(null)}
      />

      <Lightbox
        isOpen={!!lightboxPath}
        onClose={() => {
          const path = lightboxPath
          setLightboxPath(null)
          // Back on the tile of the photograph last on screen, which may be
          // on another page than the one that opened the viewer.
          if (path) requestAnimationFrame(() => requestAnimationFrame(() => {
            document.querySelector<HTMLElement>(`[data-grid-key="${CSS.escape(filteredFiles.find(f => f.absolutePath === path)?.relativePath ?? '')}"]`)?.focus()
          }))
        }}
        onNext={handleNextLightbox}
        onPrev={handlePrevLightbox}
        frameKey={lightboxPath ?? undefined}
        fileName={lightboxFile ? lightboxFile.relativePath.split(/[\\/]/).pop() + (pairs.companionOf.has(lightboxFile.relativePath) ? '  (RAW + JPEG)' : '') : undefined}
        // Deciding what to import is what this surface is for, and full
        // screen is where that decision actually gets made. The chip and
        // the Space binding have been in Lightbox since it was written
        // with no caller passing the props, so the control could not be
        // reached from anywhere and the shortcut sheet's "Space. Select
        // or deselect this one" was a promise nothing could keep.
        userStars={lightboxFile ? ratingOf(lightboxFile.relativePath)?.userStars ?? null : null}
        flag={lightboxFile ? ratingOf(lightboxFile.relativePath)?.flag ?? null : null}
        onSetStars={lightboxFile ? (s) => setStars(lightboxFile.relativePath, s) : undefined}
        onSetFlag={lightboxFile ? (f) => setFlag(lightboxFile.relativePath, f) : undefined}
        isSelected={!!lightboxFile && selectedFiles.has(lightboxFile.relativePath)}
        onToggleSelect={lightboxFile ? () => toggle(lightboxFile.relativePath) : undefined}
      >
        {lightboxPath && (
          // Keyed on the path: stepping to the next frame with the arrow
          // keys has to start waiting again, not hold the previous
          // photograph while this one decodes.
          // The thumbnail the grid already decoded stands in while the
          // full frame arrives, at the same edge size the grid asked
          // for so it is a cache hit rather than a second decode. A
          // photograph opened from the grid therefore appears at once,
          // soft, and sharpens; the skeleton is left for the case where
          // nobody has seen this frame yet.
          isVideoPath(lightboxPath) ? (
            // A video plays, with its controls and sound. The frame
            // component only knows how to wait for a photograph, so a
            // clip sat as an empty placeholder for good.
            <video
              key={lightboxPath}
              src={`cernix-media://local/${encodeURIComponent(lightboxPath)}`}
              controls
              autoPlay
              className="relative max-w-full max-h-full rounded-soft shadow-2xl"
            />
          ) : (
            <MediaFrame
              key={lightboxPath}
              src={`cernix-media://local/${encodeURIComponent(lightboxPath)}?v=${lightboxVersion}`}
              lowSrc={`cernix-media://local/${encodeURIComponent(lightboxPath)}?thumb=${lightboxThumbEdge}&v=${lightboxVersion}`}
            />
          )
        )}
      </Lightbox>
      {/* Trash asks first. It moved files straight to the Recycle Bin, with
          no undo, from a toolbar that opened on "Trash 678"; and a memory
          card may have no Recycle Bin, so asking is the only safety. */}
      <Modal
        open={confirmTrash}
        onOpenChange={setConfirmTrash}
        title={`Move ${selectedTileCount} photo${selectedTileCount === 1 ? '' : 's'} to the Trash?`}
        icon={<Trash2 size={14} className="text-status-danger" />}
        description={`${pairsSelected > 0 ? `${pairsSelected === 1 ? 'One is a RAW+JPEG pair' : `${pairsSelected} are RAW+JPEG pairs`}: both files of each go, so that is ${selectedFiles.size} files. ` : ''}They are removed from the card or folder they are on. On a memory card there may be no Recycle Bin to bring them back from.`}
        actions={
          <>
            <Button variant="neutral" size="sm" onClick={() => setConfirmTrash(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => { setConfirmTrash(false); void handleTrashSelected() }}
            >
              Move to Trash
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </div>
  )
}


