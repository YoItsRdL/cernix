import * as React from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'
import { useDeferredLoading } from '@/hooks/useDeferredLoading'

/**
 * The ground a photograph sits on before there is a photograph.
 *
 * A 12px dot field at 3% and a crosshair at 2%, both drawn in the text
 * colour so they follow the theme instead of carrying one. It was
 * written inline in the grid tile and nowhere else, which is why the
 * two viewers each answered "nothing here yet" their own way. One with
 * a flat pulsing block, one with an empty room.
 *
 * Absolute, so it lies under whatever the caller draws on top.
 */
export function FrameGround({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('absolute inset-0 pointer-events-none', className)}>
      <div
        className="absolute inset-0 opacity-[0.03] text-text-emphatic"
        style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '12px 12px' }}
      />
      <div className="absolute inset-0 flex items-center justify-center opacity-[0.02]">
        <div className="w-full h-px bg-text-emphatic" />
        <div className="w-px h-full bg-text-emphatic absolute" />
      </div>
    </div>
  )
}

/**
 * What a viewer shows while a frame is decoding.
 *
 * Both viewers now show this one thing. Local Archive showed nothing at
 * all. Its `<img>` had no loading state, so opening a large RAW opened
 * an empty room and held it until the decode finished, and Workstation
 * showed a flat block on Tailwind's `animate-pulse`, the blink this
 * codebase replaced with `--animate-skeleton` everywhere else.
 *
 * The ground is what makes it read as a frame rather than as damage:
 * the same dot field the grid tile draws, so a photograph that has not
 * arrived looks the same wherever you are waiting for it.
 */
export function MediaPlaceholder({ className }: { className?: string }) {
  // Skeleton carries the pulse, the surface and `aria-hidden`: a
  // placeholder is furniture, and announcing it to a screen reader says
  // nothing the photograph on its way will not say better.
  return (
    <Skeleton
      className={cn('relative w-full h-full overflow-hidden flex items-center justify-center', className)}
    >
      <FrameGround />
      {/* Small on purpose. It is a mark saying which kind of thing is
          missing, not an illustration of one. */}
      <ImageIcon size={14} className="relative text-text-disabled" />
    </Skeleton>
  )
}

/**
 * A photograph in a viewer, and the wait before it is one.
 *
 * The placeholder is deferred, not immediate. A frame already in the
 * OS thumbnail cache decodes in a few milliseconds, and a skeleton that
 * appears and vanishes inside that window is a flash of grey where the
 * user expected their photograph. `useDeferredLoading` is the same
 * threshold pair the grid uses, so the two surfaces wait alike.
 *
 * `key` this on the path when the viewer can move between frames.
 * Without it, arrowing to the next photograph reuses the state and the
 * new frame arrives marked as already loaded.
 */
export function MediaFrame({ src, lowSrc, className }: { src: string; lowSrc?: string; className?: string }) {
  const [loaded, setLoaded] = React.useState(false)
  const [lowReady, setLowReady] = React.useState(false)
  const waiting = useDeferredLoading(!loaded && !lowReady)

  return (
    <>
      {/* Only when there is nothing else to show. With a thumbnail in
          hand this never renders, which is the intent: the skeleton is
          for a frame nobody has seen yet, not for one the grid decoded
          a second ago. */}
      {!loaded && !lowReady && waiting && <MediaPlaceholder className="absolute inset-0" />}

      {/* The thumbnail the grid already has, at the size the full frame
          will occupy. No artificial blur: an upscale is soft by itself,
          and a blur that has to be animated away is a second thing to
          look at. What the eye sees is a photograph arriving sharp,
          not a placeholder being replaced. */}
      {lowSrc && (
        <img
          src={lowSrc}
          alt=""
          aria-hidden
          onLoad={() => setLowReady(true)}
          className={cn(
            'absolute inset-0 w-full h-full object-contain rounded-soft',
            'transition-opacity duration-standard',
            (loaded || !lowReady) && 'opacity-0',
          )}
        />
      )}

      <img
        src={src}
        alt=""
        onLoad={() => setLoaded(true)}
        className={cn(
          // Bounded by the frame the viewer hands it, not by the window.
          'relative max-w-full max-h-full object-contain rounded-soft shadow-2xl',
          'transition-opacity duration-standard',
          // Faded rather than unmounted: the decode is what we are
          // waiting on, and an <img> that is not in the tree has not
          // started one.
          !loaded && 'opacity-0',
          className,
        )}
      />
    </>
  )
}
