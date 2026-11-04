import { describe, it, expect } from 'vitest'
import { fileIdArg, nameArg, flagArg, pathListArg, paramsArg } from './args'
import { DEFAULT_PARAMS } from '../../shared/edit-params'

describe('bridge arguments', () => {
  it('takes a file id of sensible length only', () => {
    expect(fileIdArg('1AbC')).toBe('1AbC')
    expect(() => fileIdArg('')).toThrow()
    expect(() => fileIdArg('x'.repeat(100_000))).toThrow()
    expect(() => fileIdArg(42)).toThrow()
  })

  it('takes a trimmed name of 1 to 80 characters', () => {
    expect(nameArg('  Warm  ')).toBe('Warm')
    expect(() => nameArg('   ')).toThrow()
    expect(() => nameArg('x'.repeat(100_000))).toThrow()
  })

  it('takes "pick" or null as a flag, and not the database error for anything else', () => {
    expect(flagArg('pick')).toBe('pick')
    expect(flagArg(null)).toBeNull()
    expect(() => flagArg('reject')).toThrow('"pick"')
  })

  it('takes a list of paths and not a string, which would be read character by character', () => {
    expect(pathListArg(['a', 'b'])).toEqual(['a', 'b'])
    expect(() => pathListArg('nope')).toThrow()
    expect(() => pathListArg(['a', 3])).toThrow()
  })

  it('keeps preset values the type the defaults have', () => {
    expect(paramsArg({ ...DEFAULT_PARAMS })).toBeTruthy()
    expect(() => paramsArg({ ...DEFAULT_PARAMS, exposure: 'NaN' as unknown as number })).toThrow('exposure')
    expect(() => paramsArg({ ...DEFAULT_PARAMS, exposure: NaN })).toThrow('exposure')
    expect(() => paramsArg(null as unknown as object)).toThrow()
  })
})
