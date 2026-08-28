import * as React from 'react'

/**
 * Whether a placeholder should actually be on screen.
 *
 * Two thresholds, and both exist because the naive version. Render the
 * skeleton whenever `loading` is true. Looks broken on a fast folder.
 *
 * `delay` is the wait before showing anything. Most Drive folders come
 * back in well under 200ms, and a placeholder that appears and vanishes
 * inside that window is a flash of grey where the user expected their
 * photographs. Nothing is better than something that fast.
 *
 * `minimum` is how long it stays once it has appeared. Without it, a
 * load finishing at 210ms shows the skeleton for 10ms. The same flash,
 * arrived at from the other side.
 *
 * Together: nothing under 180ms, and never a glimpse shorter than 320ms.
 */
export function useDeferredLoading(
  loading: boolean,
  { delay = 180, minimum = 320 }: { delay?: number; minimum?: number } = {},
): boolean {
  const [visible, setVisible] = React.useState(false)
  const shownAt = React.useRef(0)

  React.useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now()
        setVisible(true)
      }, delay)
      return () => clearTimeout(timer)
    }

    if (!visible) return
    const elapsed = Date.now() - shownAt.current
    if (elapsed >= minimum) {
      setVisible(false)
      return
    }
    const timer = setTimeout(() => setVisible(false), minimum - elapsed)
    return () => clearTimeout(timer)
  }, [loading, visible, delay, minimum])

  return visible
}
