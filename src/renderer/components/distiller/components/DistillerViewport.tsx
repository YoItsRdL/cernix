import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { FixedSizeGrid as Grid, type GridChildComponentProps } from 'react-window'
import { FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { AssetTile } from '../../AssetTile'
import { AuthImage } from './AuthImage'
import { VideoThumbnail } from '../../VideoThumbnail'
import { getIcon, formatSize, formatDate } from '../utils/distiller-utils'
import { DriveFile, DriveFolder, MOVE_DRAG_MIME, readMoveDragIds } from '../distiller-types'
import { GRID_GUTTER, maxColumnsFor, defaultColumnsFor, pageSizeFor, usableWidth, SCROLL_GUTTER } from '@/lib/grid'
import { Pager } from '@/components/ui/pager'
import { usePagination } from '@/hooks/usePagination'
import { SkeletonCells } from '@/components/ui/skeleton'
import { useDeferredLoading } from '@/hooks/useDeferredLoading'
import { useGridNavigation } from '@/hooks/useGridNavigation'
import { RatingRecord, RatingStars, RatingFlag } from '../../../types'
import type { ContextMenuState } from '../distiller-types'

/** Height of one row in list view. The page arithmetic needs it too. */
const LIST_ROW_HEIGHT = 36

interface DistillerViewportProps {
  items: (DriveFile | DriveFolder)[]
  /** Waiting on Drive. Draws placeholders on the real geometry. */
  loading: boolean
  /** Which list this is. Paging starts over when it changes. */
  listId: string
  viewMode: 'grid' | 'list'
  selected: Set<string>
  focusedId: string | null
  ratings: Map<string, RatingRecord>
  columnOverride: number | null
  autoMaxColumns: number
  defaultColumns: number
  /** Ids currently under the cursor in a drag, or null. */
  draggingIds: string[] | null
  /** Ids armed by "Move to…" and waiting for a destination, or null. */
  pendingMove: string[] | null
  renaming: string | null
  renameValue: string
  actions: {
    setFocusedId: (id: string | null) => void
    /** Replace the whole selection: what arrowing through the grid does. */
    applySelection: (ids: string[]) => void
    toggleSelect: (id: string, e: React.MouseEvent) => void
    toggleSelectOne: (id: string, e: React.MouseEvent) => void
    navigateToFolder: (folder: DriveFolder) => void
    setLightboxId: (id: string) => void
    setContextMenu: (menu: ContextMenuState | null) => void
    setRenameValue: (val: string) => void
    handleRename: (id: string) => void
    onSetStars: (fileId: string, stars: RatingStars | null) => void
    onSetFlag: (fileId: string, flag: RatingFlag) => void
    setAutoMaxColumns: (count: number) => void
    setDefaultColumns: (count: number) => void
    setDraggingIds: (ids: string[] | null) => void
    handleMoveTo: (targetId: string, ids?: string[]) => void
    handleTrashBatch: (ids: string[]) => void
  }
}

/**
 * What the cursor carries while a drag is in flight.
 *
 * Chromium's default is a screenshot of the element the drag started
 * on, which here is a tile the size of a playing card: it covers the
 * grid you are trying to aim at, and on a frame that has not decoded
 * yet it is a large grey rectangle. Dragging then reads as nothing but
 * the platform's not-allowed cursor, which says only where you cannot
 * go and never what you are holding.
 *
 * This is the photograph at thumbnail size with its name, or a count
 * when there are several: what Finder shows, and what the gesture
 * actually means.
 *
 * The node has to be in the document and painted at the moment
 * `setDragImage` is called, so it is parked off-screen with inline
 * styles (no utility class can be purged out from under it) and
 * removed on the next frame, by which time the snapshot is taken.
 */
function setDragImage(e: React.DragEvent, count: number, name: string) {
  const ghost = document.createElement('div')
  // Named so a test can prove it does not outlive the drag: a stray
  // ghost would sit under the pointer forever.
  ghost.dataset.dragGhost = 'true'
  ghost.className =
    'flex items-center gap-space-2 h-11 pl-1 pr-space-3 rounded-soft ' +
    'border border-border-strong bg-surface-panel shadow-lg'
  ghost.style.position = 'fixed'
  ghost.style.top = '-1000px'
  ghost.style.left = '0'

  const thumb = document.createElement('div')
  thumb.className =
    'w-9 h-9 rounded-nested overflow-hidden shrink-0 ' +
    'bg-surface-workspace border border-border-subtle'
  const source = (e.currentTarget as HTMLElement).querySelector('img')
  if (source?.src) {
    const clone = document.createElement('img')
    clone.src = source.src
    clone.className = 'w-full h-full object-cover'
    thumb.appendChild(clone)
  }
  ghost.appendChild(thumb)

  const label = document.createElement('span')
  label.className = 'text-caption text-text-default whitespace-nowrap'
  label.textContent = count === 1 ? name : `${count} items`
  ghost.appendChild(label)

  document.body.appendChild(ghost)
  // Held under the pointer rather than pinned by its corner, so the
  // thing being carried sits where the hand is.
  e.dataTransfer.setDragImage(ghost, 20, 22)
  requestAnimationFrame(() => ghost.remove())
}

export function DistillerViewport({
  items, loading, listId, viewMode, selected, focusedId, ratings, columnOverride,
  autoMaxColumns: stateAutoMaxColumns, defaultColumns: stateDefaultColumns,
  draggingIds, pendingMove, renaming, renameValue, actions
}: DistillerViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 0, height: 0 })
  const renameInputRef = useRef<HTMLInputElement>(null)
  // Which folder is lit up right now. Local, because nothing outside the
  // grid needs to know where the cursor happens to be.
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  /**
   * What a drag carries.
   *
   * Dragging a tile inside the selection moves the whole selection.
   * Anything else would silently drop the other twenty items the user
   * had picked. Dragging an unselected tile carries just that one and
   * leaves the selection alone.
   */
  const idsForDrag = useCallback((id: string) => (
    selected.has(id) ? [...selected] : [id]
  ), [selected])


  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDims({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // Every width here is the usable one. The container minus the
  // scrollbar's reserved gutter. Sizing columns to the full container
  // is what put a horizontal scrollbar under the grid: the vertical
  // scrollbar takes its width from the inside, so three columns that
  // fitted 983px no longer fit the 973px left over.
  const gridWidth = usableWidth(dims.width)

  // Both counts come from lib/grid so the header and the grid cannot
  // disagree about them.
  const calculatedAutoMaxColumns = viewMode === 'grid' ? maxColumnsFor(gridWidth) : 1
  const calculatedDefaultColumns = viewMode === 'grid' ? defaultColumnsFor(gridWidth) : 1

  useEffect(() => { 
  // Pulse column count to parent ONLY if it strictly differs from current state
    if (calculatedAutoMaxColumns !== stateAutoMaxColumns) {
      actions.setAutoMaxColumns(calculatedAutoMaxColumns) 
    }
  }, [calculatedAutoMaxColumns, stateAutoMaxColumns, actions])

  // The header shows and steps this number, but only the viewport knows
  // the width it comes from, so it is reported upward the same way.
  useEffect(() => {
    if (calculatedDefaultColumns !== stateDefaultColumns) {
      actions.setDefaultColumns(calculatedDefaultColumns)
    }
  }, [calculatedDefaultColumns, stateDefaultColumns, actions])

  const columnCount = viewMode === 'grid'
    ? Math.min(Math.max(1, columnOverride ?? calculatedDefaultColumns), calculatedAutoMaxColumns)
    : 1

  const columnWidth = gridWidth / columnCount
  const rowHeight = viewMode === 'grid' ? columnWidth : LIST_ROW_HEIGHT

  const pageSize = pageSizeFor(dims.height, rowHeight, columnCount)
  // Identity is the folder: opening one starts at its beginning.
  const pagination = usePagination(items.length, pageSize, listId)
  const pageItems = useMemo(
    () => items.slice(pagination.start, pagination.end),
    [items, pagination.start, pagination.end],
  )
  const rowCount = Math.ceil(pageItems.length / columnCount)

  // Held back on a fast folder and held open on a slow one. See
  // useDeferredLoading. Most folders return before the placeholder
  // would earn its place.
  const showSkeleton = useDeferredLoading(loading)

  // Arrow keys, Home/End and the page keys, over the whole folder. The
  // page follows the focus rather than fencing it in. Held back while a
  // move is armed or a rename is open, both of which own the keyboard.
  const { focusedIndex } = useGridNavigation({
    total: items.length,
    columns: columnCount,
    pagination,
    idAt: i => items[i]?.id,
    onSelect: actions.applySelection,
    onActivate: i => {
      const item = items[i]
      if (!item) return
      if ('mimeType' in item && (item as DriveFile).mimeType !== 'application/vnd.google-apps.folder') {
        actions.setLightboxId(item.id)
      } else {
        actions.navigateToFolder(item as DriveFolder)
      }
    },
    enabled: pendingMove === null && renaming === null,
  })

  // The grid already draws a ring for focusedId, so the keyboard reports
  // through the same channel rather than introducing a second one.
  const keyboardFocusId = focusedIndex === null ? null : items[focusedIndex]?.id ?? null
  useEffect(() => {
    if (keyboardFocusId && keyboardFocusId !== focusedId) actions.setFocusedId(keyboardFocusId)
  }, [keyboardFocusId, focusedId, actions])

  /**
   * Everything a cell reads, handed to react-window as itemData.
   *
   * Cell used to be built by useMemo, which meant a new component
   * *type* every time one of its inputs changed. React cannot reconcile
   * two different types, so it unmounted every tile and mounted fresh
   * ones. On every selection change, and, fatally, the instant a drag
   * set draggingIds. Chromium cancels a drag the moment its source
   * element leaves the document, so dragging a photo died in the same
   * frame it began. The grid looked draggable and could never be.
   *
   * Cell now has one identity for the life of the component and reads
   * its inputs from data, which is how react-window is meant to be fed.
   * Tiles update in place instead of being rebuilt.
   */
  // The cell reads every field off this, so it is named rather than
  // inferred: `data: any` on the cell meant a typo in either place went
  // unnoticed until a tile rendered blank.
  const itemData = useMemo(() => ({
    items: pageItems, columnCount, viewMode, selected, ratings, actions, renaming, renameValue,
    renameInputRef, focusedId, draggingIds, pendingMove, dropTargetId, setDropTargetId, idsForDrag
  }), [
    pageItems, columnCount, viewMode, selected, ratings, actions, renaming, renameValue, renameInputRef, focusedId, draggingIds, pendingMove, dropTargetId, setDropTargetId, idsForDrag
  ])

  // Derived from the memo rather than written out again: the cell reads
  // every field off it, and two hand-kept lists would drift.
  type CellData = typeof itemData

  const Cell = useCallback(({ columnIndex, rowIndex, style, data }: GridChildComponentProps<CellData>) => {
    const {
      items, columnCount, viewMode, selected, ratings, actions, renaming, renameValue,
      renameInputRef, focusedId, draggingIds, pendingMove, dropTargetId, setDropTargetId, idsForDrag
    } = data
    const index = rowIndex * columnCount + columnIndex
    if (index >= items.length) return null
    const item = items[index]
    const isFolder = !('mimeType' in item) || (item as DriveFile).mimeType === 'application/vnd.google-apps.folder'
    const isSelected = selected.has(item.id)

    if (viewMode === 'list') {
      return (
        <div 
          style={style} 
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            if (selected.size > 0) {
              actions.toggleSelect(item.id, e)
            } else {
              if (isFolder) actions.navigateToFolder(item as DriveFolder)
              else if (item.thumbnailLink || (item as DriveFile).mimeType) actions.setLightboxId(item.id)
            }
          }}
          onContextMenu={(e: React.MouseEvent) => {
            e.preventDefault()
            actions.setContextMenu({ x: e.clientX, y: e.clientY, id: item.id, type: isFolder ? 'folder' : 'file' })
          }}
          className={cn(
            'flex items-center px-4 gap-3 cursor-pointer group border-b border-overlay-hover',
            isSelected ? 'bg-accent-primary/10 text-text-emphatic' : 'hover:bg-overlay-hover text-text-muted'
          )}
        >
          <div 
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation()
              actions.toggleSelect(item.id, e)
            }}
            className="cursor-pointer"
          >
            <Checkbox
              checked={isSelected}
              size="sm"
              // Fades harder than the tile's because a list row is dense
              // and every row carries one.
              className={cn('hover:border-accent-primary/50', isSelected ? '' : 'opacity-40 group-hover:opacity-100')}
            />
          </div>
          {isFolder ? <FolderOpen size={14} className="text-secondary/70 shrink-0" /> : getIcon((item as DriveFile).mimeType)}
          
          {renaming === item.id ? (
            <input /* eslint-disable-line no-restricted-syntax -- design-allow: an underline rename field inside a tile; the shared Input draws a box */
              ref={renameInputRef}
              value={renameValue}
              onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => actions.setRenameValue(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter') actions.handleRename(item.id)
                if (e.key === 'Escape') actions.setRenameValue('')
              }}
              className="flex-1 bg-transparent text-body text-text-default focus:outline-none border-b border-accent-primary/40"
            />
          ) : (
            <span className="text-body flex-1 truncate font-medium">{item.name}</span>
          )}
          
          {!isFolder && <span className="text-code text-text-disabled font-mono w-16 text-right shrink-0">{formatSize((item as DriveFile).size)}</span>}
          <span className="text-code text-text-disabled font-mono w-24 text-right shrink-0">{formatDate(item.createdTime)}</span>
        </div>
      )
    }

    return (
      <div 
        style={{
          ...style,
          left: Number(style.left) + GRID_GUTTER / 2,
          top: Number(style.top) + GRID_GUTTER / 2,
          width: Number(style.width) - GRID_GUTTER,
          height: Number(style.height) - GRID_GUTTER,
        }}
        className={cn(focusedId === item.id && !isSelected && 'ring-1 ring-overlay-strong')}
      >
        <AssetTile
          id={item.id}
          name={item.name}
          draggable
          isDropTarget={isFolder && dropTargetId === item.id}
          onDragStart={(e: React.DragEvent) => {
            const ids = idsForDrag(item.id)
            actions.setDraggingIds(ids)
            e.dataTransfer.effectAllowed = 'move'
            // Carried for real rather than tracked only in state, so the
            // gesture is a genuine drag; the state copy is what the drop
            // targets read, since getData is blank until the drop.
            e.dataTransfer.setData(MOVE_DRAG_MIME, JSON.stringify(ids))
            setDragImage(e, ids.length, item.name)
          }}
          onDragEnd={() => {
            actions.setDraggingIds(null)
            setDropTargetId(null)
          }}
          onDragOver={isFolder ? (e: React.DragEvent) => {
            // Only `types` is readable during dragover, so acceptance is
            // decided by MIME. The self-drop check uses state when it has
            // caught up and is repeated on drop where the ids are real.
            if (!e.dataTransfer.types.includes(MOVE_DRAG_MIME)) return
            if (draggingIds?.includes(item.id)) return
            // preventDefault is what marks this a valid drop target;
            // without it the browser refuses the drop entirely.
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (dropTargetId !== item.id) setDropTargetId(item.id)
          } : undefined}
          onDragLeave={isFolder ? () => {
            setDropTargetId((prev: string | null) => (prev === item.id ? null : prev))
          } : undefined}
          onDrop={isFolder ? (e: React.DragEvent) => {
            e.preventDefault()
            e.stopPropagation()
            setDropTargetId(null)
            const ids = readMoveDragIds(e) ?? draggingIds
            if (ids && ids.length > 0 && !ids.includes(item.id)) {
              actions.handleMoveTo(item.id, ids)
            }
          } : undefined}
          sizeText={isFolder ? '--' : formatSize((item as DriveFile).size)}
          isSelected={isSelected}
          userStars={isFolder ? null : ratings.get(item.id)?.userStars ?? null}
          flag={isFolder ? null : ratings.get(item.id)?.flag ?? null}
          onSetStars={isFolder ? undefined : (s: RatingStars) => actions.onSetStars(item.id, s)}
          onSetFlag={isFolder ? undefined : (f: RatingFlag) => actions.onSetFlag(item.id, f)}
          onTrash={isFolder ? undefined : () => actions.handleTrashBatch([item.id])}
          onToggleSelect={(e: React.MouseEvent) => actions.toggleSelectOne(item.id, e)}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            // Move mode repurposes the click: a folder is a destination,
            // not somewhere to go. Navigating instead would lose the
            // armed selection the moment the user aimed at a target.
            if (pendingMove && isFolder && !pendingMove.includes(item.id)) {
              actions.handleMoveTo(item.id)
              return
            }
            if (isFolder) {
              actions.navigateToFolder(item as DriveFolder)
            } else if (e.shiftKey || e.ctrlKey || e.metaKey) {
              actions.toggleSelect(item.id, e)
            } else {
              actions.setFocusedId(item.id)
            }
          }}
          onDoubleClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            if (!isFolder) actions.setLightboxId(item.id)
          }}
          onContextMenu={(e: React.MouseEvent) => {
            e.preventDefault()
            actions.setContextMenu({ x: e.clientX, y: e.clientY, id: item.id, type: isFolder ? 'folder' : 'file' })
          }}
          fallbackIcon={isFolder ? <FolderOpen size={14} className="text-secondary/70" /> : getIcon((item as DriveFile).mimeType)}
          imageElement={(() => {
            if (isFolder) return undefined
            const file = item as DriveFile
            // Drive auto-generates thumbnailLink for most files,
            // but it's async for video and may not exist yet for
            // a freshly uploaded clip. When present, prefer it
            // (no client-side decode required).
            if (file.thumbnailLink) {
              return <AuthImage url={file.thumbnailLink.replace('=s220', '=s400')} className="transition-transform group-hover:scale-105 object-cover" />
            }
            // Fall back to client-side frame extraction for videos:
            // bypasses the Drive thumbnail-generation lag. Uses
            // the same cernix-media://drive/<id> stream the
            // DriveVideoPlayer uses, so no new auth plumbing.
            if (file.mimeType?.startsWith('video/')) {
              return (
                <VideoThumbnail
                  videoUrl={`cernix-media://drive/${file.id}`}
                  cacheKey={file.id}
                  thumbSize={400}
                  imgClassName="transition-transform group-hover:scale-105"
                  fallback={getIcon(file.mimeType)}
                />
              )
            }
            return undefined
          })()}
        />
      </div>
    )
  }, [])

  return (
    <div className="w-full h-full flex flex-col">
      <div ref={containerRef} className="flex-1 overflow-hidden">
        {/* Placeholders, not an empty grid. A folder still loading and
            a folder with nothing in it look identical otherwise, and
            they look identical at exactly the moment the difference
            matters most. */}
        {dims.width > 0 && showSkeleton && (
          <SkeletonCells
            count={Math.min(pageSize, viewMode === 'grid' ? 24 : 16)}
            columnCount={columnCount}
            columnWidth={columnWidth}
            rowHeight={rowHeight}
            gutter={GRID_GUTTER}
            variant={viewMode === 'grid' ? 'tile' : 'row'}
          />
        )}

        {dims.width > 0 && !showSkeleton && (
          <Grid
            columnCount={columnCount}
            columnWidth={columnWidth}
            className={SCROLL_GUTTER}
            height={dims.height}
            rowCount={rowCount}
            rowHeight={rowHeight}
            width={dims.width}
            itemData={itemData}
          >
            {Cell}
          </Grid>
        )}
      </div>

      <Pager pagination={pagination} noun="item" />
    </div>
  )
}
