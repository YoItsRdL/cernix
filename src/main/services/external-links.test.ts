import { describe, it, expect } from 'vitest'
import { isOpenableExternal } from './external-links'

describe('isOpenableExternal', () => {
  it('lets Drive and the project pages through', () => {
    expect(isOpenableExternal('https://drive.google.com/drive/folders/abc')).toBe(true)
    expect(isOpenableExternal('https://cernix.app/privacy')).toBe(true)
    expect(isOpenableExternal('https://github.com/YoItsRdL/cernix/releases/tag/v1.3.0')).toBe(true)
    expect(isOpenableExternal('https://buymeacoffee.com/ibonescalap')).toBe(true)
  })

  it('refuses anything else, so a link cannot carry data to a stranger', () => {
    expect(isOpenableExternal('https://evil.example/?token=abc')).toBe(false)
    expect(isOpenableExternal('https://github.com/someone-else/repo')).toBe(false)
    expect(isOpenableExternal('https://drive.google.com.evil.example/')).toBe(false)
    expect(isOpenableExternal('https://user:pw@drive.google.com/')).toBe(false)
    expect(isOpenableExternal('http://drive.google.com/')).toBe(false)
    expect(isOpenableExternal('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isOpenableExternal('not a url')).toBe(false)
  })
})
