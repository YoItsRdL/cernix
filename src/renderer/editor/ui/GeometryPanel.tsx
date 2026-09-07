import { useEffect, useRef, useState } from 'react'
import { RotateCcw, RotateCw, FlipHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Slider } from './Slider'
import { FULL_FRAME_CROP } from '../../../shared/edit-params'
import { inscribedCrop } from '../utils/geometry-logic'
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

  /**
   * What the geometry was last time this ran, or null before the first.
   *
   * Auto-crop follows a straighten the *user* performs. It used to fire
   * on mount as well, and this panel is created fresh for every
   * photograph, so opening one silently replaced whatever crop was saved
   * on it: with the inscribed rect if it carried an angle, and with the
   * full frame if it did not. A crop composed by hand did not survive
   * being looked at.
   *
   * Comparing against the previous values rather than counting renders
   * is what makes that safe. `imageDims` arrives asynchronously, so the
   * first run is often the one where it is still null and the second is
   * the one where it lands — and a "skip the first render" guard would
   * let that second one through and overwrite the crop anyway.
   */
  const seen = useRef<{ deg: number; orientation: Orientation; auto: boolean } | null>(null)

  useEffect(() => {
    const now = { deg: straightenDeg, orientation, auto: autoCrop }
    const before = seen.current
    seen.current = now

    // Adopt what the photograph arrived with rather than overwriting it.
    if (!before) return
    // Only geometry the user changed drives a recompute. Without this,
    // `imageDims` landing counts as a change and undoes their crop.
    if (before.deg === now.deg && before.orientation === now.orientation && before.auto === now.auto) return

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
