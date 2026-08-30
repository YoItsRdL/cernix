import { exec } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { promisify } from 'node:util'

/** One Win32_LogicalDisk, narrowed to the fields read below. All
 *  optional: the query omits what Windows cannot determine, which is why
 *  every read here has a fallback. */
interface PowerShellDisk {
  DeviceID?: string
  VolumeName?: string
  Size?: number
  FreeSpace?: number
  FileSystem?: string
}

/** One node of `lsblk --json`, narrowed to the columns asked for.
 *  `children` is how partitions hang off their disk, so the tree has to
 *  be walked rather than read one level deep: the card is `sdb1`, never
 *  `sdb`. `mountpoints` is the modern spelling and `mountpoint` the one
 *  util-linux before 2.37 emits, so both are read. */
interface LsblkDevice {
  path?: string
  label?: string | null
  mountpoint?: string | null
  mountpoints?: (string | null)[] | null
  fstype?: string | null
  rm?: boolean
  hotplug?: boolean
  type?: string
  size?: number
  children?: LsblkDevice[]
}

const execAsync = promisify(exec)

// ── Types ──
export interface VolumeInfo {
  path: string          // "E:\\" on Windows, "/run/media/you/EOS_DIGITAL" on Linux
  label: string         // e.g. "EOS_DIGITAL"
  sizeBytes: number     // Total capacity
  freeBytes: number     // Free space
  fileSystem: string    // e.g. "FAT32", "exFAT"
}

export type VolumeWatcherEvents = {
  'volume:detected': [volume: VolumeInfo]
  'volume:removed':  [volume: VolumeInfo]
  'watcher:error':   [error: Error]
}

// ── Volume Watcher Service ──
// Polls the OS for removable drives and emits events
// when volumes are inserted or ejected.
//
export class VolumeWatcher extends EventEmitter {
  private intervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private knownVolumes: Map<string, VolumeInfo> = new Map()
  private isPolling = false
  /** So a host without lsblk reports once, not every two seconds. */
  private warnedNoLsblk = false

  constructor(options?: { intervalMs?: number }) {
    super()
    this.intervalMs = options?.intervalMs ?? 2000
  }

  // ── Public API ──

  /** Start polling for volume changes */
  start(): void {
    if (this.timer) return // Already running

    console.log(`[VolumeWatcher] Started polling every ${this.intervalMs}ms`)

    // Run an initial scan immediately
    this.poll()

    // Then poll on interval
    this.timer = setInterval(() => this.poll(), this.intervalMs)
  }

  /** Stop polling */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      console.log('[VolumeWatcher] Stopped')
    }
  }

  /** Get currently known volumes */
  getVolumes(): VolumeInfo[] {
    return Array.from(this.knownVolumes.values())
  }

  /** Check if watcher is active */
  isRunning(): boolean {
    return this.timer !== null
  }

  // ── Private ──

  private async poll(): Promise<void> {
    // Guard against overlapping polls (e.g. if a scan takes longer than the interval)
    if (this.isPolling) return
    this.isPolling = true

    try {
      const currentVolumes = await this.scanRemovableVolumes()
      const currentMap = new Map(currentVolumes.map(v => [v.path, v]))

      // Detect new volumes (present now, absent before)
      for (const [path, volume] of currentMap) {
        if (!this.knownVolumes.has(path)) {
          console.log(`[VolumeWatcher] Volume detected: ${volume.label || 'Unlabeled'} (${path})`)
          this.emit('volume:detected', volume)
        }
      }

      // Detect removed volumes (absent now, present before)
      for (const [path, volume] of this.knownVolumes) {
        if (!currentMap.has(path)) {
          console.log(`[VolumeWatcher] Volume removed: ${volume.label || 'Unlabeled'} (${path})`)
          this.emit('volume:removed', volume)
        }
      }

      // Update known state
      this.knownVolumes = currentMap

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      console.error('[VolumeWatcher] Poll error:', err.message)
      this.emit('watcher:error', err)
    } finally {
      this.isPolling = false
    }
  }

  /**
   * The removable volumes mounted right now.
   *
   * Each OS is asked in its own terms and the answers are normalised to
   * `VolumeInfo`, so everything above this line — the diffing, the
   * events, the path guard that trusts `getVolumes()` — is written once.
   */
  private async scanRemovableVolumes(): Promise<VolumeInfo[]> {
    if (process.platform === 'win32') return this.scanWindowsVolumes()
    if (process.platform === 'linux') return this.scanLinuxVolumes()
    return []
  }

  /** 
   * Query Windows for removable drives using PowerShell.
   * DriveType 2 = Removable (SD cards, USB sticks)
   * Returns structured VolumeInfo for each detected volume.
   */
  private async scanWindowsVolumes(): Promise<VolumeInfo[]> {
    const psCommand = `
      Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2" |
      Select-Object DeviceID, VolumeName, Size, FreeSpace, FileSystem |
      ConvertTo-Json -Compress
    `.trim().replace(/\n\s*/g, ' ')

    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -NonInteractive -Command "${psCommand}"`,
        { timeout: 5000 }
      )

      const trimmed = stdout.trim()
      if (!trimmed || trimmed === '') return []

      // PowerShell returns a single object (not array) when there's only one result
      const parsed = JSON.parse(trimmed)
      const disks = Array.isArray(parsed) ? parsed : [parsed]

      return disks.map((disk: PowerShellDisk) => ({
        path: `${disk.DeviceID}\\`,
        label: disk.VolumeName || 'Untitled',
        sizeBytes: disk.Size ?? 0,
        freeBytes: disk.FreeSpace ?? 0,
        fileSystem: disk.FileSystem || 'Unknown',
      }))

    } catch (error) {
      // Not a failure: with no removable drives PowerShell exits non-zero
      // and writes nothing, so the empty result arrives as a rejection.
      const exec = error as { stdout?: string; stderr?: string }
      if (exec.stdout?.trim() === '' || exec.stderr?.includes('ConvertTo-Json')) {
        return []
      }
      throw error
    }
  }

  /**
   * Query Linux for removable drives using lsblk.
   *
   * `lsblk --json` rather than /proc/mounts: a mount table says where
   * things are mounted but not whether the device behind one is
   * removable, which is the whole question. RM covers USB card readers
   * and sticks; HOTPLUG covers the built-in MMC/SD slots that report
   * RM=0, and a laptop with a card in its own slot is exactly the case
   * this app exists for.
   *
   * Sizes come from statfs on the mount point rather than lsblk's SIZE,
   * which is the block device's capacity and knows nothing about free
   * space. A card is only interesting once it is mounted, so the
   * filesystem is always there to ask.
   */
  private async scanLinuxVolumes(): Promise<VolumeInfo[]> {
    let stdout: string
    try {
      ({ stdout } = await execAsync(
        'lsblk --json --bytes --output PATH,LABEL,MOUNTPOINT,MOUNTPOINTS,FSTYPE,RM,HOTPLUG,TYPE,SIZE',
        { timeout: 5000 },
      ))
    } catch (error) {
      // lsblk is util-linux and present on every desktop distribution, so
      // its absence is a broken host rather than a passing condition. It
      // is reported once and then dropped: the poll runs every two
      // seconds, a missing binary will not appear, and an error per poll
      // would bury the one that said something.
      //
      // Only a missing binary latches. Anything else — a timeout under
      // load, a device that hung the enumeration — is transient by
      // definition, and silencing those after the first would be hiding
      // exactly the faults worth seeing.
      if (isCommandMissing(error)) {
        if (this.warnedNoLsblk) return []
        this.warnedNoLsblk = true
        throw new Error('lsblk could not be run, so removable volumes cannot be '
          + 'detected. Install util-linux.')
      }
      throw error
    }

    const trimmed = stdout.trim()
    if (!trimmed) return []

    const found = parseLsblkTree(JSON.parse(trimmed) as LsblkTree)

    // statfs per volume, in parallel: there are single digits of these.
    // A card pulled between the lsblk call and this one fails here, and
    // the zeroes it leaves are the same ones an unreadable mount gets.
    //
    // On a deadline, because statfs on a stale mount — a card physically
    // pulled while the kernel still has it mounted, which is the ordinary
    // way this app's users remove one — blocks in uninterruptible I/O and
    // never returns. `poll` clears `isPolling` in a `finally`, so a call
    // that never settles leaves the flag set and every later poll returns
    // at the guard: the watcher stops seeing cards, silently, until the
    // app restarts. The Windows path cannot do this because its exec
    // carries a timeout, and this is the same five seconds.
    await Promise.all(found.map(async (volume) => {
      try {
        const stat = await withDeadline(fsp.statfs(volume.path), STATFS_TIMEOUT_MS)
        volume.sizeBytes = Number(stat.bsize) * Number(stat.blocks)
        volume.freeBytes = Number(stat.bsize) * Number(stat.bavail)
      } catch {
        // Left at zero. The UI reads these for a capacity bar, which is
        // worth losing rather than dropping a card the user can see.
      }
    }))

    return found
  }
}

/** How long a single statfs may take before its volume is reported without sizes. */
const STATFS_TIMEOUT_MS = 5000

/**
 * Reject if `promise` has not settled within `ms`.
 *
 * The timer is always cleared, including on the happy path: an uncleared
 * `setTimeout` holds the event loop open, and this runs every two seconds
 * for the life of the app.
 *
 * The underlying operation is not cancelled — nothing can cancel a
 * blocking statfs — so this bounds the *waiting*, not the work. That is
 * the whole requirement here: the poll must not be held open by it.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer)) as Promise<T>
}

/**
 * Is this the shell reporting that lsblk is not installed, rather than
 * lsblk reporting something about the machine?
 *
 * `exec` runs through a shell, so a missing binary arrives as exit 127
 * and a message from the shell rather than as ENOENT from spawn.
 */
function isCommandMissing(error: unknown): boolean {
  const e = error as { code?: number | string; stderr?: string }
  return e?.code === 127 || /not found|No such file or directory/i.test(e?.stderr ?? '')
}

/** The shape `lsblk --json` returns. */
export interface LsblkTree {
  blockdevices?: LsblkDevice[]
}

/**
 * Turn an `lsblk --json` tree into the removable volumes it describes.
 *
 * Split out from the call that produces it so the filter — which is the
 * part with judgement in it, and the part that decides whether the app
 * offers to sweep your root filesystem — can be tested against trees
 * this machine does not happen to have.
 *
 * Sizes come back zero: they are statfs's to fill in, and statfs needs
 * the volume to still be mounted, which is not a property of a parsed
 * string.
 */
export function parseLsblkTree(tree: LsblkTree): VolumeInfo[] {
  const found: VolumeInfo[] = []

  // Partitions hang off their disk, and lsblk does not repeat the
  // parent's RM onto them on every version, so removability is carried
  // down the walk rather than read off the leaf.
  const walk = (nodes: LsblkDevice[] | undefined, parentRemovable: boolean): void => {
    for (const node of nodes ?? []) {
      const removable = parentRemovable || node.rm === true || node.hotplug === true
      const mount = node.mountpoint ?? node.mountpoints?.find(m => m) ?? null
      if (removable && mount && isMountable(mount, node.fstype)) {
        found.push({
          path: mount,
          label: node.label || path.basename(mount) || 'Untitled',
          sizeBytes: 0,
          freeBytes: 0,
          fileSystem: node.fstype || 'Unknown',
        })
      }
      walk(node.children, removable)
    }
  }
  walk(tree.blockdevices, false)
  return found
}

/**
 * Is this mount point a place a memory card would be, rather than the
 * system it is plugged into?
 *
 * The removable flag is the real filter; this is the guard behind it.
 * An external drive the machine boots from, or a hotplug-flagged NVMe,
 * would otherwise arrive as a card to be swept, and offering to ingest
 * `/` is worse than missing a volume.
 */
function isMountable(mount: string, fstype: string | null | undefined): boolean {
  if (!mount.startsWith('/')) return false          // "[SWAP]"
  if (!fstype || fstype === 'swap') return false
  if (mount === '/') return false
  return !SYSTEM_MOUNTS.some(root => mount === root || mount.startsWith(root + '/'))
}

const SYSTEM_MOUNTS = ['/boot', '/efi', '/usr', '/var', '/etc', '/nix', '/home']
