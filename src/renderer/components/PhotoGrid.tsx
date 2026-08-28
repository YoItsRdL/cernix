import React, { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { GRID_GUTTER, SCROLL_GUTTER, thumbEdgeFor, usableWidth } from '@/lib/grid'
import { autoColumnCount, CaptionHeight } from '@/lib/photo-grid'
import { FixedSizeGrid as Grid, areEqual } from 'react-window'
import { type ScannedFile } from '@/types'
import { cn } from '@/lib/utils'
import { FileText, Film } from 'lucide-react'
import { AssetTile } from './AssetTile'
import { syncStateFor } from '@/lib/sync-state'
import { VideoThumbnail } from './VideoThumbnail'
import { isImagePath, isVideoPath } from '../../shared/media-types'

interface PhotoGridProps {
  files: ScannedFile[]
  selectedFiles: Set<string>
  /** Modifier-aware click dispatch. The parent owns the anchor + the
   *  decision tree (single-select / Cmd-toggle / Shift-range) so the
   *  list view can share the same logic. */
  onSelectClick: (path: string, e: React.MouseEvent | React.KeyboardEvent) => void
  onDoubleClickFile?: (path: string) => void
  width: number
  height: number
  /** Force a specific column count. Omit for density-based auto-fit. */
  columnCount?: number
  /** The tile the keyboard is on, if any. Drawn with a ring so the
   *  focus is visible without a caret to look for. */
  focusedPath?: string
}

// Sizing comes from lib/grid.ts, shared with Workstation. This file
// used to carry its own 8px gutter and 160px minimum, so the two grids
// disagreed about how many columns a given width should hold.
const Gutter = GRID_GUTTER
// The scrollbar's width is measured rather than guessed. See
// lib/grid. This file used to assume 16, which is wrong on every
// platform that does not happen to use 16.
// ── Per-path selection store ──
//
// Toggling one tile used to re-render every visible cell because
// `selectedFiles` was part of `itemData`, and react-window's `areEqual`
// saw a new `data` reference on every toggle and bailed out of memo.
// The store below keeps the source of truth (a `Set<string>`) but
// notifies *only the listeners for the path that actually flipped*,
// so a click costs O(1) renders instead of O(visibleCells).
//
// The store still mirrors the parent's `selectedFiles` prop on every
// render via `sync(prop)`. That diffing is one Set walk per change,
// which is cheap compared to the hundreds of cell renders it avoids.

type Listener = () => void

class SelectionStore {
  private set = new Set<string>()
  private perPath = new Map<string, Set<Listener>>()
  private allListeners = new Set<Listener>()

  /** Replace the internal Set with `next`, notifying only the paths
   *  whose selection state actually changed plus any size-level
   *  subscribers. */
  sync(next: Set<string>): void {
    if (next === this.set) return
    const changed: string[] = []
    for (const p of this.set) if (!next.has(p)) changed.push(p)
    for (const p of next) if (!this.set.has(p)) changed.push(p)
    if (changed.length === 0 && next.size === this.set.size) return
    this.set = next
    for (const p of changed) this.perPath.get(p)?.forEach(l => l())
    this.allListeners.forEach(l => l())
  }

  isSelected(path: string): boolean {
    return this.set.has(path)
  }

  /** Subscribe to a single path. Returned function unsubscribes. */
  subscribe(path: string, listener: Listener): () => void {
    let bucket = this.perPath.get(path)
    if (!bucket) { bucket = new Set(); this.perPath.set(path, bucket) }
    bucket.add(listener)
    return () => {
      bucket!.delete(listener)
      if (bucket!.size === 0) this.perPath.delete(path)
    }
  }

  /** Subscribe to *any* selection change: unused in PhotoGrid today,
   *  but cheap to keep on the API in case callers (e.g. a footer
   *  count) want to opt in later. */
  subscribeAll(listener: Listener): () => void {
    this.allListeners.add(listener)
    return () => { this.allListeners.delete(listener) }
  }
}

// The tile's `aria-label` already exposes the file name, so the
// rendered `<img>` uses an empty `alt` to avoid a screen-reader
// stutter. Purely decorative within the tile contract.
function LazyMedia({ url, fallback }: { url: string, fallback?: React.ReactNode }) {
  const [isVisible, setIsVisible] = React.useState(false)
  const [hasError, setHasError] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '300px' })

    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="w-full h-full bg-surface-panel">
      {isVisible && !hasError && (
        <img
          src={url}
          alt=""
          className={cn(
            'w-full h-full object-cover'
          )}
          loading="lazy"
          decoding="async"
          onError={() => setHasError(true)}
        />
      )}
      {hasError && fallback && (
        <div className="w-full h-full flex items-center justify-center">
          {fallback}
        </div>
      )}
    </div>
  )
}

type CellData = {
  files: ScannedFile[]
  columnCount: number
  /** Target thumbnail edge in pixels: passed as `?thumb=N` so the
   *  protocol handler serves a small JPEG instead of the full-res
   *  source. Rounded to a coarse step so different render widths
   *  collide in the OS thumbnail cache. */
  thumbSize: number
  /** Fine-grained selection store: Cells subscribe to their own
   *  path only, so a single toggle re-renders one cell instead of
   *  every visible cell. */
  selectionStore: SelectionStore
  focusedPath?: string
  /** Modifier-aware click dispatch:
   *    plain          → replace selection with this path
   *    Cmd/Ctrl+click → toggle this path
   *    Shift+click    → range from anchor to this path
   *  Receives the event so it can read `metaKey`/`ctrlKey`/`shiftKey`. */
  onCellClick: (path: string, e: React.MouseEvent | React.KeyboardEvent) => void
  onDoubleClickFile?: (path: string) => void
}

const Cell = memo(({ columnIndex, rowIndex, style, data }: {
  columnIndex: number; rowIndex: number; style: React.CSSProperties; data: CellData
}) => {
  const { files, columnCount, thumbSize, selectionStore, focusedPath, onCellClick, onDoubleClickFile } = data
  const index = rowIndex * columnCount + columnIndex
  // Sentinel path for out-of-range cells (the trailing partial row of
  // an under-filled grid). We compute it before any hooks run so the
  // hook order stays consistent across renders and the early-return
  // below doesn't trip the Rules of Hooks lint. Subscribing to an
  // empty path is harmless. The store has no listeners or entries
  // for it.
  const file = index < files.length ? files[index] : null
  const path = file?.relativePath ?? ''
  // Fine-grained subscription: this hook re-runs the component only
  // when *this path's* selection state changes, not on every parent
  // re-render. The `subscribe`/`getSnapshot` callbacks are derived
  // from a stable store ref, so React's `useSyncExternalStore`
  // doesn't churn.
  const isSelected = useSyncExternalStore(
    React.useCallback(cb => selectionStore.subscribe(path, cb), [selectionStore, path]),
    () => selectionStore.isSelected(path),
  )
  if (!file) return null

  const isImage = isImagePath(path)
  const isVideo = isVideoPath(path)
  const encodedPath = encodeURIComponent(file.absolutePath)
  const mediaUrl = `cernix-media://local/${encodedPath}?thumb=${thumbSize}`
  /** Raw video file URL (no ?thumb). The renderer-side
   *  VideoThumbnail decodes one frame off this and caches the result:
   * Electron's nativeImage thumbnailer can't decode video formats. */
  const videoSrcUrl = `cernix-media://local/${encodedPath}`

  return (
    <div
      style={{
        ...style,
        left: Number(style.left) + Gutter / 2,
        top: Number(style.top) + Gutter / 2,
        width: Number(style.width) - Gutter,
        height: Number(style.height) - Gutter,
        contentVisibility: 'auto' as React.CSSProperties['contentVisibility'],
      }}
      className="p-0 relative"
    >
      <AssetTile
        id={path}
        className={cn(focusedPath === path && !isSelected && 'ring-1 ring-overlay-strong')}
        name={path.split(/[\\/]/).pop() || ''}
        sizeText={formatBytes(file.sizeBytes)}
        isSelected={isSelected}
        syncState={syncStateFor(file)}
        onClick={(e) => onCellClick(path, e)}
        onDoubleClick={() => onDoubleClickFile && onDoubleClickFile(path)}
        fallbackIcon={
          <div className="w-10 h-10 border border-overlay-hover flex items-center justify-center bg-surface-panel rounded-soft mb-2">
            {isVideo ? <Film size={18} className="text-text-disabled" /> : <FileText size={18} className="text-text-disabled" />}
          </div>
        }
        imageElement={
          isVideo ? (
            <VideoThumbnail
              videoUrl={videoSrcUrl}
              cacheKey={file.absolutePath}
              thumbSize={thumbSize}
              fallback={
                <div className="w-10 h-10 border border-overlay-hover flex items-center justify-center bg-surface-panel rounded-soft">
                  <Film size={18} className="text-text-disabled" />
                </div>
              }
            />
          ) : isImage ? (
            <LazyMedia
              url={mediaUrl}
              fallback={
                <div className="w-10 h-10 border border-overlay-hover flex items-center justify-center bg-surface-panel rounded-soft">
                  <FileText size={18} className="text-text-disabled" />
                </div>
              }
            />
          ) : undefined
        }
      />
    </div>
  )
}, areEqual)

export function PhotoGrid({
  files,
  selectedFiles,
  onSelectClick,
  onDoubleClickFile,
  width,
  height,
  columnCount: columnCountOverride,
  focusedPath,
}: PhotoGridProps) {
  // Pack columns into the width that is actually visible. The
  // container minus the scrollbar's reserved gutter.
  const usable = usableWidth(width)
  const columnCount = Math.max(1, columnCountOverride ?? autoColumnCount(width))
  const columnWidth = (usable / columnCount) - Gutter
  const rowHeight = columnWidth + CaptionHeight
  const rowCount = Math.ceil(files.length / columnCount)

  // Coarse-stepped thumbnail edge so adjacent column widths share
  // OS-thumbnailer cache entries. Floor at 128 so very narrow tiles
  // still get a visually-acceptable thumbnail.
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const thumbSize = thumbEdgeFor(columnWidth, dpr)

  // One stable store per PhotoGrid instance. `useState` lazy init
  // gives us a value that's preserved across renders without the
  // "ref accessed during render" lint warning a `useRef + assign in
  // body` pattern would trigger. The parent's `selectedFiles` prop
  // is mirrored into the store via the effect below, and only paths
  // whose state actually flipped trigger Cell renders.
  const [selectionStore] = useState(() => new SelectionStore())
  useEffect(() => {
    selectionStore.sync(selectedFiles)
  }, [selectedFiles, selectionStore])

  const itemData = useMemo<CellData>(() => ({
    files,
    columnCount,
    thumbSize,
    selectionStore,
    focusedPath,
    onCellClick: onSelectClick,
    onDoubleClickFile,
  }), [files, columnCount, thumbSize, selectionStore, focusedPath, onSelectClick, onDoubleClickFile])

  return (
    <Grid
      columnCount={columnCount}
      columnWidth={columnWidth + Gutter}
      height={height}
      rowCount={rowCount}
      rowHeight={rowHeight + Gutter}
      width={width}
      itemData={itemData}
      overscanRowCount={2}
      className={cn('bg-surface-workspace', SCROLL_GUTTER)}
    >
      {Cell}
    </Grid>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
