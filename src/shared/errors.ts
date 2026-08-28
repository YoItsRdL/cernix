/**
 * The message out of a thrown value.
 *
 * `catch` binds `unknown`, because JavaScript can throw anything. A
 * string, a number, a rejected fetch. Twenty-six sites here wanted the
 * same line and typed the binding `any` to get it, which turns the
 * compiler off for the rest of the block rather than for the one
 * property being read.
 */
export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}
