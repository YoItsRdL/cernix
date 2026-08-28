import { useState, useRef, useEffect, useMemo } from 'react'

/** Height of one row in list view. The page arithmetic needs it too. */
const LIST_ROW_HEIGHT = 36
import { useListSelection } from '@/hooks/useListSelection'
import { Toolbar, TOOLBAR_CONTROL, ToolbarSeparator } from '@/components/ui/toolbar'
import { List as ListIcon, Grid3x3 as GridIcon, CheckCircle2, RefreshCw, Trash2, ClipboardList } from 'lucide-react'
import { FixedSizeList as List } from 'react-window'
import { PhotoGrid } from './PhotoGrid'
import { autoColumnCount, defaultColumnCount, photoGridPageSize } from '@/lib/photo-grid'
import { GRID_GUTTER, thumbEdgeFor, usableWidth } from '@/lib/grid'
import { Lightbox } from './Lightbox'
import { useToast } from '../hooks/useToast'
import { type ScannedFile } from '@/types'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { IconButton } from './ui/icon-button'
import { Separator } from './ui/separator'
import { Pager } from './ui/pager'
import { SyncBadge } from './ui/sync-badge'
import { syncStateFor } from '@/lib/sync-state'
import { usePagination } from '@/hooks/usePagination'
import { useGridNavigation } from '@/hooks/useGridNavigation'
import { Inspector, InspectorSection, InspectorRow } from './ui/inspector'
import { MediaFrame } from './ui/frame-ground'
import { Checkbox } from './ui/checkbox'

interface ReviewViewProps {
  scannedFiles: ScannedFile[]
  selectedFiles: Set<string>
  onToggleAll: () => void
  onSetSelection: (paths: string[]) => void
  /** Drop the given relative paths from the local review state: called
   *  after the OS-level trash IPC has accepted them. */
  onRemoveFiles: (relativePaths: string[]) => void
  onCancel: () => void
  onBeginIngest: () => void
}

export function ReviewView({
  scannedFiles,
  selectedFiles,
  onToggleAll,
  onSetSelection,
  onRemoveFiles,
  onCancel,
  onBeginIngest,
}: ReviewViewProps) {
  /** Inflight trash op: disables the button and swaps in a spinner so
   *  a slow OS trash dispatch can't be re-clicked into a duplicate run. */
  const [isTrashing, setIsTrashing] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [filter, setFilter] = useState<'all' | 'unsynced' | 'synced'>('all')
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

  // Sort newest-first by capture date when available, else mtime.
  // Memoised so selection toggles don't re-sort 1000s of items on
  // every render.
  const sortedFiles = useMemo(() => (
    [...scannedFiles].sort((a, b) => {
      const ta = (a.captureDate ? new Date(a.captureDate).getTime() : 0) || new Date(a.mtime).getTime()
      const tb = (b.captureDate ? new Date(b.captureDate).getTime() : 0) || new Date(b.mtime).getTime()
      return tb - ta
    })
  ), [scannedFiles])
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
  const filteredFiles = filter === 'unsynced' ? unsyncedFiles : filter === 'synced' ? syncedFiles : sortedFiles

  // A page is whatever fills the viewport in whole rows, so the two
  // views page differently: the grid's row height follows the column
  // count, the list's is a flat 36px.
  const pageSize = viewMode === 'grid'
    ? photoGridPageSize(dimensions.width, dimensions.height, effectiveColumns)
    : Math.max(1, Math.floor(dimensions.height / LIST_ROW_HEIGHT))
  // Identity is the active filter: narrowing to Synced starts at its
  // first file, not wherever the unfiltered page number landed.
  const pagination = usePagination(filteredFiles.length, pageSize, filter)
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

  const selectedSize = Array.from(selectedFiles).reduce((s, path) => {
    const f = scannedFiles.find(file => file.relativePath === path)
    return s + (f?.sizeBytes || 0)
  }, 0)

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
    const wanted = Math.floor(index / pagination.pageSize)
    if (wanted !== pagination.page) pagination.setPage(wanted)
  }

  const handleNextLightbox = canCycleLightbox
    ? () => openLightboxAt((lightboxIndex + 1) % filteredFiles.length)
    : undefined
  const handlePrevLightbox = canCycleLightbox
    ? () => openLightboxAt((lightboxIndex - 1 + filteredFiles.length) % filteredFiles.length)
    : undefined

  const allSelected = selectedFiles.size === scannedFiles.length && scannedFiles.length > 0

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
  const { focusedIndex } = useGridNavigation({
    total: filteredFiles.length,
    columns: viewMode === 'grid' ? effectiveColumns : 1,
    pagination,
    idAt: i => filteredFiles[i]?.relativePath,
    onSelect: onSetSelection,
    onActivate: i => {
      const f = filteredFiles[i]
      if (f) setLightboxPath(f.absolutePath)
    },
    enabled: !lightboxPath,
  })
  const focusedPath = focusedIndex === null ? undefined : filteredFiles[focusedIndex]?.relativePath

  const handleTrashSelected = async () => {
    if (selectedFiles.size === 0 || isTrashing) return
    const targets = scannedFiles.filter(f => selectedFiles.has(f.relativePath))
    setIsTrashing(true)
    try {
      const result = await window.electronAPI.mediaTrash(targets.map(f => f.absolutePath))
      // Map the OS-accepted absolute paths back to the relative paths
      // the UI uses, so we only drop the files that actually got
      // trashed. Anything that failed stays in the list. The user can
      // see what didn't go through.
      const trashedSet = new Set(result.trashedPaths)
      const trashedRelative = targets
        .filter(f => trashedSet.has(f.absolutePath))
        .map(f => f.relativePath)
      if (trashedRelative.length > 0) onRemoveFiles(trashedRelative)
      const trashed = result.trashedPaths.length
      const failed = result.failures.length
      if (failed === 0) {
        toast(`Moved ${trashed} file${trashed === 1 ? '' : 's'} to Trash.`, 'success')
      } else if (trashed === 0) {
        toast(`Failed to move ${failed} file${failed === 1 ? '' : 's'} to Trash.`, 'error')
      } else {
        toast(`Trashed ${trashed}, failed ${failed}.`, 'info')
      }
    } catch (err) {
      console.error('mediaTrash failed', err)
      toast('Trash failed.', 'error')
    } finally {
      setIsTrashing(false)
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
              <span className="text-body font-medium text-text-emphatic whitespace-nowrap">
                <span className="@3xl:hidden">Audit</span>
                <span className="hidden @3xl:inline">Audit Batch Review</span>
              </span>
              <span className="text-code text-text-disabled">[{scannedFiles.length}]</span>
            </div>
  
            {(
              <div className="hidden @2xl:flex items-center gap-2 shrink-0 ml-4">
                <div className="flex items-center h-7 bg-surface-workspace p-0.5 rounded-soft border border-border-subtle">
                  <IconButton
                    aria-label="Grid view"
                    title="Grid view"
                    icon={<GridIcon size={12} strokeWidth={1.5} />}
                    onClick={() => setViewMode('grid')}
                    className={cn(
                      'h-6 w-6 rounded-nested',
                      viewMode === 'grid'
                        ? 'bg-overlay-active text-text-emphatic hover:bg-overlay-active'
                        : 'text-text-disabled hover:text-text-muted',
                    )}
                  />
                  <IconButton
                    aria-label="List view"
                    title="List view"
                    icon={<ListIcon size={12} strokeWidth={1.5} />}
                    onClick={() => setViewMode('list')}
                    className={cn(
                      'h-6 w-6 rounded-nested',
                      viewMode === 'list'
                        ? 'bg-overlay-active text-text-emphatic hover:bg-overlay-active'
                        : 'text-text-disabled hover:text-text-muted',
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
                  { key: 'all', label: 'All', count: scannedFiles.length },
                  { key: 'unsynced', label: 'Not synced', count: unsyncedFiles.length },
                  { key: 'synced', label: 'Synced', count: syncedFiles.length },
                ] as const).map(t => (
                  <Button
                    key={t.key}
                    variant="ghost"
                    size="sm"
                    onClick={() => setFilter(t.key)}
                    className={cn(
                      'h-6 px-2 text-caption font-medium rounded-nested',
                      filter === t.key
                        ? 'bg-overlay-active text-text-emphatic hover:bg-overlay-active'
                        : 'text-text-disabled hover:text-text-muted hover:bg-transparent',
                    )}
                  >
                    {t.label}
                    <span className="hidden @6xl:inline">&nbsp;({t.count})</span>
                  </Button>
                ))}
              </div>
  
              {/* One segmented group, like every other cluster in these
                  headers. Loose coloured text reads as a label until the
                  cursor happens to cross it. */}
              <div className={cn('hidden @5xl:flex items-center h-7 p-0.5 shrink-0', TOOLBAR_CONTROL)}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onToggleAll()
                  }}
                  className="h-6 px-2 rounded-nested text-caption font-medium text-accent-primary hover:text-accent-primary hover:bg-overlay-hover whitespace-nowrap"
                >
                  {allSelected ? 'Deselect' : 'Select All'}
                </Button>
  
                {selectedFiles.size > 0 && selectedFiles.size < scannedFiles.length && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSetSelection([])}
                    title="Unselect all (Esc)"
                    className="h-6 px-2 rounded-nested text-caption font-medium text-text-muted hover:text-text-default hover:bg-overlay-hover whitespace-nowrap"
                  >
                    Unselect All
                  </Button>
                )}
              </div>
  
              {(
                <div className="hidden @7xl:flex items-center gap-space-3 min-w-0">
                  <ToolbarSeparator />
                  <span className="text-code text-text-disabled truncate min-w-0">
                    {selectedFiles.size} / {scannedFiles.length} selected
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
  
            {selectedFiles.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleTrashSelected}
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
                  Trash {selectedFiles.size > 0 ? selectedFiles.size : ''}
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
        <main className="flex-1 bg-surface-workspace flex flex-col overflow-hidden">
          <div ref={containerRef} className="flex-1 overflow-hidden relative">
          {viewMode === 'grid' ? (
            <PhotoGrid
              files={visibleFiles}
              selectedFiles={selectedFiles}
              onSelectClick={handleToggleClick}
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
                    aria-pressed={isSelected}
                    aria-label={`${f.relativePath}${isSelected ? ' (selected)' : ''}`}
                    className={cn(
                      'flex items-center px-8 border-b border-border-subtle group transition-all',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus',
                      isSelected ? 'bg-accent-primary/5 text-text-emphatic' : 'hover:bg-overlay-hover text-text-muted',
                      // Recedes once it is on Drive, not once it is
                      // imported: a file imported and not yet uploaded is
                      // still waiting for something, and dimming it says
                      // it is done.
                      f.isUploaded && !isSelected && 'opacity-40',
                      focusedPath === f.relativePath && !isSelected && 'ring-1 ring-inset ring-overlay-strong',
                    )}
                    onClick={(e) => handleToggleClick(f.relativePath, e)}
                    onDoubleClick={() => setLightboxPath(f.absolutePath)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleToggleClick(f.relativePath, e)
                      }
                    }}
                  >
                    <div className="flex items-center gap-6 w-full h-full">
                      <Checkbox checked={isSelected} size="sm" />

                      <div className="flex-1 flex items-center min-w-0">
                        <span className="text-body truncate flex-1 font-mono text-text-muted group-hover:text-text-default">{f.relativePath}</span>
                        <div className="flex items-center gap-8 px-4 shrink-0 text-code">
                          <span className="w-20 text-right text-text-disabled">{formatBytes(f.sizeBytes)}</span>
                          <span className="w-12 uppercase text-text-disabled">{f.relativePath.split('.').pop()}</span>
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
        </main>

        <Inspector title="Summary" icon={<ClipboardList size={12} className="text-text-muted" />}>
          <InspectorSection>
            <InspectorRow label="Total" value={scannedFiles.length} mono />
            <InspectorRow label="Not synced" value={unsyncedFiles.length} mono valueClassName="text-text-emphatic" />
            <InspectorRow label="Synced" value={syncedFiles.length} mono valueClassName="text-text-disabled" />
            <Separator className="my-space-2" />
            <InspectorRow label="Selected" value={selectedFiles.size} mono valueClassName="text-accent-primary" />
            <InspectorRow label="Transfer size" value={formatBytes(selectedSize)} mono />
          </InspectorSection>
        </Inspector>
      </div>

      <Lightbox
        isOpen={!!lightboxPath}
        onClose={() => setLightboxPath(null)}
        onNext={handleNextLightbox}
        onPrev={handlePrevLightbox}
        frameKey={lightboxPath ?? undefined}
        fileName={lightboxFile?.relativePath.split(/[\\/]/).pop()}
        // Deciding what to import is what this surface is for, and full
        // screen is where that decision actually gets made. The chip and
        // the Space binding have been in Lightbox since it was written
        // with no caller passing the props, so the control could not be
        // reached from anywhere and the shortcut sheet's "Space. Select
        // or deselect this one" was a promise nothing could keep.
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
          <MediaFrame
            key={lightboxPath}
            src={`cernix-media://local/${encodeURIComponent(lightboxPath)}`}
            lowSrc={`cernix-media://local/${encodeURIComponent(lightboxPath)}?thumb=${lightboxThumbEdge}`}
          />
        )}
      </Lightbox>
    </div>
  )
}


function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
