import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach twMerge about the design-system's custom font-size roles.
// Without this, `text-body` / `text-heading` / `text-metadata` / etc.
// are mistaken for colour utilities (since they don't match Tailwind's
// default text-size patterns like `text-xs`/`text-sm`) and get silently
// dropped when a real text-colour like `text-primary-foreground` or
// `text-text-emphatic` appears later in the className chain. Leaving
// buttons, menus, and cards falling back to inherited body size. Same
// story for font-size classes used alongside `text-*` colour roles.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['micro', 'metadata', 'caption', 'code', 'body', 'heading', 'label', 'subtitle', 'title', 'display'] },
      ],
      // Same story for the custom radii. Without this, `rounded-none`
      // passed to a component whose base is `rounded-soft` did not
      // replace it; twMerge kept both and stylesheet order decided,
      // so a control could silently keep the wrong corner.
      //
      // The group is keyed `rounded`, not `border-radius`. Getting that
      // wrong is silent: `extend` happily creates a second group, the
      // two names never conflict with each other, and everything looks
      // configured while nothing resolves.
      rounded: [{ rounded: ['soft', 'nested', 'flush', 'pill'] }],

      // And for the custom sizing scale. --spacing-aside and friends
      // generate w-aside / max-w-metadata / min-w-counter, none of
      // which match Tailwind's numeric patterns, so twMerge treated an
      // override as an unrelated class and kept both: the editor panel
      // asked for w-72 over the shared w-aside and silently stayed
      // 280px. Same failure as the radii above, different scale.
      w: [{ w: ['aside', 'caption-button'] }],
      'max-w': [{ 'max-w': ['metadata'] }],
      'min-w': [{ 'min-w': ['counter', 'counter-sm'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export const clamp01 = (v: number) => clamp(v, 0, 1)
