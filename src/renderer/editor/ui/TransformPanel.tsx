import { Slider } from './Slider'
import type { Perspective } from '@/../shared/edit-params'

interface TransformPanelProps {
  perspective: Perspective
  lensDistortion: number
  onPerspectiveChange: (next: Perspective) => void
  onLensDistortionChange: (next: number) => void
}

/**
 * Transform panel. Manual perspective sliders (Vertical /
 * Horizontal keystone, Aspect, X / Y translate) and the
 * lens-distortion correction. Lightroom's Upright auto modes
 * (Auto / Level / Vertical / Full) are deliberately deferred.
 * They need line-fitting feature detection, which is out of scope.
 * Manual sliders cover the bulk of preset-encoded transforms.
 *
 * Rotation and uniform scale aren't exposed here. They live on
 * `straightenDeg` and the existing free-transform overlay
 * respectively, to keep the two paths from drifting.
 */
export function TransformPanel({
  perspective, lensDistortion,
  onPerspectiveChange, onLensDistortionChange,
}: TransformPanelProps) {
  const fmtSigned = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}`
  const set = (field: keyof Perspective, v: number) => onPerspectiveChange({ ...perspective, [field]: v })
  const reset = (field: keyof Perspective) => set(field, 0)
  return (
    <div className="py-1">
      <Slider
        label="Vertical"
        value={perspective.vertical}
        defaultValue={0}
        min={-1}
        max={1}
        step={0.01}
        onChange={(v) => set('vertical', v)}
        onReset={() => reset('vertical')}
        format={fmtSigned}
      />
      <Slider
        label="Horizontal"
        value={perspective.horizontal}
        defaultValue={0}
        min={-1}
        max={1}
        step={0.01}
        onChange={(v) => set('horizontal', v)}
        onReset={() => reset('horizontal')}
        format={fmtSigned}
      />
      <Slider
        label="Aspect"
        value={perspective.aspect}
        defaultValue={0}
        min={-1}
        max={1}
        step={0.01}
        onChange={(v) => set('aspect', v)}
        onReset={() => reset('aspect')}
        format={fmtSigned}
      />
      <Slider
        label="X Offset"
        value={perspective.x}
        defaultValue={0}
        min={-1}
        max={1}
        step={0.01}
        onChange={(v) => set('x', v)}
        onReset={() => reset('x')}
        format={fmtSigned}
      />
      <Slider
        label="Y Offset"
        value={perspective.y}
        defaultValue={0}
        min={-1}
        max={1}
        step={0.01}
        onChange={(v) => set('y', v)}
        onReset={() => reset('y')}
        format={fmtSigned}
      />
      <div className="border-t border-border-subtle mt-space-2 pt-space-1">
        <Slider
          label="Lens Distortion"
          value={lensDistortion}
          defaultValue={0}
          min={-1}
          max={1}
          step={0.01}
          onChange={onLensDistortionChange}
          onReset={() => onLensDistortionChange(0)}
          format={fmtSigned}
        />
      </div>
    </div>
  )
}
