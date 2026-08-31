import { drawsOwnCaptionButtons } from '@/lib/window-chrome'
import React, { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronLeft, ChevronRight, Download, Star, Trash2, Sparkles, Flag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { DURATION_FAST, DURATION_STANDARD, EASE_STANDARD } from '@/lib/motion'
import type { RatingStars, RatingFlag } from '../types'

interface LightboxProps {
  isOpen: boolean
  onClose: () => void
  onNext?: () => void
  onPrev?: () => void
  /** If provided, shows a selection toggle in the top bar */
  isSelected?: boolean
  onToggleSelect?: () => void
  /** If provided, shows a download button */
  onDownload?: () => void
  /** If provided, shows an edit button */
  onEdit?: () => void
  /** Optional filename label */
  fileName?: string
  /** Rating state for the focused file */
  userStars?: RatingStars | null
  flag?: RatingFlag
  onSetStars?: (stars: RatingStars) => void
  onSetFlag?: (flag: RatingFlag) => void
  /** Trash the photograph on screen. Bound to X. */
  onTrash?: () => void
  /**
   * Identity of the frame on screen. A path or a file id.
   *
   * The viewer animates between frames, and an animation needs to know
   * that the thing it is showing has changed. Without it the picture
   * swaps in place and stepping left looks exactly like stepping right.
   */
  frameKey?: string
  children: React.ReactNode
}

/**
 * Chrome inside the viewing room.
 *
 * Every control here sits on --viewer-field, the room's own ground, so
 * none of it may use the ordinary surface and text roles: those follow
 * --background, and this floor does not. That mismatch is what put a
 * cream chip and dark-on-dark text on a black field in light mode. The
 * viewer-* roles track the field instead, in both directions.
 *
 * Kept as one constant rather than repeated per control: the stars chip
 * and the Reject button had drifted to different surfaces, borders,
 * radii and heights while sitting side by side.
 */
/**
 * A navigation zone, not a navigation button.
 *
 * These used to be 40x40 chips floating in a very large dark margin, so
 * a near miss did not just fail to advance. It hit the backdrop and
 * closed the viewer. Losing your place because you were 10px off is a
 * bad trade for a button that small.
 *
 * The whole column is now the target and the chip is only the visible
 * affordance. Held clear of the toolbar and the rating bar so it cannot
 * swallow their clicks.
 *
 * A plain <button>, deliberately, not the Button component: Button
 * carries `active:translate-y-px`, and Tailwind writes both that and
 * `-translate-y-1/2` to --tw-translate-y. The :active rule won, so
 * pressing an arrow dropped it half its own height, with
 * `transition-all duration-200` animating the fall. Nothing here is
 * positioned by transform any more, and the only transition is colour.
 */
/**
 * The reach around a nav chip.
 *
 * A column in the viewer's row rather than a strip floating over it.
 * Absolutely positioned, these zones sat on top of the photograph and
 * the photograph sat under them: a frame wide enough to fill the window
 * ran under both arrows and under the rating bar, so the corners of the
 * picture were behind chrome. The room now gives the frame what is left
 * after the controls have taken theirs.
 */
const NAV_ZONE =
  'group flex w-24 shrink-0 items-center focus-visible:outline-none'

/**
 * How a frame arrives and leaves.
 *
 * A crossfade with the smallest lateral shift that still reads as a
 * direction: the picture is what the eye is on, so it should not travel.
 * 24px is a hint, not a slide. Enough that stepping back does not look
 * like stepping on. Reduce Motion is handled globally by MotionConfig
 * at the root, which flattens the transform and leaves the fade.
 */
const FRAME_TRAVEL = 24

const FRAME_MOTION = {
  enter: (direction: number) => ({ opacity: 0, x: direction * FRAME_TRAVEL }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -FRAME_TRAVEL }),
}

const NAV_CHIP =
  'flex h-10 w-10 items-center justify-center rounded-soft border ' +
  'border-viewer-border bg-viewer-chip text-viewer-text backdrop-blur-sm ' +
  'transition-colors group-hover:bg-viewer-chip-hover ' +
  'group-focus-visible:ring-1 group-focus-visible:ring-border-focus'

/**
 * The viewer's controls, and the rule they follow.
 *
 * Two kinds, and only two: a 32px chip for an action with a name
 * (Download, Close, Trash), and a bare 24px icon for the stars, which
 * are a value being set rather than a command being given.
 *
 * A chip changes exactly ONE thing on hover. The trash used to change
 * three. The background lightened to the neutral hover, the text
 * turned red, and the border picked up a red tint, which is how it
 * ended up reading as muddy: status-danger at L=0.58 sitting on a chip
 * at L=0.39 is not enough separation to look deliberate, and three
 * simultaneous shifts read as a glitch rather than a state.
 */
const VIEWER_CONTROL =
  'h-8 rounded-soft border border-viewer-border bg-viewer-chip backdrop-blur-sm ' +
  // hover:text is pinned, not left to the variant. These are ghost
  // Buttons, and ghost hovers to text-emphatic. A near-black chosen
  // for the light workspace. Over the viewer's dark chip that measured
  // L=0.31 on L=0.39: the label all but disappeared at the moment the
  // cursor arrived, which is the one moment it must not.
  'text-viewer-text hover:text-viewer-text hover:bg-viewer-chip-hover transition-colors'

/**
  * The destructive chip.
  *
  * Identical to VIEWER_CONTROL at rest, because a button should not
  * shout before it is touched, and fills with the app's danger colour on
  * hover. The same pairing the danger Button variant uses, so the
  * viewer agrees with every other surface about what destructive looks
  * like. Filling rather than tinting also guarantees the contrast: the
  * foreground token is the one chosen for that background.
  */
const VIEWER_CONTROL_DANGER =
  'h-8 rounded-soft border border-viewer-border bg-viewer-chip backdrop-blur-sm ' +
  'text-viewer-text transition-colors ' +
  'hover:bg-status-danger hover:border-status-danger hover:text-destructive-foreground'

export function Lightbox({
  isOpen, onClose, onNext, onPrev, isSelected, onToggleSelect, onDownload, onEdit, fileName,
  userStars, flag, onSetStars, onSetFlag, onTrash, frameKey,
  children,
}: LightboxProps) {
  // Where the press began. A click fires on the nearest common ancestor,
  // so pressing on the photo and releasing on the backdrop counted as a
  // backdrop click and closed the viewer. Easy to do when dragging near
  // the edge of an image. Closing now needs the press to both start and
  // end on the backdrop itself.
  const pressOrigin = React.useRef<EventTarget | null>(null)
  const effectiveStars = (userStars ?? 0) as number
  const starsAreUser = userStars != null

  // Which way the last step went, so the next frame can come from the
  // side it was reached from. Set by both routes, since the arrow keys
  // and the arrow buttons are the same gesture.
  const [direction, setDirection] = React.useState(0)
  // Defined unconditionally and guarded inside: built conditionally,
  // each one was a fresh identity on every render, which tore down and
  // rebuilt the key listener below with it.
  const goNext = React.useCallback(() => {
    if (!onNext) return
    setDirection(1)
    onNext()
  }, [onNext])
  const goPrev = React.useCallback(() => {
    if (!onPrev) return
    setDirection(-1)
    onPrev()
  }, [onPrev])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && goNext) goNext()
      if (e.key === 'ArrowLeft' && goPrev) goPrev()
      if (e.key === ' ' && onToggleSelect) { e.preventDefault(); onToggleSelect() }
      if ((e.key === 'd' || e.key === 'D') && onDownload) { e.preventDefault(); onDownload() }
      if ((e.key === 'e' || e.key === 'E') && onEdit) { e.preventDefault(); onEdit() }
      // rating shortcuts
      if (onSetStars && /^[0-5]$/.test(e.key)) { e.preventDefault(); onSetStars(Number(e.key) as RatingStars) }
      if (onTrash && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); onTrash() }
      if (onSetFlag && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); onSetFlag(flag === 'pick' ? null : 'pick') }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, goNext, goPrev, onToggleSelect, onDownload, onEdit, onSetStars, onSetFlag, onTrash, flag])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION_STANDARD, ease: EASE_STANDARD }}
          // The room is opaque and achromatic, and it follows the theme
          // in lightness: a light field in light mode, near-black in
          // dark. It was --scrim-full, 95% black in both, so opening a
          // photograph in light mode blacked out the whole app around
          // it. Opaque also retires a full-screen backdrop-blur that
          // was blurring what the remaining 5% never showed.
          className="fixed inset-0 z-[500] bg-viewer-field flex flex-col"
          onMouseDown={(e) => { pressOrigin.current = e.target }}
          onClick={(e) => {
            if (e.target === e.currentTarget && pressOrigin.current === e.currentTarget) onClose()
          }}
        >
          {/* The window's own top row, full width.

              WindowControls draws minimise, maximise and close fixed at
              the corner and carries --card behind them so they stay
              legible over whatever is underneath. Over the viewer that
              read as a patch of the app floating on the field, because
              it was one. The strip is the rest of that row, so the three
              buttons sit on a bar rather than on a swatch.

              It is also the only drag region while the viewer is open:
              the workbench header is behind a full-window surface, so
              without this the window cannot be moved at all until the
              photograph is closed. */}
          <div className="app-drag h-12 shrink-0 bg-surface-panel border-b border-border-subtle flex justify-end">
            {/* The corner the three window buttons occupy, reserved
                inside this drag region rather than left to the fixed
                overlay's own `no-drag`: a drag region only yields to a
                carve-out in its own subtree, and the overlay is a
                sibling of this strip. Same reserve the workbench header
                keeps. */}
            {drawsOwnCaptionButtons() && (
              <div className="app-no-drag w-caption h-full shrink-0" aria-hidden />
            )}
          </div>

          <div className="flex-1 min-h-0 flex flex-col gap-space-4 p-8 pt-space-4">
          {/* The viewer's own header, under the caption strip rather
              than alongside it: selection, filename, and what can be
              done with the frame on screen. */}
          <div className="flex items-center justify-between gap-space-4 shrink-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 min-w-0">
              {onToggleSelect && (
                <Button
                  variant="ghost"
                  onClick={onToggleSelect}
                  title="Toggle selection (Space)"
                  aria-pressed={isSelected}
                  // The chip keeps the viewer's own chrome in both
                  // states and the box carries the state, exactly as a
                  // tile does. It used to fill with accent when
                  // selected. An accent box on an accent ground, so
                  // the one mark that says what is happening vanished
                  // into its own container and the box had to invert
                  // itself to stay visible. That inversion was the
                  // fourth answer to what a checkbox looks like.
                  className={cn('gap-2 px-3 text-caption', VIEWER_CONTROL)}
                >
                  <Checkbox checked={!!isSelected} />
                  <span>{isSelected ? 'Selected' : 'Select'}</span>
                </Button>
              )}
              {fileName && (
                <span className="text-body text-viewer-text-muted font-mono truncate max-w-[50vw] tracking-tight">{fileName}</span>
              )}
            </div>
            {/* No caption reserve any more: the three window buttons
                have a row of their own above this one, so nothing here
                can end up underneath them. */}
            <div className="flex items-center gap-2">
              {onEdit && (
                <Button
                  variant="primary"
                  onClick={onEdit}
                  title="Edit (E)"
                  className="gap-2 h-8 px-3 text-caption"
                >
                  <Sparkles size={12} />
                  <span>Edit</span>
                </Button>
              )}
              {onDownload && (
                <Button
                  variant="ghost"
                  onClick={onDownload}
                  title="Download (D)"
                  className={cn('gap-2 px-3 text-caption', VIEWER_CONTROL)}
                >
                  <Download size={12} />
                  <span>Download</span>
                </Button>
              )}
              <IconButton
                icon={<X size={16} />}
                aria-label="Close"
                onClick={onClose}
                title="Close (Esc)"
                className={cn('w-8 text-viewer-text hover:text-viewer-text', VIEWER_CONTROL)}
              />
            </div>
          </div>

          {/* The frame, with the arrows either side of it rather than on
              top of it. `min-h-0` is what makes the row give: without it
              a flex child refuses to shrink below its content and a tall
              photograph pushes the rating bar off the bottom of the
              window instead of scaling to fit. */}
          <div className="flex-1 min-h-0 flex items-stretch gap-space-4">
            {onPrev && (
              <button /* eslint-disable-line no-restricted-syntax -- design-allow: a navigation zone rather than a button, sized to the margin beside the photograph */
                type="button"
                aria-label="Previous"
                title="Previous (←)"
                onClick={(e) => { e.stopPropagation(); goPrev() }}
                className={cn(NAV_ZONE, 'justify-start')}
              >
                <span className={NAV_CHIP}><ChevronLeft size={20} /></span>
              </button>
            )}

            {/* Media Container */}
            <div
              className="flex-1 min-w-0 min-h-0 flex items-center justify-center relative cursor-default"
              onClick={(e) => e.stopPropagation()} // Prevent bubbling up to background click
            >
              {/* No `mode`: the two frames overlap for the length of the
                  crossfade, which is what makes it read as one
                  photograph replacing another rather than a gap between
                  them. Both are absolutely positioned in this box, so
                  overlapping costs no layout. */}
              <AnimatePresence initial={false} custom={direction}>
                <motion.div
                  key={frameKey ?? 'frame'}
                  custom={direction}
                  variants={FRAME_MOTION}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: DURATION_FAST, ease: EASE_STANDARD }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            </div>

            {onNext && (
              <button /* eslint-disable-line no-restricted-syntax -- design-allow: a navigation zone rather than a button, sized to the margin beside the photograph */
                type="button"
                aria-label="Next"
                title="Next (→)"
                onClick={(e) => { e.stopPropagation(); goNext() }}
                className={cn(NAV_ZONE, 'justify-end')}
              >
                <span className={NAV_CHIP}><ChevronRight size={20} /></span>
              </button>
            )}
          </div>

          {/* The rating bar, under the frame rather than over its lower
              edge. Judging a photograph and marking it are two halves of
              one gesture, and the marks used to sit on the half of the
              picture you were looking at. */}
          {(onSetStars || onSetFlag || onTrash) && (
            <div
              className="shrink-0 flex items-center justify-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={cn('flex items-center gap-px px-1', VIEWER_CONTROL, 'hover:bg-viewer-chip')}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const filled = n <= effectiveStars
                  return (
                    <IconButton
                      key={n}
                      icon={
                        <Star
                          size={12}
                          className={cn(
                            filled
                              ? starsAreUser ? 'fill-status-warn text-status-warn' : 'fill-accent-primary/70 text-accent-primary/70'
                              : 'text-viewer-text-muted'
                          )}
                        />
                      }
                      aria-label={`${n} star${n > 1 ? 's' : ''}`}
                      onClick={() => onSetStars?.((effectiveStars === n ? 0 : n) as RatingStars)}
                      title={`${n} star${n > 1 ? 's' : ''} (${n})`}
                      className={cn('h-6 w-6 p-0 hover:scale-110 hover:bg-transparent', filled ? '' : 'opacity-70 hover:opacity-100')}
                    />
                  )
                })}
              </div>
              {/* The pick. P has been bound since ratings shipped and
                  had no control and no visible state, so the only way
                  to know a frame was picked was to have pressed the key
                  yourself. Beside the stars because it is the same
                  judgement made coarsely: stars rank, a pick shortlists. */}
              {onSetFlag && (
                <Button
                  variant="ghost"
                  onClick={() => onSetFlag(flag === 'pick' ? null : 'pick')}
                  title={flag === 'pick' ? 'Clear the pick (P)' : 'Flag as a pick (P)'}
                  aria-pressed={flag === 'pick'}
                  className={cn(
                    'px-3 gap-1.5 text-caption',
                    flag === 'pick'
                      ? 'h-8 rounded-soft border border-accent-primary bg-accent-primary text-primary-foreground hover:bg-accent-primary'
                      : VIEWER_CONTROL,
                  )}
                >
                  <Flag size={12} className={cn(flag === 'pick' && 'fill-primary-foreground')} />
                  Pick
                </Button>
              )}

              {onTrash && (
                <Button
                  variant="ghost"
                  onClick={onTrash}
                  title="Move to trash (X)"
                  className={cn('px-3 gap-1.5 text-caption', VIEWER_CONTROL_DANGER)}
                >
                  <Trash2 size={12} /> Trash
                </Button>
              )}
            </div>
          )}
          </div>

        </motion.div>
      )}
    </AnimatePresence>
  )
}
