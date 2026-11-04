import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
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
  /** Where the Local Archive is now, once the person has moved it from the default. */
  archiveRoot?: () => string | null
}

/**
 * Where a path really is, with every link along it followed.
 *
 * The guard compared names, so a junction or symlink inside an approved
 * root (edit-cache, staging, a card prepared with links) reached
 * whatever it pointed at: the trash recycled a decoy folder and a
 * sidecar was written outside every root (F-015). A path that does not
 * exist yet, a file about to be written, is resolved through the nearest
 * ancestor that does, and the missing part is joined back on.
 */
function realPath(p: string): string {
  const resolved = path.resolve(p)
  const missing: string[] = []
  let at = resolved
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(at), ...missing.reverse())
    } catch {
      const parent = path.dirname(at)
      if (parent === at) return resolved
      missing.push(path.basename(at))
      at = parent
    }
  }
}

export function createPathGuard({ approved, volumeRoots, archiveRoot }: ApprovedPathsDeps) {
  const userData = app.getPath('userData')
  const appRoots = [
    path.resolve(path.join(userData, 'edit-cache')),
    path.resolve(path.join(userData, 'staging')),
  ]

  // Where each root really is, remembered for two seconds. A page of
  // thumbnails asks this hundreds of times, and a root does not move that
  // fast: the cost per call was 0.77 ms on the main thread before this.
  const realRoots = new Map<string, { real: string; at: number }>()
  const realRoot = (root: string): string => {
    const now = Date.now()
    const hit = realRoots.get(root)
    if (hit && now - hit.at < 2000) return hit.real
    const real = realPath(root)
    realRoots.set(root, { real, at: now })
    return real
  }

  return function isAllowed(p: string): boolean {
    if (!p) return false
    // Compared by where the path really is, against where each root
    // really is, so a link cannot lead out of an approved root and a root
    // that is itself a link still admits what is inside it.
    const real = realPath(p)
    // An explicit dialog pick is the user's own consent, and a folder
    // picked to import is consent to what is inside it: the sweep, the
    // previews and the trash all name files under it. Exact-match only
    // admitted the folder itself, which suited a picked image and
    // refused every folder import there has ever been.
    const roots = [...appRoots, ...(archiveRoot?.() ? [archiveRoot()!] : []), ...[...approved], ...volumeRoots()].map(realRoot)
    return roots.some(root => {
      // `path.resolve` leaves a trailing separator on a drive root like
      // `D:\`, so appending one doubles it and every file on a
      // removable volume fails the prefix test. Normalise to exactly
      // one, and match the bare root separately.
      const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
      const bareRoot = rootWithSep.slice(0, -1)
      return real === bareRoot || real.startsWith(rootWithSep)
    })
  }
}

export type PathGuard = ReturnType<typeof createPathGuard>

/**
 * A folder too broad to approve as an import source.
 *
 * A folder pick approves everything beneath it for the session: the
 * scan, previews, sidecars and the trash. Picking the system drive's
 * root or the user's profile approves nearly everything the person owns.
 * Another drive's root is left alone: a photographer's photographs often
 * live on one, and a card is a drive root by definition.
 */
export function tooBroadToApprove(picked: string, home: string, systemRoot: string): boolean {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase()
  const pick = norm(picked)
  if (pick === '' || pick === norm(systemRoot)) return true
  const h = norm(home)
  // The profile itself, or any folder that contains it.
  return pick === h || h.startsWith(pick + path.sep) || h.startsWith(pick + '/')
}

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

/**
 * A file name from Drive, made safe to create in a folder the user
 * picked, keeping as much of the original as the filesystem allows.
 *
 * `safeJoin`'s reduction to `[0-9A-Za-z._-]` is lossless for ids and
 * hashes but not for what people name their photographs: "IMG 1.jpg"
 * and "IMG1.jpg" became the same file, and every name written in
 * another script became ".jpg". Here only what cannot be in a name is
 * removed: separators (so it cannot traverse), the characters Windows
 * forbids, control characters, and trailing dots and spaces, which
 * Windows drops silently. A device name (CON, NUL, COM1...) gets a
 * leading underscore. A name with nothing left becomes `fallback`.
 */
export function downloadName(raw: string, fallback: string): string {
  const lastSegment = String(raw ?? '').split(/[\\/]/).pop() ?? ''
  // Control characters are matched on purpose: Windows refuses them in names.
  // eslint-disable-next-line no-control-regex
  let name = lastSegment.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim().replace(/[. ]+$/, '')
  if (!name || /^\.+$/.test(name)) name = fallback
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) name = '_' + name
  return name
}

/**
 * Creates an empty file for `name` in `dir` and returns its path, never
 * one that already exists: a taken name gets " (1)", " (2)" and so on
 * before its extension. Downloads and staging wrote with a plain
 * `writeFile`, so a file of the same name in the chosen folder, or an
 * earlier file of the same batch, was overwritten without a word.
 *
 * The exclusive create is what makes it hold for four downloads at once:
 * checking first and writing later would let two of them pick the same
 * free name. The caller writes over the empty file, and removes it if
 * the download fails.
 */
export async function claimFreePath(dir: string, name: string): Promise<string> {
  const ext = path.extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  for (let n = 0; n < 1000; n++) {
    const candidate = safeContained(dir, n === 0 ? name : `${stem} (${n})${ext}`)
    try {
      await (await fsp.open(candidate, 'wx')).close()
      return candidate
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error(`No free name for ${name} in ${dir}`)
}

/** The containment half of `safeJoin`, for a name already made safe. */
function safeContained(root: string, name: string): string {
  const resolvedRoot = path.resolve(root)
  const joined = path.resolve(resolvedRoot, name)
  if (path.dirname(joined) !== resolvedRoot) {
    throw new Error('Refusing a path outside its root')
  }
  return joined
}
