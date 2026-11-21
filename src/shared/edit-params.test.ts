import { describe, it, expect } from 'vitest'
import { DEFAULT_PARAMS, stripForPreset, applyPresetOverCurrent, type EditParams } from './edit-params'

/**
 * A preset is a look, not a correction for one photograph. Keystone and
 * lens distortion are fixed per photo, so a preset saved from a corrected
 * shot must not straighten every photo it is applied to (F-094).
 */
const corrected = (): EditParams => ({
  ...structuredClone(DEFAULT_PARAMS),
  exposure: 0.4,
  perspective: { ...DEFAULT_PARAMS.perspective, vertical: 0.3 },
  lensDistortion: -0.2,
})

describe('presets leave a photo\'s geometry alone', () => {
  it('saves no perspective or lens correction', () => {
    const preset = stripForPreset(corrected())
    expect(preset.exposure, 'the look is kept').toBe(0.4)
    expect(preset.perspective).toEqual(DEFAULT_PARAMS.perspective)
    expect(preset.lensDistortion).toBe(DEFAULT_PARAMS.lensDistortion)
  })

  it('keeps the target\'s own correction when applied, even from an older preset that carries one', () => {
    const target = { ...structuredClone(DEFAULT_PARAMS), perspective: { ...DEFAULT_PARAMS.perspective, horizontal: -0.1 }, lensDistortion: 0.15 }
    const result = applyPresetOverCurrent(corrected(), target)
    expect(result.exposure).toBe(0.4)
    expect(result.perspective).toEqual(target.perspective)
    expect(result.lensDistortion).toBe(0.15)
  })
})
