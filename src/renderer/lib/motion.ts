
// ── Springs ──
// `as const` preserves the literal `'spring'` for `type` so Framer
// Motion's `Transition` type accepts the object without a call-site
// cast. Without `as const` the literal widens to `string` and Framer
// rejects it.
export const SPRING_STANDARD = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
} as const

// ── Durations ──
//
// Nine components had picked their own: 0.15 here, 0.2 there, 0.3 in a
// class name. Nothing chose those numbers against each other, so two
// panels opening side by side settled at visibly different moments.
//
// Three speeds is enough for an application this size. Anything that
// wants a fourth is usually asking for a spring instead.
//
// Seconds, because that is what Framer Motion takes. The CSS side of
// the same scale lives in tokens.css as --duration-*, and the two are
// kept in step by check-motion.cjs.

/** A control acknowledging a press, a colour change. */
export const DURATION_FAST = 0.15
/** The default: a panel, a dialog, a page of photographs. */
export const DURATION_STANDARD = 0.2
/**
 * Something large enough that arriving instantly would be startling.
 *
 * Currently unused in TS and kept deliberately: it mirrors
 * --duration-slow, and a scale missing a leg is not a scale. A design
 * token completes a vocabulary; a helper with no callers completes
 * nothing, which is why the unused springs went and this stayed.
 */
export const DURATION_SLOW = 0.3

// ── Easing ──
// Tuple types, not plain `number[]`, so Framer Motion's `Transition`
// accepts them as cubic-bezier shorthands without a cast at every
// call site.
export const EASE_STANDARD: [number, number, number, number] = [0.16, 1, 0.3, 1]
