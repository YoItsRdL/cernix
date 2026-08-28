import React from 'react'
import { MoreHorizontal, Star, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from './ui/icon-button'
import { SyncBadge } from './ui/sync-badge'
import type { SyncState } from '@/lib/sync-state'
import { FrameGround } from './ui/frame-ground'
import { Checkbox } from './ui/checkbox'
import type { RatingStars, RatingFlag } from '../types'

export interface AssetTileProps {
  id: string
  name: string
  sizeText: string
  imageElement?: React.ReactNode
  fallbackIcon?: React.ReactNode
  isSelected: boolean
  /** Where this asset stands against the Drive ledger. Drawn with the
   *  same badge the list view uses. `'new'` and omitting it both draw
   *  nothing: on a freshly inserted card that is the majority state,
   *  and a label on every tile is not information. */
  syncState?: SyncState
  /** Extra classes for the tile itself: the keyboard focus ring uses
   *  this. Applied last so a caller can override a state colour. */
  className?: string
  userStars?: RatingStars | null
  flag?: RatingFlag
  onClick: (e: React.MouseEvent) => void
  onDoubleClick?: (e: React.MouseEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
  onMenuClick?: (e: React.MouseEvent) => void
  /** Optional explicit selection toggle (the corner chip).
   *  When provided, the chip becomes a real interactive button. Used
   *  by surfaces (e.g. Distiller) where the tile's primary click does
   *  something other than toggle (focus, navigate, etc.). When
   *  omitted, the chip is purely decorative and the tile's own click
   *  is the toggle. */
  onToggleSelect?: (e: React.MouseEvent) => void
  onSetStars?: (stars: RatingStars) => void
  onSetFlag?: (flag: RatingFlag) => void
  /** Trash this one. Sits beside the stars, so judging and discarding
   *  are the same gesture in the same place. */
  onTrash?: () => void
  /** Makes the tile a drag source. Off unless the surface opts in. */
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: (e: React.DragEvent) => void
  /**
   * Drop wiring, for tiles that can receive. Folders. `isDropTarget`
   * paints the accepting state; the surface owns the decision, since only
   * it knows what is being dragged.
   */
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  isDropTarget?: boolean
}

/**
 * Photo / asset tile. The whole card is the toggle target. A single
 * `role="button"` div with keyboard handling. The corner chip is a
 * visual-only state indicator (no separate click handler) when
 * `onToggleSelect` is omitted, which removes the dual-onClick
 * weirdness of the original version while keeping the affordance
 * visible.
 *
 * **Hot path note.** This component is rendered O(visible cells) at
 * 1k+ items in the photo grid. We deliberately use plain `<div>` +
 * CSS transitions instead of `framer-motion`'s `motion.div` /
 * `AnimatePresence`. Framer wraps every node with event listeners
 * and an animation state machine; multiplied across 50+ tiles that's
 * measurable per-toggle overhead with no user-visible benefit over
 * the equivalent CSS opacity / transform transitions.
 */
export function AssetTile({
  name,
  sizeText,
  imageElement,
  fallbackIcon,
  isSelected,
  syncState,
  className,
  userStars,
  flag,
  onClick,
  onDoubleClick,
  onContextMenu,
  onMenuClick,
  onToggleSelect,
  onSetStars,
  onSetFlag,
  onTrash,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  isDropTarget,
}: AssetTileProps) {
  const extension = name.split('.').pop()?.toUpperCase() || 'FILE'
  const effectiveStars = (userStars ?? 0) as number
  const starsAreUser = userStars != null

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${name}${isSelected ? ' (selected)' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(e as unknown as React.MouseEvent)
        }
      }}
      // `active:scale-[0.98]` replaces Framer's `whileTap`. Same
      // visual press feedback, no per-tile motion-state machine.
      title={`${name} · ${extension} · ${sizeText}`}
      className={cn(
        'relative w-full h-full rounded-soft border overflow-hidden group transition-all shrink-0 bg-surface-workspace',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus',
        'active:scale-[0.98]',
        // A tile is selected or it is not. There is no third state for
        // "being dragged". Dimming the items in flight read as a mode the
        // user had not asked for, and left the whole grid washed out if a
        // drag ever failed to end.
        //
        // The drop ring is the exception and is not a state of the tile:
        // it marks where a drop would land, and without it a drag has no
        // target feedback at all.
        isDropTarget
          ? 'border-secondary ring-2 ring-secondary/60 shadow-lg z-20'
          : isSelected
            ? 'border-accent-primary ring-1 ring-accent-primary/40 shadow-lg z-10'
            : 'border-border-subtle hover:border-border-strong',
        className,
      )}
    >
      {/* Media layer */}
      <div className="absolute inset-0 z-0 select-none pointer-events-none">
        {imageElement ? (
          imageElement
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-surface-workspace relative overflow-hidden">
            {/* The dot grid + crosshair this tile used to draw inline.
                Both viewers wanted the same ground and neither had it,
                so it moved to ui/frame-ground.tsx and this is now one
                of three callers rather than the only one. */}
            <FrameGround />

            <div className="flex flex-col items-center gap-3 z-10">
              <div className="p-4 border border-border-strong bg-overlay-hover shadow-inner rounded-soft group-hover:border-accent-primary/30 transition-colors">
                {fallbackIcon}
              </div>
              <div className="space-y-1.5 text-center px-4 max-w-full">
                <div className="text-body text-text-muted font-mono tabular-nums">{name}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Selection bloom: purely decorative. Stays mounted always
          and fades opacity via CSS so the tile doesn't pay
          AnimatePresence enter/exit cost on every selection toggle. */}
      <div
        aria-hidden
        className={cn(
          // rounded-soft, matching the tile. Without it this drew a
          // square border inside a rounded, overflow-hidden parent, so
          // the clip sliced the corners off and the selected state looked
          // like the radius had broken.
          'absolute inset-0 rounded-soft border-2 border-accent-primary/40 z-20 pointer-events-none shadow-inner transition-opacity duration-150',
          isSelected ? 'opacity-100' : 'opacity-0',
        )}
      />

      {/* No hover scrim here by design. It covered the bottom half of
          every tile on hover, which is the half of a photo you are
          usually trying to look at, and for tiles with no thumbnail it
          printed the filename a second time on top of the one already
          centred in the fallback. The name, size and extension it
          carried now ride on the tile's own tooltip. */}

      {/* The tick takes `--primary-foreground`, the colour that token
          is paired with, not `--text-emphatic`. Emphatic is the ink for
          the workspace: near-black in light mode, which is what put a
          dark tick on an orange fill. A fill and its foreground travel
          together or the contrast drifts the moment either is
          re-pitched: the same rule the danger button follows.

          The empty box is filled, not washed. It carried
          `bg-overlay-hover`, which is the foreground colour at 7%: over
          a photograph that is not a box, it is a faint tint of whatever
          is behind it, and in light mode it read as a smudge on the
          picture. It takes the panel surface now, the same ground the
          neutral Button and the tile's other chips stand on, so an
          empty checkbox looks like an empty control rather than a mark
          on the photograph. 70% at rest rather than 40%: opaque at 40%
          is still mostly the picture.

          Selection chip. When `onToggleSelect` is supplied the box is
          pressable in its own right (Distiller, where the tile's click
          focuses rather than toggles); otherwise it is decorative and
          the tile's own click is the toggle. Either way the box itself
          is ui/checkbox.tsx: the appearance is not this file's to
          decide, only the behaviour around it. */}
      <span className="absolute top-2 left-2 z-20">
        <Checkbox
          checked={isSelected}
          onToggle={onToggleSelect}
          label={onToggleSelect ? (isSelected ? 'Deselect asset' : 'Select asset') : undefined}
          className={cn(
            'shadow-md',
            !onToggleSelect && 'pointer-events-none',
            isSelected ? 'scale-110' : 'opacity-70 group-hover:opacity-100',
          )}
        />
      </span>

      {/* Where it stands against the Drive ledger. Which states are
          worth a mark over a photograph is the badge's rule, not this
          tile's: it used to be spelled out here as `!== 'new'`, which
          is the kind of thing the second caller gets wrong. */}
      {syncState && (
        <SyncBadge state={syncState} onMedia className="absolute top-2 right-2 z-20" />
      )}

      {/* Rating row: stars + trash, both via IconButton so the a11y
          baseline (label + tooltip + keyboard) is enforced. */}
      {(onSetStars || onSetFlag || effectiveStars > 0 || flag) && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'absolute bottom-2 left-2 right-2 z-30 flex items-center gap-1.5 transition-opacity group-hover:opacity-100',
            // A rating is data, so it stays readable without hovering.
            // An empty row is only an affordance and can recede.
            effectiveStars > 0 || flag ? 'opacity-100' : 'opacity-80',
          )}
        >
          <div className="flex items-center gap-0.5 bg-surface-panel border border-border-strong rounded-soft px-1 py-0.5">
            {[1, 2, 3, 4, 5].map((n) => {
              const filled = n <= effectiveStars
              return (
                <IconButton
                  key={n}
                  aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  title={`${n} star${n > 1 ? 's' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSetStars?.((effectiveStars === n ? 0 : n) as RatingStars)
                  }}
                  className="h-4 w-4 p-0 hover:scale-110 hover:bg-transparent"
                  icon={
                    <Star
                      size={10}
                      strokeWidth={2}
                      className={cn(
                        filled
                          ? starsAreUser ? 'fill-status-warn text-status-warn' : 'fill-accent-primary/70 text-accent-primary/70'
                          : 'text-text-muted',
                      )}
                    />
                  }
                />
              )
            })}

          </div>

          {/* Its own chip, deliberately not sharing the stars'.
              Wearing the same chrome and the same 16px hit box, because
              it arrived as a bordered pill half again as tall and read
              as a blob stuck to the side of the rating, but kept
              apart, because the thing next to five rating buttons is
              the one control on the tile you cannot take back by
              clicking again. A gap is cheaper than an undo.

              Red only on hover, so the row is not shouting before it is
              touched. */}
          {onTrash && (
            <div className="flex items-center bg-surface-panel border border-border-strong rounded-soft px-1 py-0.5">
              <IconButton
                aria-label="Move to trash"
                title="Move to trash"
                onClick={(e) => {
                  e.stopPropagation()
                  onTrash()
                }}
                className="h-4 w-4 p-0 hover:scale-110 hover:bg-transparent hover:text-status-danger"
                icon={<Trash2 size={10} strokeWidth={2} className="text-text-muted" />}
              />
            </div>
          )}
        </div>
      )}

      {/* Context-menu trigger */}
      {onMenuClick && (
        <IconButton
          aria-label="Asset actions"
          title="More actions"
          onClick={(e) => {
            e.stopPropagation()
            onMenuClick(e)
          }}
          className="absolute top-2 right-2 h-6 w-6 p-1 bg-scrim-medium rounded-none opacity-0 group-hover:opacity-100 hover:bg-scrim-heavy border border-border-strong z-20"
          icon={<MoreHorizontal size={12} />}
        />
      )}
    </div>
  )
}
