import React from 'react'
import { createRoot } from 'react-dom/client'
import { Lightbox } from '@/components/Lightbox'
import { MediaFrame } from '@/components/ui/frame-ground'

/**
 * The viewer, opened on a frame far larger than the window.
 *
 * The size is the whole point. Every control in here floated over the
 * photograph, so the overlap only showed on a frame big enough to want
 * the entire room, which is most of them, on a screen this shape.
 * A 4000×3000 SVG stands in for the photograph: it has an intrinsic
 * size, it decodes instantly, and it needs no file on disk.
 */
const FRAME =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="3000"></svg>')

function Harness() {
  const w = window as unknown as Record<string, unknown>
  const [src, setSrc] = React.useState(FRAME)
  const [low, setLow] = React.useState<string | undefined>(undefined)

  // Stepping to another frame, as the arrows do. Keyed on the src in
  // the viewer and here, so the new frame starts undecoded instead of
  // inheriting the last one's state.
  w.__navigate = (next: string, lowNext?: string) => { setSrc(next); setLow(lowNext) }
  w.__FRAME = FRAME
  /** Whether a skeleton placeholder is on screen. */
  w.__skeleton = () => !!document.querySelector('[class*="animate-skeleton"]')

  /** Whether the low-resolution stand-in is on screen and visible. */
  w.__thumbnailShowing = () => {
    const imgs = [...document.querySelectorAll('img')]
    return imgs.length > 1 && getComputedStyle(imgs[0]).opacity !== '0'
  }

  const frameRect = () => document.querySelector('img')!.getBoundingClientRect()

  /** Every control whose box intersects the photograph's, by name. */
  w.__overlapping = () => {
    const f = frameRect()
    const hits: string[] = []
    document.querySelectorAll('button').forEach(el => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      if (r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top) {
        hits.push(el.getAttribute('aria-label') || el.textContent?.trim() || 'control')
      }
    })
    return hits.join(',')
  }

  /**
   * The caption strip: full width, and nothing under it.
   *
   * The three window buttons are drawn fixed at the corner by
   * WindowControls, which is not in this harness. What is measured
   * here is the row the viewer keeps clear for them, and that its own
   * header starts below that row rather than beside it.
   */
  w.__captionStrip = () => {
    const strip = document.querySelector('.app-drag')!.getBoundingClientRect()
    const header = document.querySelector('.app-drag')!.nextElementSibling!.getBoundingClientRect()
    return {
      fullBleed: Math.round(strip.width) === window.innerWidth && Math.round(strip.left) === 0,
      height: Math.round(strip.height),
      headerBelow: header.top >= strip.bottom,
    }
  }

  /**
   * How much of the window the photograph takes, as a percentage.
   *
   * Guards the test against passing for the wrong reason: a frame
   * shrunk to a postage stamp would also overlap nothing.
   */
  w.__frameFill = () => {
    const f = frameRect()
    return Math.round((f.width * f.height) / (window.innerWidth * window.innerHeight) * 100)
  }

  // What the viewer asks its surface to do. Both libraries pass
  // `onToggleSelect` now, so this harness mirrors a configuration that
  // ships rather than one only a test could produce.
  const selects = React.useRef(0)
  w.__selectCalls = () => selects.current

  // The runner's mount probe. Set from an effect rather than during
  // render, so it means "on screen" rather than "about to be".
  React.useEffect(() => {
    if (document.querySelector('img')) w.__ready = true
  })

  return (
    <Lightbox
      isOpen
      onClose={() => {}}
      onNext={() => {}}
      onPrev={() => {}}
      fileName="DSC_4419.CR3"
      isSelected
      onToggleSelect={() => { selects.current += 1 }}
      onDownload={() => {}}
      onEdit={() => {}}
      userStars={4}
      onSetStars={() => {}}
      onTrash={() => {}}
    >
      <MediaFrame key={src} src={src} lowSrc={low} />
    </Lightbox>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
