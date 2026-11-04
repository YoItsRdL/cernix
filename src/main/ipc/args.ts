/**
 * What a bridge handler will accept from the renderer.
 *
 * The renderer is the caller these defend against: a bug in it, or a
 * compromised one, hands over whatever it likes. Each check refuses with a
 * sentence rather than storing the value or leaving it to the database's
 * own error (F-017).
 */
import { DEFAULT_PARAMS } from '../../shared/edit-params'

export function fileIdArg(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) throw new Error('That is not a valid file id.')
  return v
}

export function nameArg(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : ''
  if (name.length === 0 || name.length > 80) throw new Error('A name needs 1 to 80 characters.')
  return name
}

export function flagArg(v: unknown): 'pick' | null {
  if (v === 'pick' || v === null) return v
  throw new Error('A flag is either "pick" or nothing.')
}

export function pathListArg(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 100_000 || !v.every(p => typeof p === 'string' && p.length > 0 && p.length < 4096)) {
    throw new Error('Expected a list of file paths.')
  }
  return v
}

/** Edit parameters whose values have the types the defaults have. */
export function paramsArg<T extends object>(v: T): T {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('Edit parameters must be an object.')
  const defaults = DEFAULT_PARAMS as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(v)) {
    const want = typeof defaults[key]
    if (want === 'number' && !(typeof value === 'number' && Number.isFinite(value))) throw new Error(`"${key}" must be a number.`)
    if (want === 'boolean' && typeof value !== 'boolean') throw new Error(`"${key}" must be true or false.`)
    if (want === 'string' && (typeof value !== 'string' || value.length > 200)) throw new Error(`"${key}" must be short text.`)
  }
  return v
}
