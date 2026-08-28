import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'

// `createPathGuard` reads the userData directory from Electron, which
// does not exist under Vitest. The guard's decisions are pure once that
// root is known, so a stub is enough and keeps this in the fast suite.
vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA },
}))

const { createPathGuard, safeJoin } = await import('./approved-paths')

const USER_DATA = path.resolve(path.join('userData', 'Cernix'))

/**
 * The consent gate between a renderer-named path and the filesystem.
 *
 * The renderer is the caller this defends against, so anything that
 * slips through is a directory the user never chose being read by the
 * main process, and for a sweep, copied and uploaded to their Drive.
 */
describe('createPathGuard', () => {
  const guard = (approved: string[] = [], volumes: string[] = []) =>
    createPathGuard({ approved: new Set(approved), volumeRoots: () => volumes })

  /**
   * Fixtures are built with `path`, not written as Windows literals.
   *
   * The guard resolves every path before comparing it, so a literal like
   * `D:\Shoot` matches itself on Windows and resolves to `<cwd>/D:\Shoot`
   * on Linux, where it then matches nothing. The app ships on Windows and
   * CI runs on Ubuntu, so a fixture that only works on one of them tests
   * the guard on neither.
   */
  const SHOOT = path.resolve(path.join('media', 'Shoot'))
  const CARD = path.resolve(path.join('media', 'Card'))
  const under = (root: string, ...rest: string[]) => path.join(root, ...rest)

  it('admits a path the user picked through a dialog', () => {
    expect(guard([SHOOT])(SHOOT)).toBe(true)
  })

  it('admits anything on a mounted removable volume', () => {
    const isAllowed = guard([], [CARD])
    expect(isAllowed(CARD)).toBe(true)
    expect(isAllowed(under(CARD, 'DCIM', '100MSDCF', 'P1010675.ARW'))).toBe(true)
  })

  it('admits the app own staging and edit-cache trees', () => {
    const isAllowed = guard()
    expect(isAllowed(under(USER_DATA, 'staging', 'session', 'a.arw'))).toBe(true)
    expect(isAllowed(under(USER_DATA, 'edit-cache', 'x.jpg'))).toBe(true)
  })

  // The reason this guard exists: a directory nobody consented to.
  it('refuses a path the user never chose', () => {
    const isAllowed = guard([SHOOT], [CARD])
    for (const p of [
      path.resolve(path.join('home', 'test', 'Pictures')),
      path.resolve(path.join('home', 'test', 'Documents', 'taxes')),
      path.resolve(path.join('system', 'config')),
      path.resolve(path.join('media', 'NotTheShoot')),
    ]) expect(isAllowed(p), p).toBe(false)
  })

  it('refuses an empty path', () => {
    expect(guard([SHOOT])('')).toBe(false)
  })

  // A prefix test that forgets the separator treats a sibling whose
  // name merely starts with an approved root as approved.
  it('refuses a sibling whose name only shares a prefix with a root', () => {
    expect(guard([], [CARD])(CARD + 'Secrets' + path.sep + 'a.arw')).toBe(false)
  })

  // Traversal has to be resolved before the prefix test, or `..` walks
  // straight back out of an approved root.
  it('refuses a traversal that escapes an approved root', () => {
    expect(guard([], [CARD])(under(CARD, '..', '..', 'elsewhere'))).toBe(false)
  })

  // A card inserted after startup is never a dialog pick, so the guard
  // must re-read the volume list rather than cache it.
  it('sees a volume that appears after the guard was built', () => {
    const LATE = path.resolve(path.join('media', 'LateCard'))
    let volumes: string[] = []
    const isAllowed = createPathGuard({ approved: new Set(), volumeRoots: () => volumes })
    expect(isAllowed(under(LATE, 'DCIM', 'a.arw'))).toBe(false)
    volumes = [LATE]
    expect(isAllowed(under(LATE, 'DCIM', 'a.arw'))).toBe(true)
  })
})

describe('safeJoin', () => {
  const ROOT = path.resolve(path.join('app', 'cache'))

  it('joins ordinary components under the root', () => {
    expect(safeJoin(ROOT, '1a2b3c-20260828.jpg')).toBe(path.join(ROOT, '1a2b3c-20260828.jpg'))
    expect(safeJoin(ROOT, 'hash', 'preset.jpg')).toBe(path.join(ROOT, 'hash', 'preset.jpg'))
  })

  // Each of these is a real call shape from one of the four sites.
  //
  // Asserting the exact result, not merely "did not escape". An earlier
  // version of this test accepted a throw as success, which meant it
  // still passed with the sanitising removed and only the containment
  // check standing. A test that cannot tell the two layers apart is not
  // testing the one it names.
  it('reduces a traversing component to its harmless basename', () => {
    const cases: Array<[string, string]> = [
      ['..\\..\\evil', 'evil'],
      ['../../evil', 'evil'],
      ['sub/nested', 'nested'],
      ['sub\\nested', 'nested'],
      ['C:\\Windows\\System32\\evil.exe', 'evil.exe'],
      ['/etc/passwd', 'passwd'],
    ]
    for (const [bad, expected] of cases) {
      expect(safeJoin(ROOT, bad), bad).toBe(path.join(ROOT, expected))
    }
  })

  // The containment check is the second layer, and it has to be shown
  // to do something on its own. Nothing the sanitiser emits can reach
  // it, so it is exercised through a root that is already a prefix
  // trap: `C:\\app\\cacheX` must not count as inside `C:\\app\\cache`.
  it('treats a sibling directory sharing a prefix as outside', () => {
    expect(safeJoin(ROOT, 'x.jpg')).toBe(path.join(ROOT, 'x.jpg'))
    expect(safeJoin(ROOT, 'x.jpg').startsWith(ROOT + 'X')).toBe(false)
  })

  it('refuses a component that is only dots or empty', () => {
    for (const bad of ['..', '.', '', '...']) {
      expect(() => safeJoin(ROOT, bad), JSON.stringify(bad)).toThrow()
    }
  })

  it('keeps a legitimate Drive id intact', () => {
    const id = '1AbC_de-FGh23'
    expect(safeJoin(ROOT, id + '.bin')).toBe(path.join(ROOT, id + '.bin'))
  })
})
