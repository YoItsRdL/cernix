#!/usr/bin/env node
/**
 * The release notes for one version, taken from CHANGELOG.md.
 *
 * Every release page said the same thing: which file to download and how
 * to get past the unsigned-app warning, and nothing whatsoever about what
 * had changed. Someone looking at v1.2.3 could not tell it fixed the
 * macOS build, and the account of it — written, reviewed, and sitting in
 * CHANGELOG.md — never reached the one page they were reading.
 *
 * So the changelog entry becomes the notes, and the install boilerplate
 * moves below it where it belongs.
 *
 * Exits non-zero when the version has no entry. That is the point rather
 * than a side effect: a release nobody wrote down is a release nobody can
 * explain, and it should not reach a release page.
 *
 *   node scripts/release-notes.mjs 1.2.3 [--out notes.md]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The body of one `## [version]` section, without its heading.
 *
 * Ends at the next `## ` at the same level, so a version's own `###`
 * subheadings — Added, Fixed — come with it. Exported and pure so the
 * parsing can be exercised against real and awkward input rather than
 * discovered during a release.
 */
export function sectionFor(changelog, version) {
  const lines = changelog.split('\n')
  // `## [1.2.3]` and `## [1.2.3] - 2026-09-13` both count; a bare
  // `## 1.2.3` does too, because the format has not always been strict.
  const heading = new RegExp(`^##\\s+\\[?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`)
  const start = lines.findIndex(l => heading.test(l))
  if (start === -1) return null

  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => /^##\s/.test(l))
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
  return body === '' ? null : body
}

// The CLI runs only when this file is the entry point, so the parsing
// above can be imported and exercised without a release happening.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

const version = isMain ? process.argv[2] : null
if (isMain && !version) {
  console.error('usage: node scripts/release-notes.mjs <version> [--out <file>]')
  process.exit(2)
}

if (isMain) {
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf-8')
  const section = sectionFor(changelog, version)

  if (!section) {
    console.error(`No CHANGELOG.md entry for ${version}.`)
    console.error('')
    console.error('A release has to say what changed. Add a "## [' + version + ']" section')
    console.error('before tagging: the release page has no other source for it.')
    process.exit(1)
  }

  // The install and signing notes follow the changelog rather than lead
  // it. What a reader wants first is what is different; how to open it
  // is the second question, and only once.
  const notes = `${section}

---

| Platform | File |
|---|---|
| Windows | \`Cernix-Setup-${version}.exe\` — installer |
| Linux | \`Cernix-${version}-x86_64.AppImage\` — mark executable and run |
| macOS | \`Cernix-${version}-arm64.dmg\` (Apple Silicon) · \`-x64.dmg\` (Intel) |

**No build is code-signed**, so each platform asks once.

- **Windows**: SmartScreen shows "Windows protected your PC" — *More info → Run anyway*.
- **macOS**: drag Cernix to Applications, then run \`xattr -dr com.apple.quarantine /Applications/Cernix.app\`. Right-click → Open is the usual advice and is not enough here: a download is quarantined and macOS may call the app *damaged*, which offers only Move to Trash.
- **Linux**: mark the AppImage executable and run it.

Verify any download against the sha256 in \`binary.json\`.
`

  const outFlag = process.argv.indexOf('--out')
  if (outFlag !== -1 && process.argv[outFlag + 1]) {
    fs.writeFileSync(process.argv[outFlag + 1], notes)
    console.error(`release notes for ${version} -> ${process.argv[outFlag + 1]}`)
  } else {
    process.stdout.write(notes)
  }
}
