import { describe, it, expect, afterEach } from 'vitest'
import { drawsOwnCaptionButtons } from './window-chrome'

/**
 * Which corner the window's buttons live in decides whether two top
 * rows reserve 138px at their right edge. Getting it wrong is not
 * subtle: on macOS it pushed the workbench header's only control that
 * far in from the edge, beside nothing.
 */
const setPlatform = (platform: string | undefined) => {
  ;(globalThis as unknown as { window: unknown }).window =
    platform === undefined ? {} : { electronAPI: { platform } }
}

afterEach(() => { delete (globalThis as unknown as { window?: unknown }).window })

describe('drawsOwnCaptionButtons', () => {
  it('is true on Windows, where the app draws all three itself', () => {
    setPlatform('win32')
    expect(drawsOwnCaptionButtons()).toBe(true)
  })

  it('is true on Linux, for the same reason', () => {
    setPlatform('linux')
    expect(drawsOwnCaptionButtons()).toBe(true)
  })

  it('is false on macOS, where Apple keeps its own at the top left', () => {
    setPlatform('darwin')
    expect(drawsOwnCaptionButtons()).toBe(false)
  })

  it('defaults to true when no bridge has been installed', () => {
    // A harness, or any surface rendered outside the app. The default
    // is the behaviour Windows and Linux have always had, so a missing
    // bridge cannot silently move the chrome.
    setPlatform(undefined)
    expect(drawsOwnCaptionButtons()).toBe(true)
  })
})
