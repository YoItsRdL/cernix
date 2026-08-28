import React from 'react'
import { Toaster } from 'sonner'

/**
 * The application's one toast surface.
 *
 * Mounted once, at the top of the tree. There used to be two. One in
 * App and one in Distiller, and because Distiller renders inside App,
 * both were live whenever that tab was open. Sonner renders every toast
 * into every mounted Toaster, so each one appeared twice, stacked. The
 * two configs had also drifted: one sized its text at --text-heading and
 * the other at --text-body, so the same toast changed size depending on
 * which surface happened to raise it.
 *
 * Sonner takes CSS strings rather than Tailwind classes, so the tokens
 * are consumed as `var(--…)`. That is the sanctioned form for a
 * third-party component. The values still come from the token file.
 *
 * `theme` follows the app instead of being pinned to "dark". It was
 * hardcoded, which left sonner styling its own internals. The loading
 * spinner, the close button, the icon colours. For a dark surface while
 * the overrides below painted a light one. Everything the overrides did
 * not reach was wrong in light mode.
 */
export interface AppToasterProps {
  /**
   * Distance from the bottom of the window, as a CSS length.
   *
   * The toaster is position:fixed, so it anchors to the viewport and
   * knows nothing about the terminal panel docked at the bottom. It
   * floated over it. Callers pass the terminal's current height so the
   * toast rests on its top edge instead.
   */
  bottomOffset?: string
}

export function AppToaster({ bottomOffset }: AppToasterProps = {}) {
  const [theme, setTheme] = React.useState<'light' | 'dark'>(
    () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'),
  )

  React.useEffect(() => {
    // The theme is a class on <html>, applied by preload before first
    // paint and toggled from the rail. There is no context to subscribe
    // to, so watch the attribute directly.
    const read = () =>
      setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    read()
    return () => observer.disconnect()
  }, [])

  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      // Both offsets, deliberately. Sonner keeps a separate mobile set
      // and switches to it below 600px, so setting only the first left a
      // narrow window falling back to 16px and overlapping the terminal
      // again. There is no phone here. The window is just small.
      offset={bottomOffset ? { bottom: bottomOffset, right: '1rem' } : undefined}
      mobileOffset={bottomOffset ? { bottom: bottomOffset, right: '1rem' } : undefined}
      toastOptions={{
        style: {
          background: 'var(--card)',
          border: '1px solid var(--border)',
          color: 'var(--foreground)',
          // Body, not heading. A toast is a control-sized surface, and
          // controls sit at body size; at 15px it outranked the headings
          // around it.
          fontSize: 'var(--text-body)',
          // Was 0. Everything else in the app is rounded-soft.
          borderRadius: 'var(--radius-soft)',
          // It floats above the workspace, so it reads as raised rather
          // than as a panel that happens to be on top.
          boxShadow: 'var(--shadow-lg)',
        },
      }}
    />
  )
}
