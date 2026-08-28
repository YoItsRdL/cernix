import React from 'react'
import { Image, Film, FileText } from 'lucide-react'

// ── Icons ──

export function getIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return <Image size={14} className="text-text-muted" />
  if (mimeType.startsWith('video/')) return <Film size={14} className="text-cat-video/60" />
  return <FileText size={14} className="text-text-disabled" />
}

// ── Formatting ──

export function formatSize(bytes: string) {
  const b = parseInt(bytes, 10)
  if (!b) return ''
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(b) / Math.log(k))
  return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Sorting and time ──

export const MONTH_ORDER: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

/** Drive's EXIF captureTime comes as "YYYY:MM:DD HH:MM:SS" which Date can't parse natively. */
export function parseDriveTime(s: string | null | undefined): number {
  if (!s) return 0
  // ISO form (createdTime) parses fine
  let t = new Date(s).getTime()
  if (!Number.isNaN(t)) return t
  // EXIF form: replace date-part colons with dashes and the space with T
  const exif = s.replace(/^(\d{4}):(\d{2}):(\d{2})\s/, '$1-$2-$3T')
  t = new Date(exif).getTime()
  return Number.isNaN(t) ? 0 : t
}

export function sortFilesOldestFirst<T extends { captureTime?: string | null; createdTime: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => {
    const ta = parseDriveTime(a.captureTime) || parseDriveTime(a.createdTime)
    const tb = parseDriveTime(b.captureTime) || parseDriveTime(b.createdTime)
    return ta - tb
  })
}

export function sortFolders<T extends { name: string }>(folders: T[]): T[] {
  return [...folders].sort((a, b) => {
    const ma = MONTH_ORDER[a.name.trim().toLowerCase()]
    const mb = MONTH_ORDER[b.name.trim().toLowerCase()]
    if (ma && mb) return ma - mb
    if (ma) return -1
    if (mb) return 1
    return a.name.localeCompare(b.name)
  })
}

// ── Sidebar Constants ──

// Sidebar action colours. User-facing category tags ("purple = video",
// "amber = caution", etc.), not status states. The `purple` key maps to
// the `cat-video` token in tokens.css; the rest point at `status-*` or
// `accent-*` roles. The key names are kept palette-flavoured because
// callers refer to them by colour (`SIDEBAR_COLORS.purple`). The
// VALUES are what matters for the audit.
export const SIDEBAR_COLORS = {
  purple:  { idle: 'text-cat-video/70 hover:text-cat-video',           disabled: 'text-cat-video/30' },
  blue:    { idle: 'text-accent-primary/70 hover:text-accent-primary', disabled: 'text-accent-primary/30' },
  amber:   { idle: 'text-status-warn/70 hover:text-status-warn',       disabled: 'text-status-warn/30' },
  red:     { idle: 'text-status-danger/70 hover:text-status-danger',   disabled: 'text-status-danger/30' },
  neutral: { idle: 'text-text-muted hover:text-text-muted',            disabled: 'text-text-disabled' },
} as const
