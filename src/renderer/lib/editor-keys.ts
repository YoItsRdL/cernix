/**
 * Small, pure answers the editor's keyboard handling shares (F-076).
 *
 * The editor listens for keys on the window, in half a dozen places, and each
 * place answered "should I act on this key?" for itself and slightly
 * differently: some skipped an input, some a textarea, none a field that is
 * edited as rich text, and none stood down for a dialog on top. One answer,
 * here, so they cannot drift.
 */

/** Is the key meant for a text field? Then it is the field's, not a shortcut's. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement) {
    // A slider or a checkbox is an input too, and keeps its arrows and space.
    return !['range', 'checkbox', 'radio', 'button'].includes(target.type)
  }
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable
}

/**
 * What one arrow press does to a slider.
 *
 * It was a fixed 0.01 (0.1 with shift) rounded to the slider's own step, so
 * a slider whose step is 0.05 or 50 never moved on a plain arrow. One step
 * a press, and ten with shift, whatever the step is.
 */
export function nudgedValue(
  value: number,
  direction: 1 | -1,
  step: number,
  shift: boolean,
  min: number,
  max: number,
): number {
  const by = step * (shift ? 10 : 1)
  const next = Math.round((value + direction * by) / step) * step
  // Trim the float noise rounding to a step leaves behind (0.1 + 0.2).
  const trimmed = Number(next.toFixed(10))
  return Math.max(min, Math.min(max, trimmed))
}
