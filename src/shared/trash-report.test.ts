import { describe, it, expect } from 'vitest'
import { classifyTrashError, forbiddenTrash, summariseTrash } from './trash-report'

describe('classifyTrashError', () => {
  it('treats a file that is gone as done, not failed', () => {
    expect(classifyTrashError('D:/card/A.JPG', false)).toEqual({ missing: true })
  })

  it('says a file that is still there was refused, and why', () => {
    const r = classifyTrashError('D:/card/A.JPG', true)
    expect(r.missing).toBe(false)
    if (!r.missing) {
      expect(r.failure.path).toBe('D:/card/A.JPG')
      expect(r.failure.message).toMatch(/open|permission/)
    }
  })
})

describe('summariseTrash', () => {
  const locked = classifyTrashError('D:/card/DSC_0001.JPG', true)
  const failure = locked.missing ? null : locked.failure!

  it('names the file that stayed', () => {
    expect(summariseTrash(5, 0, [failure!])).toMatch(/^Moved 5 files to Trash\. DSC_0001\.JPG stayed: /)
  })

  it('names the file in a Windows path too', () => {
    expect(summariseTrash(0, 0, [forbiddenTrash('C:\\x\\B.JPG')])).toMatch(/^B\.JPG stayed: /)
  })

  it('counts the rest when several stayed', () => {
    const many = [failure!, forbiddenTrash('D:/x/B.JPG'), forbiddenTrash('D:/x/C.JPG')]
    expect(summariseTrash(0, 0, many)).toMatch(/3 files stayed \(DSC_0001\.JPG and 2 more\)/)
  })

  it('mentions files that were already gone', () => {
    expect(summariseTrash(2, 1, [])).toBe('Moved 2 files to Trash. 1 file was already gone.')
  })
})
