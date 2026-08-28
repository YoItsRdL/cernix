import React, { useState } from 'react'
import {
  ChevronRight, Download, Trash2, Grid as GridIcon, List as ListIcon,
  FolderPlus, PanelRight, RefreshCw, Star, X
} from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { BreadcrumbItem, MOVE_DRAG_MIME, readMoveDragIds } from '../distiller-types'
import { Toolbar, TOOLBAR_CONTROL, ToolbarSeparator } from '@/components/ui/toolbar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'

interface DistillerHeaderProps {
  breadcrumbs: BreadcrumbItem[]
  selectedCount: number
  viewMode: 'grid' | 'list'
  columnOverride: number | null
  autoMaxColumns: number
  /** Columns the grid uses when nothing has been chosen; width-derived. */
  defaultColumns: number
  /** Ids being dragged right now, or null. Crumbs accept them as drops. */
  draggingIds: string[] | null
  /** Ids armed by "Move to…", or null. Crumbs become destinations. */
  pendingMove: string[] | null
  starsFilter: number | null
  loading: boolean
  showInspector: boolean
  actions: {
    navigateToBreadcrumb: (index: number) => void
    handleDownloadBatch: () => void
    handleTrashBatch: () => void
    clearSelection: () => void
    handleMoveTo: (targetId: string, ids?: string[]) => void
    setViewMode: (mode: 'grid' | 'list') => void
    setColumnOverride: (count: number | null) => void
    setCreatingFolder: (val: boolean) => void
    setShowInspector: (val: boolean | ((v: boolean) => boolean)) => void
    setStarsFilter: (stars: number | null) => void
    refresh: () => void
  }
}

export function DistillerHeader({
  breadcrumbs, selectedCount, viewMode, columnOverride,
  autoMaxColumns, defaultColumns, draggingIds, pendingMove,
  starsFilter, loading, showInspector, actions
}: DistillerHeaderProps) {
  const effectiveColumns = Math.min(columnOverride ?? defaultColumns, autoMaxColumns)
  const atMin = effectiveColumns <= 1
  const atMax = effectiveColumns >= autoMaxColumns

  // The current folder is the one piece of the trail that has to stay
  // readable, so it never shrinks and everything above it gives way in
  // order. Ancestors keep a minimum before the ellipsis so a truncated
  // crumb is still a clickable target rather than a sliver.
  const lastCrumb = breadcrumbs.length - 1

  // Which crumb the cursor is over mid-drag.
  const [dropCrumbId, setDropCrumbId] = useState<string | null>(null)

  // Both routes end here. A crumb is only a destination if it is not the
  // folder already being looked at. The last crumb is where the items
  // live, so dropping there is a no-op dressed up as an action.
  const moving = draggingIds ?? pendingMove
  const canDropOn = (index: number) => moving !== null && index !== lastCrumb

  const leftContent = (
    <>
      {breadcrumbs.map((crumb, i) => (
        <React.Fragment key={crumb.id}>
          {i > 0 && (
            <ChevronRight
              size={12}
              className={cn(
                // @xl to match the crumbs themselves. These were left on
                // @2xl when the crumbs moved down, so between 576 and 672
                // the ancestors appeared with no separators between them.
                'shrink-0 mx-0.5 hidden @xl:block transition-colors',
                // Dimmed while the trail is live, so the filled crumbs
                // carry the row instead of competing with the marks
                // between them.
                moving ? 'text-secondary/40' : 'text-text-muted',
              )}
            />
          )}
          {/* The folder you are already in is not a link. It was a button
              that navigated to where you already were, focusable and
              pressable and inert, and at the root it was the whole
              breadcrumb, a control that could never do anything. */}
          {i === lastCrumb ? (
            <span className="px-2 h-6 inline-flex items-center text-body truncate min-w-0 max-w-metadata text-text-emphatic font-bold">
              {crumb.name}
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // Armed move turns the trail into destinations rather than
                // links; navigating away would drop the pending selection.
                if (pendingMove) {
                  actions.handleMoveTo(crumb.id)
                  return
                }
                actions.navigateToBreadcrumb(i)
              }}
              onDragOver={(e: React.DragEvent) => {
                // Same reasoning as the folder tiles: MIME during dragover,
                // ids on drop. `canDropOn` still guards the armed-move case,
                // which has no dataTransfer at all.
                if (!e.dataTransfer.types.includes(MOVE_DRAG_MIME) && !pendingMove) return
                // Marks the crumb as accepting; without it the drop is
                // refused by the browser before it reaches onDrop.
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (dropCrumbId !== crumb.id) setDropCrumbId(crumb.id)
              }}
              onDragLeave={() => setDropCrumbId(prev => (prev === crumb.id ? null : prev))}
              onDrop={(e: React.DragEvent) => {
                e.preventDefault()
                setDropCrumbId(null)
                const ids = readMoveDragIds(e) ?? draggingIds
                if (ids && ids.length > 0) actions.handleMoveTo(crumb.id, ids)
              }}
              title={crumb.name}
              className={cn(
                'px-2 h-6 text-body truncate transition-colors',
                // Availability is said in fill, not outline.
                //
                // Rings drew a box around most of the trail and turned a
                // path into a row of buttons. Ink alone went too far the
                // other way. During a drag the eye is on the cursor, and a
                // colour shift that quiet is simply not seen.
                //
                // Both states are filled now, from one token at two
                // strengths: reachable crumbs take a wash, the crumb under
                // the cursor takes the solid. The step between them is what
                // reads as "this one", and neither adds a shape the button
                // did not already have. The radius is the button's own,
                // not an outline laid over it.
                //
                // Neither touches weight. Bold means "you are here" and
                // belongs to the current folder alone. Borrowing it for a
                // drop target put two crumbs in the same voice and made the
                // trail briefly lie about where you were.
                canDropOn(i) && dropCrumbId !== crumb.id &&
                  'bg-secondary/20 text-secondary',
                canDropOn(i) && dropCrumbId === crumb.id &&
                  'bg-secondary text-secondary-foreground shadow-sm',
                // Ancestors only. The current folder is a label above, not
                // a button. They keep a minimum before the ellipsis so a
                // truncated crumb stays a clickable target, not a sliver.
                'text-text-muted min-w-10 shrink max-w-metadata hidden @xl:inline-flex',
              )}
            >
              {crumb.name}
            </Button>
          )}
        </React.Fragment>
      ))}
    </>
  )

  const rightContent = (
    <>
      {selectedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-space-1 shrink-0"
        >
          <ToolbarSeparator />
          {/* "N selected", not "N SEL". Local Archive already said it in
              words; the abbreviation existed only here. */}
          <span className="text-code text-text-disabled mr-space-2 whitespace-nowrap">
            {selectedCount} selected
          </span>
          {/* Escape clears the selection too, but a shortcut nobody can
              see is not a way out. It sits before the batch actions, not
              after: backing out is the common intent, and next to Trash
              it would be one slip away from deleting the batch. */}
          <div className={cn('flex items-center h-7 p-0.5 shrink-0', TOOLBAR_CONTROL)}>
            <IconButton
              icon={<X size={12} strokeWidth={1.5} />}
              aria-label="Clear selection"
              title="Clear selection (Esc)"
              onClick={actions.clearSelection}
              className="h-6 w-6 rounded-nested text-text-disabled hover:text-text-muted"
            />
            <IconButton
              icon={<Download size={12} strokeWidth={1.5} />}
              aria-label="Download Batch"
              title="Download"
              onClick={actions.handleDownloadBatch}
              className="h-6 w-6 rounded-nested text-text-disabled hover:text-text-muted"
            />
          </div>

          {/* Trash carries its danger treatment rather than a tinted glyph,
              exactly as it does in Local Archive: a bordered, filled
              control, because it is the one action here that cannot be
              shrugged off. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={actions.handleTrashBatch}
            title="Move to Trash"
            className={cn(
              'h-7 px-2 gap-1.5 text-caption font-medium',
              'border border-status-danger/40 bg-status-danger/10 text-status-danger',
              'hover:bg-status-danger/20 hover:text-status-danger',
            )}
          >
            <Trash2 size={11} />
            <span className="sr-only @3xl:not-sr-only">Trash {selectedCount}</span>
          </Button>
        </motion.div>
      )}

      <ToolbarSeparator className="hidden @5xl:block" />

      {/* Star filter. The widest control here by some way, so it is the
          first thing to go when the panel narrows: the grid still shows
          each asset's own stars, and the filter is reachable once the
          inspector is closed or the window widened. */}
      <div className="hidden @4xl:flex items-center gap-px bg-surface-workspace border border-border-subtle rounded-soft p-0.5 h-7 shrink-0">
        {[1, 2, 3, 4, 5].map((n) => (
          <IconButton
            key={n}
            icon={<Star size={12} className={(starsFilter ?? 0) >= n ? 'fill-status-warn text-status-warn' : ''} />}
            aria-label={`Filter by ${n} stars`}
            onClick={() => actions.setStarsFilter(starsFilter === n ? null : n)}
            className={cn('h-6 w-6 p-0 rounded-nested hover:scale-110', (starsFilter ?? 0) >= n ? '' : 'opacity-50 hover:opacity-100')}
          />
        ))}
        {starsFilter !== null && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => actions.setStarsFilter(null)}
            className="ml-1 h-6 px-1.5 rounded-nested text-caption"
          >
            Clear
          </Button>
        )}
      </div>

      <ToolbarSeparator className="hidden @3xl:block" />

      <div className={cn('flex items-center h-7 p-0.5 shrink-0', TOOLBAR_CONTROL)}>
        <IconButton
          icon={<GridIcon size={12} />}
          aria-label="Grid view"
          title="Grid view"
          onClick={() => actions.setViewMode('grid')}
          className={cn(
            'h-6 w-6 rounded-nested',
            viewMode === 'grid'
              ? 'bg-overlay-active text-text-emphatic hover:bg-overlay-active'
              : 'text-text-disabled hover:text-text-muted',
          )}
        />
        <IconButton
          icon={<ListIcon size={12} />}
          aria-label="List view"
          title="List view"
          onClick={() => actions.setViewMode('list')}
          className={cn(
            'h-6 w-6 rounded-nested',
            viewMode === 'list'
              ? 'bg-overlay-active text-text-emphatic hover:bg-overlay-active'
              : 'text-text-disabled hover:text-text-muted',
          )}
        />
      </div>

      {viewMode === 'grid' && (
        <div className="hidden @2xl:flex items-center bg-surface-workspace border border-border-subtle rounded-soft h-7 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => actions.setColumnOverride(Math.max(1, effectiveColumns - 1))}
            disabled={atMin}
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
            onClick={() => actions.setColumnOverride(Math.min(autoMaxColumns, effectiveColumns + 1))}
            disabled={atMax}
            aria-label="More columns"
            title="More columns"
            className="h-full px-2 rounded-flush rounded-l-none border-l border-border-subtle text-body"
          >
            +
          </Button>
        </div>
      )}

      {/* Grouped rather than floating loose. Three bare glyphs read as
          decoration until hovered; inside the same container the other
          toolbar clusters use, they read as what they are. */}
      <div className={cn('flex items-center h-7 p-0.5 shrink-0', TOOLBAR_CONTROL)}>
        <IconButton
          icon={<FolderPlus size={14} />}
          aria-label="New Folder"
          title="New folder"
          onClick={() => actions.setCreatingFolder(true)}
          className="hidden @xl:flex h-6 w-6 rounded-nested"
        />
        <IconButton
          icon={<PanelRight size={14} />}
          aria-label="Toggle Inspector"
          title="Toggle inspector"
          onClick={() => actions.setShowInspector(v => !v)}
          className={cn('hidden @3xl:flex h-6 w-6 rounded-nested', showInspector && 'bg-surface-raised text-accent-primary')}
        />
        <IconButton
          icon={<RefreshCw size={14} className={loading ? 'animate-spin text-text-muted' : ''} />}
          aria-label="Refresh"
          title="Refresh"
          onClick={actions.refresh}
          className="h-6 w-6 rounded-nested"
        />
      </div>
    </>
  )

  return (
    <Toolbar
      className="z-40 h-12"
      left={leftContent}
      right={rightContent}
    />
  )
}
