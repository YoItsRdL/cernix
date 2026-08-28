import * as React from 'react'
import { Cloud, HardDrive } from 'lucide-react'
import { Badge } from './badge'
import type { SyncState } from '@/lib/sync-state'


/**
 * Both states, each with a word, a glyph and a tone.
 *
 * The glyphs are distinct shapes, not one shape in two colours: a hard
 * drive is on this machine only, a cloud is up. Colour agrees with them
 * and carries nothing on its own, which is what makes the mark readable
 * at 12px over a photograph and to someone who cannot separate amber
 * from green.
 */
const STATE = {
  new: { tone: 'accent', label: 'NEW', Icon: HardDrive, title: 'On the card, not synced yet' },
  synced: { tone: 'success', label: 'SYNCED', Icon: Cloud, title: 'On Drive' },
} as const

export interface SyncBadgeProps {
  state: SyncState
  /**
   * Set when the tag sits on a photograph rather than on panel chrome.
   *
   * It becomes a 20px mark carrying the glyph alone. A word at 11px
   * over a thumbnail is not small type, it is unreadable type: the old
   * on-media treatment put 70%-strength colour on a 40% black scrim and
   * measured as a coloured smudge over anything bright. The word is
   * still there for a pointer, on the mark's tooltip, and in full in
   * the list and the inspector where there is room for it.
   */
  onMedia?: boolean
  className?: string
}

export function SyncBadge({ state, onMedia, className }: SyncBadgeProps) {
  const { tone, label, Icon, title } = STATE[state]

  // `new` is not drawn on a photograph. On a freshly inserted card it
  // is the state of nearly every tile, so a mark on all of them is
  // furniture rather than information, and accent on the chip measures
  // 2.69:1, the weakest pair in the palette and the one the contrast
  // gate already carries as an accepted exception. The rule lives here
  // rather than in each caller's `&&`, which is where it was.
  if (onMedia && state === 'new') return null

  if (onMedia) {
    return (
      <Badge ground="media" shape="mark" tone={tone} title={title} aria-label={label} className={className}>
        <Icon size={12} strokeWidth={2} />
      </Badge>
    )
  }

  return (
    <Badge tone={tone} title={title} className={className}>
      {label}
    </Badge>
  )
}
