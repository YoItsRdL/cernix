import { exec } from 'node:child_process'
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

const execAsync = promisify(exec)

// ── Types ──
export interface VolumeInfo {
  path: string          // e.g. "E:\\"
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
   * Query Windows for removable drives using PowerShell.
   * DriveType 2 = Removable (SD cards, USB sticks)
   * Returns structured VolumeInfo for each detected volume.
   */
  private async scanRemovableVolumes(): Promise<VolumeInfo[]> {
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
}
