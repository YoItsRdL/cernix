import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Minimise, maximise and close, drawn by the app.
 *
 * The window's frame is hidden (see createWindow) because the native
 * Windows caption cannot be recoloured. The DWM attribute for it is
 * Windows 11 only, and `titleBarOverlay`, which hands the three
 * buttons to Chromium, only takes a colour passed at construction. It
 * knew nothing about the theme, so the strip stayed light over a dark
 * app until the next launch. Drawing them here is what makes them the
 * app's: same tokens, same hover, same focus ring as every other
 * control, and they follow a theme switch because they are the page.
 *
 * What is given up is the Windows 11 snap flyout, which appears on
 * hovering the OS maximise button. This machine is Windows 10, where
 * there is no flyout to lose; Win+Arrow and dragging to an edge still
 * snap either way.
 *
 * Geometry is the platform's, not this app's: 46px wide against the
 * 48px strip. The overlay this replaced measured 136px for three
 * buttons, so the row keeps the width the window manager expected.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  // macOS draws its own three, and `hiddenInset` keeps them: see
  // createWindow. Drawing ours as well would put six caption buttons on
  // one window. The row still reserves space for Apple's, which is
  // `--titlebar-inset` in index.css.
  //
  // Before the early return, because hooks cannot be conditional; the
  // subscription below is harmless on a window that renders nothing.
  const isMac = window.electronAPI.platform === 'darwin'

  useEffect(() => {
    void window.electronAPI.windowIsMaximized().then(s => setMaximized(s.maximized))
    // Also pushed from main: the window can be maximised by a route
    // this component never sees. Win+Up, a drag to the top edge.
    return window.electronAPI.onWindowMaximized(setMaximized)
  }, [])

  if (isMac) return null

  const rest = 'text-text-muted hover:text-text-emphatic hover:bg-overlay-hover'

  return (
    // Fixed at the window's corner, above everything, carrying its own
    // ground.
    //
    // Not in the header, which is where they visually belong and where
    // they would be covered: the viewer, the modals and the share sheet
    // all render a full-window scrim, and a window you cannot close
    // because a dialog is open is the kind of thing that gets an app
    // force-quit. Above them, the controls are always reachable, and
    // the ground is what keeps them legible there, since the viewer's
    // near-black would otherwise swallow a near-black glyph in light
    // mode. Over the header, where it is the same colour, it is
    // invisible.
    //
    // app-no-drag: the strip is a drag region, and a control inside one
    // never receives the click. The window manager takes the whole
    // gesture.
    // The border is not decoration here: this strip is drawn OVER the
    // top row, so without it the header's own rule stops 138px short of
    // the window's edge and the line looks broken rather than absent.
    // Same token and same height, so the two meet as one rule, and the
    // viewer's caption strip carries it too, for the same reason.
    <div className="app-no-drag fixed top-0 right-0 z-[1000] h-12 flex items-stretch shrink-0 bg-surface-panel border-b border-border-subtle">
      <CaptionButton
        label="Minimise"
        className={rest}
        onClick={() => void window.electronAPI.windowMinimize()}
      >
        <Minus size={14} strokeWidth={1.5} />
      </CaptionButton>

      <CaptionButton
        label={maximized ? 'Restore' : 'Maximise'}
        className={rest}
        onClick={() => void window.electronAPI.windowToggleMaximize().then(s => setMaximized(s.maximized))}
      >
        {/* Two overlapping squares for restore, one for maximise: the
            glyphs Windows itself uses, so the button means what a
            Windows user already reads it as. */}
        {maximized
          ? <Copy size={12} strokeWidth={1.5} className="-scale-x-100" />
          : <Square size={12} strokeWidth={1.5} />}
      </CaptionButton>

      {/* Quiet at rest like any other destructive control, and decisive
          on hover: filled with status-danger, taking the foreground
          that token is paired with so the contrast cannot drift. Which
          is also the red every Windows close button turns. */}
      <CaptionButton
        label="Close"
        className={cn(rest, 'hover:bg-status-danger hover:text-destructive-foreground')}
        onClick={() => void window.electronAPI.windowClose()}
      >
        <X size={14} strokeWidth={1.5} />
      </CaptionButton>
    </div>
  )
}

function CaptionButton({
  label, className, onClick, children,
}: {
  label: string
  className?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        // Square corners and full height: these are the window's
        // corner, and a rounded button floating inside the strip reads
        // as a toolbar control that wandered up there.
        'w-caption-button h-full rounded-none shrink-0',
        // The shared press nudge moves the glyph a pixel down. Correct
        // for a button on a surface; wrong for one welded to the window
        // frame, which does not move.
        'active:translate-y-0',
        className,
      )}
    >
      {children}
    </Button>
  )
}
