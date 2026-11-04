import { describe, it, expect } from 'vitest'
import { parsePreference, effectiveTheme } from './theme'

describe('parsePreference', () => {
  it('keeps an explicit light or dark', () => {
    expect(parsePreference('light')).toBe('light')
    expect(parsePreference('dark')).toBe('dark')
  })
  it('follows the system when nothing, or nothing usable, is stored', () => {
    expect(parsePreference(null)).toBe('system')
    expect(parsePreference(undefined)).toBe('system')
    expect(parsePreference('')).toBe('system')
    expect(parsePreference('system')).toBe('system')
    expect(parsePreference('purple')).toBe('system')
  })
})

describe('effectiveTheme', () => {
  it('takes the system\'s answer only when following it', () => {
    expect(effectiveTheme('system', true)).toBe('dark')
    expect(effectiveTheme('system', false)).toBe('light')
  })
  it('ignores the system when the person chose', () => {
    expect(effectiveTheme('light', true)).toBe('light')
    expect(effectiveTheme('dark', false)).toBe('dark')
  })
})
