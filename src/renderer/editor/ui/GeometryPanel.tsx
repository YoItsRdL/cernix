import { useEffect, useState } from 'react'
import { RotateCcw, RotateCw, FlipHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Slider } from './Slider'
import { FULL_FRAME_CROP } from '../../../shared/edit-params'
import type { CropRect, Orientation } from '@/types'

interface GeometryPanelProps {
  orientation: Orientation
  flipH: boolean
  straightenDeg: number
  /** Native source image dimensions: needed to compute the inscribed rect. */
  imageDims: { w: number; h: number } | null
  onOrientationChange: (v: Orientation) => void
  onFlipChange: (v: boolean) => void
  onStraightenChange: (v: number) => void
  onStraightenReset: () => void
  /** Called when auto-crop computes or clears a crop rect. */
  onCropChange: (v: CropRect) => void
}

/**
 * Returns the largest axis-aligned rectangle inscribed inside a `w × h`
 * rectangle that has been rotated by `theta` radians.
 *
 * The result is expressed as a normalized crop rect in source-image coords
 * [0..1], centered on the image. Returns null when the angle is effectively
 * zero (no crop needed) or when the inscribed rect degenerates (should not
 * happen for |theta| < pi/4, but we guard defensively).
 */
function inscribedCrop(
  imgW: number,
  imgH: number,
  orientation: Orientation,
  thetaDeg: number,
): CropRect | null {
  if (Math.abs(thetaDeg) < 0.05) return null

  // The shader composes orientation first, then straightenDeg, so the image
  // that the user perceives as "the thing being rotated" is the post-orientation
  // image. Use effective dims for the geometry.
  const swap = orientation === 90 || orientation === 270
  const effW = swap ? imgH : imgW
  const effH = swap ? imgW : imgH

  const theta = Math.abs(thetaDeg) * (Math.PI / 180)
  const cosT = Math.cos(theta)
  const sinT = Math.sin(theta)
  const cosDouble = Math.cos(2 * theta) // cos²-sin² = cos(2θ)

  // Solve the system where the inscribed rect's corners touch the rotated rect's edges.
  // iw and ih are in effective-display pixels.
  const iw = (effW * cosT - effH * sinT) / cosDouble
  const ih = (effH * cosT - effW * sinT) / cosDouble

  if (iw <= 0 || ih <= 0) return null

  // Convert from effective-display pixels to normalized source-UV coords.
  // When orientation is 90/270 the effective x direction maps to source y and
  // vice-versa, so we swap back.
  const nw = swap ? ih / imgW : iw / imgW
  const nh = swap ? iw / imgH : ih / imgH

  if (nw <= 0 || nh <= 0 || nw > 1 || nh > 1) return null

  return {
    x: (1 - nw) / 2,
    y: (1 - nh) / 2,
    w: nw,
    h: nh,
  }
}

export function GeometryPanel({
  orientation,
  flipH,
  straightenDeg,
  imageDims,
  onOrientationChange,
  onFlipChange,
  onStraightenChange,
  onStraightenReset,
  onCropChange,
}: GeometryPanelProps) {
  const [autoCrop, setAutoCrop] = useState(true)

  // Recompute crop whenever straightenDeg, autoCrop, or image dims change.
  useEffect(() => {
    if (!autoCrop || !imageDims) return
    const rect = inscribedCrop(imageDims.w, imageDims.h, orientation, straightenDeg)
    onCropChange(rect ?? FULL_FRAME_CROP)
  // onCropChange is stable (store.set reference). Omitting it avoids a stale
  // closure loop because the reference can't change between renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [straightenDeg, autoCrop, imageDims, orientation])

  const rotate = (delta: 90 | -90) => {
    const next = (((orientation + delta) % 360) + 360) % 360
    onOrientationChange(next as Orientation)
  }

  return (
    <div className="py-1">
      <div className="flex items-center gap-space-1 px-space-5 py-space-2">
        <IconButton
          icon={<RotateCcw size={14} />}
          label="Rotate left"
          onClick={() => rotate(-90)}
        />
        <IconButton
          icon={<RotateCw size={14} />}
          label="Rotate right"
          onClick={() => rotate(90)}
        />
        <IconButton
          icon={<FlipHorizontal size={14} />}
          label="Flip horizontal"
          onClick={() => onFlipChange(!flipH)}
          active={flipH}
        />
        {orientation !== 0 && (
          <span className="ml-auto text-caption font-mono text-text-muted tabular-nums">{orientation}°</span>
        )}
      </div>
      <Slider
        label="Straighten"
        value={straightenDeg}
        min={-45}
        max={45}
        step={0.1}
        onChange={onStraightenChange}
        onReset={onStraightenReset}
        format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`}
      />
      <label className="flex items-center gap-space-2 px-space-5 py-1.5 text-metadata text-text-muted hover:text-text-emphatic cursor-pointer transition-colors">
        <input /* eslint-disable-line no-restricted-syntax -- design-allow: a real checkbox inside its label; the shared Checkbox is presentational */
          type="checkbox"
          checked={autoCrop}
          onChange={(e) => {
            const next = e.target.checked
            setAutoCrop(next)
            if (!next) {
              // Toggle off. Restore full frame so black corners become visible.
              onCropChange(FULL_FRAME_CROP)
            }
          }}
          className="accent-accent-primary"
        />
        <span className="font-medium">Auto-crop</span>
      </label>
    </div>
  )
}

function IconButton({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button /* eslint-disable-line no-restricted-syntax -- design-allow: a real checkbox inside its label; the shared Checkbox is presentational */
      onClick={onClick}
      title={label}
      className={cn(
        'h-7 w-7 flex items-center justify-center border rounded-soft transition-colors',
        active
          ? 'border-accent-primary/60 text-accent-primary bg-accent-primary/10'
          : 'border-border-subtle text-text-muted hover:text-text-emphatic hover:border-border-strong',
      )}
    >
      {icon}
    </button>
  )
}
