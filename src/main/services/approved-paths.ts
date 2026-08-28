import path from 'node:path'
import { app } from 'electron'

/**
 * The single answer to "may the renderer name this path?".
 *
 * The renderer is the caller every path check here is defending
 * against, so a path it supplies is only honoured when it falls inside
 * a directory the app owns, sits on a currently mounted removable
 * volume, or was picked by the user through an OS dialog this session.
 *
 * This lived as a closure inside the `cernix-media://` protocol handler
 * and nowhere else, which is why the XMP sidecar handlers reached the
 * filesystem with an unchecked path: there was no shared thing to call.
 */
export interface ApprovedPathsDeps {
  /** Paths the user chose through an OS dialog this session. */
  approved: ReadonlySet<string>
  /** Roots of the removable volumes mounted right now. */
  volumeRoots: () => string[]
}

export function createPathGuard({ approved, volumeRoots }: ApprovedPathsDeps) {
  const userData = app.getPath('userData')
  const appRoots = [
    path.resolve(path.join(userData, 'edit-cache')),
    path.resolve(path.join(userData, 'staging')),
  ]

  return function isAllowed(p: string): boolean {
    if (!p) return false
    const resolved = path.resolve(p)
    // An explicit dialog pick is the user's own consent, so it bypasses
    // the root check.
    if (approved.has(resolved)) return true
    const roots = [...appRoots, ...volumeRoots().map(v => path.resolve(v))]
    return roots.some(root => {
      // `path.resolve` leaves a trailing separator on a drive root like
      // `D:\`, so appending one doubles it and every file on a
      // removable volume fails the prefix test. Normalise to exactly
      // one, and match the bare root separately.
      const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
      const bareRoot = rootWithSep.slice(0, -1)
      return resolved === bareRoot || resolved.startsWith(rootWithSep)
    })
  }
}

export type PathGuard = ReturnType<typeof createPathGuard>

/**
 * Join renderer-supplied name parts underneath a root the app chose.
 *
 * `createPathGuard` answers "may the renderer name this whole path?".
 * This answers the other half, which had no shared answer and so had
 * four separate wrong ones: the renderer names a *component* and the
 * app decides the directory. A component carrying a separator or `..`
 * walks straight out of that directory, and the caller then writes
 * there.
 *
 * All four sites were real. `EditCache` interpolated an unsanitised
 * Drive id into a filename, `preset-thumb-cache` did the same with a
 * source hash and a preset id, and both Drive batch handlers joined a
 * renderer-supplied `name` onto the folder the user had just picked in
 * a dialog. Each one wrote attacker-chosen bytes to an attacker-chosen
 * path given a compromised renderer.
 *
 * Parts are reduced to their basename and stripped to characters that
 * cannot traverse, which is lossless for the ids and hashes that use
 * this and merely cosmetic for a filename. The containment check after
 * the join is deliberate redundancy: stripping is what makes traversal
 * impossible today, and the check is what keeps it impossible when
 * someone later adds a component and forgets the rule.
 */
export function safeJoin(root: string, ...parts: string[]): string {
  const resolvedRoot = path.resolve(root)
  const safeParts = parts.map(raw => {
    // Both separators, on every platform. `path.basename` only knows the
    // host's own, so on Linux a Windows-shaped name arrives whole and is
    // then stripped into a run of letters rather than reduced to its last
    // segment. A Drive filename is not bound by the host's conventions,
    // so the split cannot be either.
    const lastSegment = String(raw ?? '').split(/[\\/]/).pop() ?? ''
    // `basename` still runs, to drop a trailing separator and to keep the
    // behaviour identical to the host's for ordinary names.
    const base = path.basename(lastSegment).replace(/[^0-9a-zA-Z._-]/g, '')
    // A part of only dots would survive the class above and still mean
    // "the parent", so it is not a usable name.
    if (!base || /^\.+$/.test(base)) {
      throw new Error('Refusing an unusable path component from the renderer')
    }
    return base
  })
  const joined = path.resolve(path.join(resolvedRoot, ...safeParts))
  if (joined !== resolvedRoot && !joined.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Refusing a path outside its root')
  }
  return joined
}
