import { EventEmitter } from 'node:events'
import { MONTHS, MAX_FOLDER_DEPTH, normalizeExifDate } from '../constants'
import type { DriveClient } from './drive-client'

/**
 * Drive library organiser.
 *
 * Sorts files into Year/Month/Day folders from their EXIF capture date
 * and prunes empty folders.
 */
export class DriveOrganizer extends EventEmitter {
  private driveService: DriveClient | null = null
  private organizeAbort: AbortController | null = null

  /** Attach the Drive service for organizer function calls */
  setDriveService(service: DriveClient) {
    this.driveService = service
  }

  /** Recursively remove empty folders (depth-first so children are removed before parents) */
  async executeRemoveEmptyFolders(folderId: string): Promise<{ summary: string; removedCount: number }> {
    if (!this.driveService) throw new Error('Drive service not available')

    let removedCount = 0
    const removed: string[] = []

    const sweep = async (parentId: string): Promise<boolean> => {
      const contents = await this.driveService!.listFolderContents(parentId)

      // Recurse into subfolders first (depth-first)
      for (const folder of contents.folders) {
        const childEmpty = await sweep(folder.id)
        if (childEmpty) {
          try {
            await this.driveService!.trashFile(folder.id)
            removedCount++
            removed.push(folder.name)
            this.emit('log', { level: 'info', source: 'drive', message: `Removed empty folder: ${folder.name}` })
          } catch {
            // Skip folders we don't have write access to (created outside Cernix)
            this.emit('log', { level: 'warn', source: 'drive', message: `Skipped: ${folder.name} (no write access)` })
          }
        }
      }

      // Re-check after cleaning children
      const updated = await this.driveService!.listFolderContents(parentId)
      return updated.files.length === 0 && updated.folders.length === 0
    }

    await sweep(folderId)

    const summary = removedCount > 0
      ? `Removed ${removedCount} empty folder(s): ${removed.join(', ')}`
      : 'No empty folders found.'
    return { summary, removedCount }
  }

  /** Recursively collect all files from a folder and its subfolders */
  private async collectAllFiles(
    folderId: string, depth = 0, visited = new Set<string>()
  ): Promise<{ id: string; name: string; dateStr: string; hasExifDate: boolean; sourceFolderId: string }[]> {
    if (!this.driveService || depth > MAX_FOLDER_DEPTH || visited.has(folderId)) return []
    visited.add(folderId)
    const contents = await this.driveService.listFolderContents(folderId)

    const results = contents.files.map(f => ({
      id: f.id, name: f.name,
      // Prefer EXIF capture date over Drive upload date (guard against empty strings)
      dateStr: (f.captureTime && f.captureTime.trim()) || f.createdTime,
      hasExifDate: !!(f.captureTime && f.captureTime.trim()),
      sourceFolderId: folderId
    }))
    for (const folder of contents.folders) {
      const nested = await this.collectAllFiles(folder.id, depth + 1, visited)
      results.push(...nested)
    }
    return results
  }

  cancelOrganize(): void {
    this.organizeAbort?.abort()
  }

  async executeOrganizeByDate(
    folderId: string, useYear: boolean, useMonth: boolean, useDay: boolean
  ): Promise<{ summary: string; movedCount: number; foldersCreated: number }> {
    this.organizeAbort = new AbortController()
    const signal = this.organizeAbort.signal
    if (!this.driveService) throw new Error('Drive service not available')

    // Recursively collect ALL files from this folder and all children
    this.emit('log', { level: 'info', source: 'drive', message: 'Scanning all subfolders for files...' })
    const allFiles = await this.collectAllFiles(folderId)
    if (allFiles.length === 0) return { summary: 'No files to organize.', movedCount: 0, foldersCreated: 0 }

    this.emit('log', { level: 'info', source: 'drive', message: `Found ${allFiles.length} files across all subfolders.` })

    // Group files by date path
    // MONTHS imported from constants
    const groups = new Map<string, { files: { id: string; sourceFolderId: string }[] }>()

    // First pass: build a map of filename-number -> date from files with EXIF dates
    const numberToDate = new Map<number, Date>()
    for (const file of allFiles) {
      if (!file.hasExifDate) continue
      const normalized = normalizeExifDate(file.dateStr)
      const d = new Date(normalized)
      if (isNaN(d.getTime())) continue
      const numMatch = file.name.match(/(\d{4,})/)
      if (numMatch) numberToDate.set(parseInt(numMatch[1]), d)
    }

    this.emit('log', { level: 'info', source: 'drive', message: `EXIF dates found for ${numberToDate.size} files. Using proximity for the rest.` })

    let skippedCount = 0
    for (const file of allFiles) {
      let d: Date

      if (file.hasExifDate) {
        // Use EXIF capture date (colons in date -> dashes)
        const normalized = normalizeExifDate(file.dateStr)
        d = new Date(normalized)
      } else {
        // No EXIF - find nearest file by filename sequence number
        d = new Date(NaN) // start invalid, try proximity
        const numMatch = file.name.match(/(\d{4,})/)
        if (numMatch && numberToDate.size > 0) {
          const fileNum = parseInt(numMatch[1])
          let closest: Date | null = null
          let closestDist = Infinity
          for (const [num, date] of numberToDate) {
            const dist = Math.abs(num - fileNum)
            if (dist < closestDist) { closestDist = dist; closest = date }
          }
          if (closest && closestDist <= 200) d = closest
        }
        // Last resort: use Drive createdTime
        if (isNaN(d.getTime())) d = new Date(file.dateStr)
      }

      if (isNaN(d.getTime())) {
        skippedCount++
        if (skippedCount <= 3) {
          this.emit('log', { level: 'warn', source: 'drive', message: `Skipped: ${file.name} - no date available` })
        }
        continue
      }

      const parts: string[] = []
      if (useYear)  parts.push(String(d.getFullYear()))
      if (useMonth) parts.push(MONTHS[d.getMonth()])
      if (useDay)   parts.push(String(d.getDate()).padStart(2, '0'))
      const key = parts.join('/')

      if (!groups.has(key)) groups.set(key, { files: [] })
      groups.get(key)!.files.push({ id: file.id, sourceFolderId: file.sourceFolderId })
    }

    let movedCount = 0
    let foldersCreated = 0
    const lines: string[] = []

    // Cache folder lookups to avoid repeated API calls
    const folderCache = new Map<string, Map<string, string>>() // parentId -> Map<name, id>

    const getOrCreateFolder = async (parentId: string, name: string): Promise<string> => {
      if (!this.driveService) throw new Error('Drive service not available')
      if (!folderCache.has(parentId)) {
        const contents = await this.driveService.listFolderContents(parentId)
        folderCache.set(parentId, new Map(contents.folders.map(f => [f.name, f.id])))
      }
      const children = folderCache.get(parentId)!
      if (children.has(name)) return children.get(name)!

      const newId = await this.driveService.createSubfolder(parentId, name)
      children.set(name, newId)
      foldersCreated++
      this.emit('log', { level: 'info', source: 'drive', message: `Created folder: ${name}` })
      return newId
    }

    // Create folder hierarchy and move files
    let processed = 0
    const totalFiles = allFiles.length
    for (const [path, group] of groups) {
      if (signal.aborted) break

      const segments = path.split('/')
      let targetId = folderId
      for (const segment of segments) {
        targetId = await getOrCreateFolder(targetId, segment)
      }

      // Move files - skip if already in the correct folder
      for (const file of group.files) {
        if (signal.aborted) break
        processed++
        if (file.sourceFolderId !== targetId) {
          await this.driveService!.moveFile(file.id, targetId, file.sourceFolderId)
          movedCount++
        }
        // Progress every 25 files
        if (processed % 25 === 0) {
          this.emit('log', { level: 'info', source: 'drive', message: `Progress: ${processed}/${totalFiles} files (${movedCount} moved)` })
        }
      }
      lines.push(`[OK] ${path}: ${group.files.length} file(s)`)
    }

    const summary = movedCount > 0
      ? `Organized ${movedCount} files into ${foldersCreated} new folders:\n${lines.join('\n')}`
      : `All ${allFiles.length} files are already in the correct date folders.`
    return { summary, movedCount, foldersCreated }
  }

}
