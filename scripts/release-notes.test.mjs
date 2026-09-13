import { describe, it, expect } from 'vitest'
import { sectionFor } from './release-notes.mjs'

/**
 * The parser behind the release page.
 *
 * Its own header claimed it was pure "so the parsing can be exercised
 * against real and awkward input rather than discovered during a
 * release", and then nothing exercised it — which is the shape of claim
 * this project has learned to distrust. A release page is a bad place to
 * find out that a section boundary was wrong.
 */
const CHANGELOG = [
  '# Cernix Workstation Changelog',
  '',
  '## [2.0.0] - 2026-10-01',
  '',
  '### Added',
  '- the new thing',
  '',
  '### Fixed',
  '- the old thing',
  '',
  '## [1.9.0] - 2026-09-01',
  '',
  '### Fixed',
  '- something earlier',
  '',
].join('\n')

describe('the section a release page is made of', () => {
  it('takes a version and leaves its neighbours alone', () => {
    const s = sectionFor(CHANGELOG, '2.0.0')
    expect(s).toContain('the new thing')
    expect(s).toContain('the old thing')
    expect(s).not.toContain('something earlier')
  })

  // The subheadings are the shape of the entry. Stopping at the first
  // `###` would publish "Added" and silently drop "Fixed".
  it('keeps the version\'s own subheadings', () => {
    expect(sectionFor(CHANGELOG, '2.0.0')).toContain('### Added')
    expect(sectionFor(CHANGELOG, '2.0.0')).toContain('### Fixed')
  })

  it('stops at the next version, carrying no heading of its own', () => {
    expect(sectionFor(CHANGELOG, '2.0.0')).not.toMatch(/^## /m)
  })

  it('reads the last version in the file, which has nothing after it', () => {
    expect(sectionFor(CHANGELOG, '1.9.0')).toBe('### Fixed\n- something earlier')
  })

  // The whole point of the guard: no entry must be distinguishable from
  // an entry, or a release publishes silence.
  it('returns nothing for a version that was never written up', () => {
    expect(sectionFor(CHANGELOG, '3.0.0')).toBeNull()
  })

  it('treats a heading with an empty body as nothing', () => {
    expect(sectionFor('## [1.0.0]\n\n## [0.9.0]\n- x', '1.0.0')).toBeNull()
  })

  // A real hazard given the versioning this project just discussed:
  // 1.2.3 must not match 1.2.30 and publish the wrong notes.
  it('does not match a version that merely starts the same', () => {
    expect(sectionFor('## [1.2.30]\n- thirty', '1.2.3')).toBeNull()
    expect(sectionFor('## [1.2.3]\n- three', '1.2.30')).toBeNull()
  })

  it('accepts a heading without brackets, which the file has used', () => {
    expect(sectionFor('## 1.4.0\n- ok', '1.4.0')).toBe('- ok')
  })

  it('accepts a heading with a date, which is the current format', () => {
    expect(sectionFor('## [1.4.0] - 2026-01-01\n- ok', '1.4.0')).toBe('- ok')
  })
})

describe('against the real changelog', () => {
  it('has an entry for the version being shipped', async () => {
    const fs = await import('node:fs')
    const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf-8')
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
    expect(sectionFor(changelog, pkg.version), `no CHANGELOG entry for ${pkg.version}`).toBeTruthy()
  })
})
