import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// `createPathGuard` reads the userData directory from Electron, which
// does not exist under Vitest. The guard's decisions are pure once that
// root is known, so a stub is enough and keeps this in the fast suite.
vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA },
}))

const { createPathGuard, safeJoin, downloadName, claimFreePath, tooBroadToApprove } = await import('./approved-paths')

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

  // A folder picked to import is consent to its contents: the sweep, the
  // previews and the trash all name files inside it.
  it('admits what is inside a folder the user picked', () => {
    const isAllowed = guard([SHOOT])
    expect(isAllowed(under(SHOOT, 'DCIM', '100CERNX', 'QA_0001.JPG'))).toBe(true)
  })

  it('does not stretch a pick to its siblings, its parent or look-alike names', () => {
    const isAllowed = guard([SHOOT])
    expect(isAllowed(path.dirname(SHOOT))).toBe(false)
    expect(isAllowed(under(path.dirname(SHOOT), 'Other', 'a.jpg'))).toBe(false)
    expect(isAllowed(SHOOT + '-old')).toBe(false)
    expect(isAllowed(under(SHOOT, '..', 'Other', 'a.jpg'))).toBe(false)
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

describe('downloadName', () => {
  // Names `safeJoin` collapsed: two files became one, and a name in
  // another script lost every letter.
  it('keeps what a filesystem allows', () => {
    expect(downloadName('IMG 1.jpg', 'id')).toBe('IMG 1.jpg')
    expect(downloadName('IMG1.jpg', 'id')).toBe('IMG1.jpg')
    expect(downloadName('写真.jpg', 'id')).toBe('写真.jpg')
    expect(downloadName('Café (final).tif', 'id')).toBe('Café (final).tif')
  })

  it('still cannot traverse', () => {
    expect(downloadName('..\\..\\evil.exe', 'id')).toBe('evil.exe')
    expect(downloadName('../../etc/passwd', 'id')).toBe('passwd')
  })

  it('drops what Windows refuses or silently changes', () => {
    expect(downloadName('a<b>:c"d|e?f*.jpg', 'id')).toBe('abcdef.jpg')
    expect(downloadName('name. . ', 'id')).toBe('name')
    expect(downloadName('CON.jpg', 'id')).toBe('_CON.jpg')
    expect(downloadName('nul', 'id')).toBe('_nul')
  })

  it('falls back when nothing usable is left', () => {
    for (const bad of ['', '..', '???', '/']) expect(downloadName(bad, '1AbC'), bad).toBe('1AbC')
  })
})

describe('claimFreePath', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-claim-'))

  it('never hands out a name that is already there', async () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, 'a.jpg'), 'mine')
    const p = await claimFreePath(dir, 'a.jpg')
    expect(path.basename(p)).toBe('a (1).jpg')
    expect(fs.readFileSync(path.join(dir, 'a.jpg'), 'utf8')).toBe('mine')
  })

  // Four downloads run at once; checking and then writing would let two
  // of them take the same free name.
  it('gives each of several claims at once its own file', async () => {
    const dir = tmp()
    const paths = await Promise.all(Array.from({ length: 4 }, () => claimFreePath(dir, 'IMG.jpg')))
    expect(new Set(paths).size).toBe(4)
    expect(fs.readdirSync(dir).sort()).toEqual(['IMG (1).jpg', 'IMG (2).jpg', 'IMG (3).jpg', 'IMG.jpg'])
  })

  it('numbers a name without an extension', async () => {
    const dir = tmp()
    await claimFreePath(dir, 'README')
    expect(path.basename(await claimFreePath(dir, 'README'))).toBe('README (1)')
  })
})


describe('tooBroadToApprove', () => {
  const root = path.parse(path.resolve('.')).root
  const home = path.join(root, 'people', 'ana')
  it('refuses the system drive root, the profile and what contains it', () => {
    expect(tooBroadToApprove(root, home, root)).toBe(true)
    expect(tooBroadToApprove(path.join(root, 'people'), home, root)).toBe(true)
    expect(tooBroadToApprove(home, home, root)).toBe(true)
    expect(tooBroadToApprove(home + path.sep, home, root)).toBe(true)
  })
  it('allows a folder inside the profile, a sibling with a similar name, and another place', () => {
    expect(tooBroadToApprove(path.join(home, 'Pictures'), home, root)).toBe(false)
    expect(tooBroadToApprove(path.join(root, 'people', 'anabel'), home, root)).toBe(false)
    expect(tooBroadToApprove(path.join(root, 'photos'), home, root)).toBe(false)
  })
})

describe('createPathGuard and links', () => {
  // A junction needs no privilege on Windows; a symlink to a directory
  // does everywhere else, which a directory symlink of this kind does not.
  const link = (target: string, at: string) => fs.symlinkSync(target, at, 'junction')
  const make = () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cernix-links-'))
    const root = path.join(base, 'root')
    const outside = path.join(base, 'outside')
    fs.mkdirSync(root); fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'decoy.jpg'), 'x')
    fs.writeFileSync(path.join(root, 'real.jpg'), 'x')
    return { base, root, outside }
  }

  it('refuses a path that leaves an approved root through a link', () => {
    const { base, root, outside } = make()
    try {
      link(outside, path.join(root, 'link'))
      const isAllowed = createPathGuard({ approved: new Set([root]), volumeRoots: () => [] })
      expect(isAllowed(path.join(root, 'real.jpg'))).toBe(true)
      expect(isAllowed(path.join(root, 'link', 'decoy.jpg'))).toBe(false)
      // A file about to be written through the link, which does not exist yet.
      expect(isAllowed(path.join(root, 'link', 'new.xmp'))).toBe(false)
    } finally { fs.rmSync(base, { recursive: true, force: true }) }
  })

  it('still admits what is inside a root that is itself a link', () => {
    const { base, root, outside } = make()
    try {
      const picked = path.join(base, 'picked')
      link(root, picked)
      const isAllowed = createPathGuard({ approved: new Set([picked]), volumeRoots: () => [] })
      expect(isAllowed(path.join(picked, 'real.jpg'))).toBe(true)
      expect(isAllowed(path.join(outside, 'decoy.jpg'))).toBe(false)
    } finally { fs.rmSync(base, { recursive: true, force: true }) }
  })
})
