/**
 * Every keyboard shortcut the app binds, in one place.
 *
 * This is a reference sheet, so the only thing that matters about it is
 * that it is true. The editor already had a hand-written list and it had
 * drifted: it promised "0–9 set star rating", which the editor has never
 * bound (stars are 0–5 and only inside the lightbox) and it omitted H
 * for the healing tool entirely. A shortcut sheet that lies is worse
 * than none, because it teaches the wrong thing and then gets believed.
 *
 * Every entry below was read off the handler that implements it. When
 * you add a binding, add it here in the same commit; when you remove
 * one, the sheet is the second half of the removal.
 */

export interface Shortcut {
  /** Keys as displayed. `mod` becomes ⌘ or Ctrl for the platform. */
  keys: string
  what: string
}

export interface ShortcutGroup {
  title: string
  /** Where these apply, when that is not obvious from the title. */
  note?: string
  shortcuts: Shortcut[]
}

/** ⌘ on a Mac, Ctrl everywhere else. */
export function forPlatform(keys: string): string {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return keys
    .replace(/\bmod\b/g, isMac ? '⌘' : 'Ctrl')
    .replace(/\balt\b/g, isMac ? '⌥' : 'Alt')
    .replace(/\bshift\b/g, isMac ? '⇧' : 'Shift')
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Selecting',
    note: 'Local Archive and Workstation alike.',
    shortcuts: [
      { keys: 'Click', what: 'Select one, replacing the rest' },
      { keys: 'mod + Click', what: 'Select a range from the last one clicked' },
      { keys: 'shift + Click', what: 'Add or remove one, keeping the rest' },
      { keys: 'mod + A', what: 'Select everything, not just this page' },
      { keys: 'Esc', what: 'Clear the selection' },
      { keys: 'mod + Z', what: 'Undo the last move or trash' },
    ],
  },
  {
    title: 'Moving through the grid',
    note: 'The page follows, so arrows cross page boundaries.',
    shortcuts: [
      { keys: '← → ↑ ↓', what: 'Move through the photographs' },
      { keys: 'shift + arrows', what: 'Extend the selection as you go' },
      { keys: 'Home / End', what: 'First or last, wherever it lives' },
      { keys: 'Page Up / Down', what: 'A page at a time' },
      { keys: 'Enter', what: 'Open the focused photograph or folder' },
    ],
  },
  {
    title: 'Viewing a photograph',
    note: 'While the full-screen viewer is open.',
    shortcuts: [
      { keys: '← →', what: 'Previous or next, wrapping at the ends' },
      { keys: 'Space', what: 'Select or deselect this one' },
      { keys: '0 – 5', what: 'Set the star rating' },
      { keys: 'P', what: 'Flag as a pick, or clear it' },
      { keys: 'X', what: 'Move to trash' },
      { keys: 'D', what: 'Download' },
      { keys: 'E', what: 'Open in the editor' },
      { keys: 'Esc', what: 'Close' },
    ],
  },
  {
    title: 'Editing',
    shortcuts: [
      { keys: '\\', what: 'Hold to see the untouched original' },
      { keys: 'C', what: 'Crop' },
      { keys: 'shift + C', what: 'Restore the original geometry' },
      { keys: 'mod + alt + T', what: 'Free transform' },
      { keys: 'R', what: 'Straighten' },
      { keys: 'A', what: 'Masks, and spot overlay while healing' },
      { keys: 'H', what: 'Healing brush' },
      { keys: 'T', what: 'Cycle the targeted-adjustment overlays' },
      { keys: '← →', what: 'Nudge the focused slider' },
      { keys: 'shift + ← →', what: 'Nudge it ten at a time' },
      { keys: 'Esc', what: 'Leave the current mode, then the editor' },
      { keys: '?', what: 'Show this sheet' },
    ],
  },
]
