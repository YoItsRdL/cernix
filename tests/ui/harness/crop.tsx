import React from 'react'
import { createRoot } from 'react-dom/client'
import { CropOverlay } from '@/editor/ui/CropOverlay'
import { FULL_FRAME_CROP } from '@/../shared/edit-params'
import type { CropRect } from '@/types'

/**
 * The crop overlay on its own.
 *
 * It needs no WebGL, no photograph and no Drive: a container rect and a
 * source size are the whole of its input, which is why the thing it does
 * on Enter can be tested at all. The editor around it needs all three,
 * and that is why "Enter commits the crop" had no coverage while the
 * report about it was open.
 */
function Harness() {
  const w = window as unknown as Record<string, unknown>
  // Refs, not state: nothing on screen depends on what has been
  // committed, so re-rendering the overlay would only risk resetting the
  // rect the test just reshaped.
  const committedRef = React.useRef<CropRect[]>([])
  const cancelRef = React.useRef(0)

  /** Every rect handed to onCommit, rounded so a float tail cannot fail a match. */
  w.__committed = () => committedRef.current.map(r => ({
    x: Math.round(r.x * 1000) / 1000,
    y: Math.round(r.y * 1000) / 1000,
    w: Math.round(r.w * 1000) / 1000,
    h: Math.round(r.h * 1000) / 1000,
  }))
  w.__cancels = () => cancelRef.current
  /** The committed rect's aspect, in source-pixel terms, to 2dp. */
  w.__committedAspect = () => {
    const last = committedRef.current[committedRef.current.length - 1]
    if (!last) return null
    return Math.round((last.w * 4000) / (last.h * 3000) * 100) / 100
  }

  React.useEffect(() => { w.__ready = true })

  return (
    <div style={{ width: 800, height: 600 }}>
      <CropOverlay
        containerRect={{ width: 800, height: 600 }}
        imageWidth={4000}
        imageHeight={3000}
        initial={FULL_FRAME_CROP}
        onCommit={(next) => { committedRef.current = [...committedRef.current, next] }}
        onCancel={() => { cancelRef.current += 1 }}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
