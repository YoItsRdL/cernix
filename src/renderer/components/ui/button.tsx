import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// The compiled class output of `variant="primary" size="hero"` is
// reproduced verbatim as the landing-page CTA's static `<a>`
// (landing/index.html). If you change the `primary` variant or the
// `hero` size classes below, update landing/README.md > "CTA cva
// snapshot" in the same PR. There is no automated check that ties
// the two.
/**
 * Buttons are set in sentence case.
 *
 * The base carried `uppercase tracking-widest`, which is why half the
 * call sites in this app carried `normal-case tracking-normal` to undo
 * it: the toolbars, the pager, the filter tabs and the breadcrumbs all
 * wanted a word rather than a shout, and the ones that did not override
 * it were the ones nobody had looked at twice. A default that most
 * callers cancel is not a default.
 *
 * The tracking went with it. Wide letter-spacing exists to make
 * uppercase readable; on sentence case it just holds the word apart.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-soft text-body font-bold transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus disabled:pointer-events-none disabled:opacity-40 active:translate-y-px',
  {
    variants: {
      variant: {
        primary:
          'bg-accent-primary text-primary-foreground shadow-sm hover:bg-accent-primary/90',
        // The palette's teal. A real alternative action standing beside a
        // primary one. Same weight, different choice. Filled, because a
        // choice the user is meant to see is not an outline.
        secondary:
          'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/90',
        // The outline comes from `--foreground`, not the border tokens.
        // Those are mixed toward the warm palette, so against a warm
        // surface they read as a tinted edge rather than a neutral one,
        // and next to a terracotta primary the relation is visible. The
        // foreground is the same value the label uses, so a button's
        // edge and its text come from one source.
        //
        // What used to be called `secondary`: no palette colour at all,
        // just a panel with a border. Reset, Retry, Cancel. Actions that
        // are second-tier in *emphasis* rather than an alternative to
        // anything. Renamed because one name for both meanings is how
        // every neutral button in the app would have turned teal.
        neutral:
          'bg-surface-panel border border-foreground/20 text-text-emphatic shadow-sm hover:border-foreground/40 hover:bg-overlay-hover',
        // Outlined like the others, because a control with no fill has
        // nothing else to state where it is. The icon size opts back
        // out below: a glyph is already its own affordance, and an
        // edge around every toolbar icon is a box the eye has to
        // discount rather than information.
        ghost:
          'border border-foreground/20 text-text-default hover:border-foreground/40 hover:bg-overlay-hover hover:text-text-emphatic',
        danger:
          'bg-status-danger text-destructive-foreground shadow-sm hover:bg-status-danger/90',
        outline:
          'border border-foreground/20 bg-transparent text-text-default hover:border-foreground/40 hover:bg-overlay-hover hover:text-text-emphatic',
      },
      size: {
        default: 'h-8 px-4',
        sm: 'h-6 px-3',
        lg: 'h-10 px-8 text-heading',
        icon: 'h-8 w-8',
        // For surfaces where the button IS the primary action of the
        // view. Landing-page download CTA, future high-emphasis
        // confirmations. Significantly larger footprint than `lg`
        // so the hierarchy reads at-a-glance against full-bleed
        // imagery or empty whitespace.
        hero: 'h-14 px-12 text-subtitle',
      },
    },
    compoundVariants: [
      // An icon button keeps the ghost's behaviour and drops its edge.
      // `border-transparent` rather than `border-0`, so the box keeps
      // the same geometry as every other button and a row of mixed
      // sizes still lines up on the pixel.
      { variant: 'ghost', size: 'icon', class: 'border-transparent hover:border-transparent' },
    ],
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button }
