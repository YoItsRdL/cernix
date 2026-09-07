import React from 'react'
import { createRoot } from 'react-dom/client'
import { GeometryPanel } from '@/editor/ui/GeometryPanel'
import { FULL_FRAME_CROP } from '@/../shared/edit-params'
import type { CropRect, Orientation } from '@/types'

/**
 * The geometry panel, with the parent state it drives.
 *
 * `straightenDeg` and `orientation` are the parent's, exactly as in
 * SliderPanel, because the auto-crop effect reads them as props and a
 * harness holding them locally would not re-run it the way the editor
 * does. What is recorded is every rect the panel asks its parent to
 * apply, which is the whole of what auto-crop does.
 */
// Stable, as it is in EditorView, where it is useState and only changes
// when a new photograph loads. A fresh object literal here would change
// identity on every render and drive the panel's effect in a loop that
// the real editor does not have.
const IMAGE_DIMS = { w: 4000, h: 3000 }

function Harness() {
  const w = window as unknown as Record<string, unknown>
  const [straightenDeg, setStraighten] = React.useState(0)
  const [orientation, setOrientation] = React.useState<Orientation>(0)
  const [crop, setCrop] = React.useState<CropRect>(FULL_FRAME_CROP)
  const cropsRef = React.useRef<CropRect[]>([])
  // Remounting the panel is how "open a photograph that already has a
  // crop saved on it" is reproduced: the panel's own auto-crop state is
  // local, so it is created fresh with every photograph.
  const [mountKey, setMountKey] = React.useState(0)
  // Nullable, as it is in EditorView: the dimensions are not known until
  // the photograph has decoded, so the panel's first render always has
  // none and they land a moment later.
  const [dims, setDims] = React.useState<{ w: number; h: number } | null>(IMAGE_DIMS)

  const round = (r: CropRect) => ({
    x: Math.round(r.x * 1000) / 1000, y: Math.round(r.y * 1000) / 1000,
    w: Math.round(r.w * 1000) / 1000, h: Math.round(r.h * 1000) / 1000,
  })

  /** The crop currently in force, as the store would hold it. */
  w.__crop = () => round(crop)
  /** Is the photograph actually cropped, or is the whole frame showing? */
  w.__isCropped = () => crop.w < 0.999 || crop.h < 0.999
  /** Every rect the panel has asked for, in order. */
  w.__cropCalls = () => cropsRef.current.map(round)
  w.__setStraighten = (v: number) => setStraighten(v)
  w.__openWith = (c: CropRect, deg: number) => {
    cropsRef.current = []
    setCrop(c)
    setStraighten(deg)
    setMountKey(k => k + 1)
  }
  /** Open with the dimensions still unknown, as a real photograph does. */
  w.__openUndecoded = (c: CropRect, deg: number) => {
    cropsRef.current = []
    setCrop(c)
    setStraighten(deg)
    setDims(null)
    setMountKey(k => k + 1)
  }
  w.__decode = () => setDims(IMAGE_DIMS)
  w.__setOrientation = (v: Orientation) => setOrientation(v)
  /** The auto-crop checkbox, as a person would find it. */
  w.__autoCropBox = () =>
    [...document.querySelectorAll('label')]
      .find(l => l.textContent?.includes('Auto-crop'))
      ?.querySelector('input[type=checkbox]') as HTMLInputElement | undefined
  w.__autoCropTicked = () => !!(w.__autoCropBox as () => HTMLInputElement | undefined)()?.checked

  React.useEffect(() => { w.__ready = true })

  return (
    <GeometryPanel
      key={mountKey}
      orientation={orientation}
      flipH={false}
      straightenDeg={straightenDeg}
      imageDims={dims}
      onOrientationChange={setOrientation}
      onFlipChange={() => {}}
      onStraightenChange={setStraighten}
      onStraightenReset={() => setStraighten(0)}
      onCropChange={(v) => { cropsRef.current = [...cropsRef.current, v]; setCrop(v) }}
    />
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
