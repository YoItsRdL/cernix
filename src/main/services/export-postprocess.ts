import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { messageOf } from '../../shared/errors'

/**
 * Resolve the bundled exiftool binary path. `exiftool-vendored` depends on
 * platform-specific packages that export the binary path as their default
 * export. We use that directly so we don't have to rely on the library's
 * persistent-process wrapper just to discover the path.
 *
 * npm nests these platform packages under `exiftool-vendored`'s own
 * `node_modules` rather than hoisting them to the top level, so a bare
 * `require('exiftool-vendored.pl')` from this file cannot find them: Node
 * walks up from *this* file's directory, never down into a sibling
 * package's node_modules. Anchoring the require to a path inside
 * `exiftool-vendored` itself (the same way its own internal code resolves
 * the platform package) fixes that, in dev and in the packaged asar alike.
 */
const cjsRequire = createRequire(import.meta.url)
let cachedExiftoolPath: string | null | undefined
function getExiftoolPath(): string {
  if (cachedExiftoolPath !== undefined && cachedExiftoolPath !== null) return cachedExiftoolPath
  const pkg = process.platform === 'win32' ? 'exiftool-vendored.exe' : 'exiftool-vendored.pl'
  const anchoredRequire = createRequire(cjsRequire.resolve('exiftool-vendored'))
  const resolved = anchoredRequire(pkg) as string
  // The path above is computed from `__dirname` inside the (possibly
  // asar-packed) module, so it can point *through* app.asar even though
  // this binary was asarUnpack'd onto real disk. `fs` calls survive that
  // transparently; `spawn` doesn't, since it hands the path straight to
  // the OS, which sees app.asar as one file, not a directory, and fails
  // with ENOTDIR. Redirect to the real unpacked location before spawning.
  cachedExiftoolPath = resolved.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`,
  )
  return cachedExiftoolPath
}

/**
 * Best-effort lookup of a system sRGB ICC profile. Returns the absolute path
 * if found, else null. Common locations per OS. Most consumer machines have
 * one pre-installed, so we don't bundle a profile binary in v1.
 */
let cachedIccPath: string | null | undefined
function findSystemSrgbProfile(): string | null {
  if (cachedIccPath !== undefined) return cachedIccPath
  const candidates = [
    'C:\\Windows\\System32\\spool\\drivers\\color\\sRGB Color Space Profile.icm',
    '/System/Library/ColorSync/Profiles/sRGB Profile.icc',
    '/usr/share/color/icc/colord/sRGB.icc',
    '/usr/share/color/icc/sRGB.icc',
  ]
  cachedIccPath = candidates.find(p => fs.existsSync(p)) ?? null
  return cachedIccPath
}

export interface PostprocessResult {
  bytes: Uint8Array
  /** Present iff postprocess couldn't fully enrich the file. UI surfaces this. */
  warning?: string
}

/**
 * Copy EXIF + ICC from `sourcePath` into the WebGL-rendered JPEG bytes.
 *
 * We spawn exiftool as a one-shot child process rather than going through
 * `exiftool-vendored`'s persistent stay-open process. The shared persistent
 * instance is also used by the SD-card scanner (file-sweeper) and has been
 * observed to stall indefinitely when the editor calls it concurrently.
 * Spawning fresh trades ~300ms startup for deterministic behavior.
 */
export async function postprocessExport(
  outputBytes: Uint8Array,
  sourcePath: string | null,
  onProgress?: (stage: string) => void,
): Promise<PostprocessResult> {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { bytes: outputBytes, warning: 'no source on disk: export has no EXIF/ICC' }
  }
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cernix-export-'))
  const tmpOut = path.join(tmpDir, 'export.jpg')
  try {
    onProgress?.('writing temp')
    await fsp.writeFile(tmpOut, outputBytes)

    onProgress?.('copying EXIF from source')
    const iccPath = findSystemSrgbProfile()
    // `-TagsFromFile source -all:all` copies the source's embedded thumbnail
    // and preview image too. Phone galleries and Instagram display THOSE
    // bitmaps rather than decoding the main JPEG, so without clearing them
    // the viewer sees the unedited source. Explicit `-ThumbnailImage=` and
    // `-PreviewImage=` clears after the copy force apps to use the real pixels.
    const args = [
      '-overwrite_original',
      '-TagsFromFile', sourcePath, '-all:all',
      '-Orientation=',
      '-ThumbnailImage=',
      '-PreviewImage=',
      '-JpgFromRaw=',
      '-Software=Cernix Edit v1',
      `-ModifyDate=${formatExifDateTime(new Date())}`,
      '-ColorSpace=sRGB',
    ]
    if (iccPath) args.push(`-icc_profile<=${iccPath}`)
    args.push(tmpOut)
    await runExiftool(args, 15_000)

    onProgress?.('reading enriched bytes')
    return { bytes: await fsp.readFile(tmpOut) }
  } catch (err) {
    const msg = messageOf(err)?.slice(0, 120) || 'unknown'
    onProgress?.(`postprocess failed: ${msg}, using raw bytes`)
    return { bytes: outputBytes, warning: `EXIF/ICC copy failed: ${msg}` }
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function runExiftool(args: string[], timeoutMs: number): Promise<void> {
  const exePath = getExiftoolPath()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exePath, args, { windowsHide: true })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`exiftool timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stderr?.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`exiftool exited ${code}: ${stderr.slice(-160)}`))
    })
  })
}

/** EXIF wants `YYYY:MM:DD HH:MM:SS` (colon-separated date): Date.toISOString isn't accepted. */
function formatExifDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
