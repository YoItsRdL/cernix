/**
 * Does this app draw its own caption buttons, and where?
 *
 * Three call sites need the same answer and got it three ways before
 * this existed: WindowControls deciding whether to render at all, and
 * the two top rows — the workbench header and the viewer's strip —
 * deciding whether to keep `--spacing-caption` clear at the corner.
 *
 * **Windows and Linux: yes, top right.** The window has no OS caption
 * there (`titleBarStyle: 'hidden'` and `frame: false` respectively), so
 * `WindowControls` draws minimise, maximise and close, and anything else
 * in a top row has to reserve 138px so it does not land underneath them.
 *
 * **macOS: no.** `hiddenInset` keeps Apple's own three and puts them at
 * the top *left*, in the band `--titlebar-inset` reserves above the app's
 * rows. `WindowControls` renders nothing there, so the right-hand corner
 * is empty and reserving it is 138px of dead space that pushes the row's
 * real controls away from the edge for no reason.
 *
 * A function rather than a module-level constant: this is read during
 * render, and evaluating `window.electronAPI` at import time would make
 * the module unimportable anywhere the bridge is not installed yet.
 */
export function drawsOwnCaptionButtons(): boolean {
  // Anything that is not macOS draws its own, including a host that
  // reports no platform at all: that is the behaviour Windows and Linux
  // have always had, and it is the safe default for a surface rendered
  // outside the app, such as a test harness.
  return window.electronAPI?.platform !== 'darwin'
}
