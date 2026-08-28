import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * A tag: a short, non-interactive statement about the thing it sits on.
 *
 * There were two of these and they agreed on nothing. `badge.tsx` was a
 * pill with eight variants and no callers outside the design sandbox;
 * `sync-badge.tsx` was a square with its own colours, its own padding
 * and two hand-written ground treatments. One idea, two answers, and
 * the one actually on screen was the one nobody had looked at.
 *
 * Three axes, and only three:
 *
 *   tone    what it means. Colour is never the only carrier. A tag
 *           either says a word or draws a distinct glyph.
 *   ground  what it sits on. `chrome` is a panel, where a tinted fill
 *           reads cleanly. `media` is a photograph, where it cannot:
 *           the colour underneath is unknown and changes per pixel, so
 *           the tag brings its own opaque-enough surface and puts the
 *           colour in the ink instead of the fill.
 *   shape   `text` says a word. `mark` is 20px and says a glyph, for
 *           when there is no room for a word, which, over a
 *           thumbnail, is always.
 *
 * The media ground is deliberately the same chrome the rating chip
 * wears (`surface-floating`, `border-strong`, a 12px glyph in a 20px
 * box), so a tile carries one chip vocabulary rather than two.
 */
const badgeVariants = cva(
  'inline-flex items-center justify-center shrink-0 rounded-soft border select-none',
  {
    variants: {
      tone: {
        neutral: '',
        accent: '',
        success: '',
        warn: '',
        danger: '',
        info: '',
      },
      ground: {
        // Opaque, and that is the whole point. Measured over white,
        // black and mid grey, the translucent surface this started as
        // let the photograph move the ink's contrast between 2.0 and
        // 4.8:1. The same mark, legible or not depending on what
        // happened to be under that corner. A solid ground makes the
        // ratio a property of the theme instead, which is a thing that
        // can be checked once and stay true.
        media: 'bg-surface-panel border-border-strong',
        chrome: '',
      },
      shape: {
        text: 'h-5 px-1.5 gap-1 text-metadata uppercase tracking-widest tabular-nums',
        mark: 'h-5 w-5 p-0',
      },
    },
    compoundVariants: [
      // On chrome the tone fills, borders and inks, at the same three
      // strengths for every tone so no state shouts louder than another.
      { ground: 'chrome', tone: 'neutral', class: 'bg-overlay-hover border-border-subtle text-text-muted' },
      { ground: 'chrome', tone: 'accent', class: 'bg-accent-primary/10 border-accent-primary/30 text-accent-primary' },
      { ground: 'chrome', tone: 'success', class: 'bg-status-success/10 border-status-success/30 text-status-success' },
      { ground: 'chrome', tone: 'warn', class: 'bg-status-warn/10 border-status-warn/30 text-status-warn' },
      { ground: 'chrome', tone: 'danger', class: 'bg-status-danger/10 border-status-danger/30 text-status-danger' },
      { ground: 'chrome', tone: 'info', class: 'bg-status-info/10 border-status-info/30 text-status-info' },

      // On media every tone shares one ground, because legibility over
      // an unknown photograph cannot depend on the tone. Only the ink
      // carries meaning, at full strength.
      { ground: 'media', tone: 'neutral', class: 'text-text-muted' },
      { ground: 'media', tone: 'accent', class: 'text-accent-primary' },
      { ground: 'media', tone: 'success', class: 'text-status-success' },
      { ground: 'media', tone: 'warn', class: 'text-status-warn' },
      { ground: 'media', tone: 'danger', class: 'text-status-danger' },
      { ground: 'media', tone: 'info', class: 'text-status-info' },
    ],
    defaultVariants: { tone: 'neutral', ground: 'chrome', shape: 'text' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/**
 * A span, not a div: tags sit inside rows of text as often as they sit
 * on a corner, and a block element in a line of prose is a layout bug
 * waiting for the first long filename.
 */
export function Badge({ className, tone, ground, shape, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, ground, shape }), className)} {...props} />
}

