/**
 * The line under "Importing Media": what is being copied, how far, how
 * fast, and how long is left. The sweep already sent the file, the
 * counts and the speed with every progress event; the screen used only
 * the percentage, so a long import said nothing a person could use.
 */

export interface SweepDetail {
  file: string
  current: number
  total: number
  bytesPerSecond: number
  /** When the first progress event arrived, ms since the epoch. */
  startedAt: number
  /** When this one did: the clock is read when the event lands, not at render. */
  at: number
}

function formatRate(bytesPerSecond: number): string {
  const mb = bytesPerSecond / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(mb >= 10 ? 0 : 1)} MB/s` : `${Math.round(bytesPerSecond / 1024)} KB/s`
}

function formatRemaining(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} s left`
  return `about ${Math.round(seconds / 60)} min left`
}

/** "12 of 678", the file, then speed and time left once they mean something. */
export function describeSweep(d: SweepDetail): { count: string; file: string; pace: string | null } {
  const elapsed = (d.at - d.startedAt) / 1000
  const parts: string[] = []
  if (d.bytesPerSecond > 0) parts.push(formatRate(d.bytesPerSecond))
  // Files, not bytes: the renderer does not know the bytes still to
  // come. Withheld until a few files and a few seconds have passed, when
  // a rate from one file would swing from minutes to seconds.
  if (d.current >= 3 && elapsed >= 3 && d.current < d.total) {
    parts.push(formatRemaining((elapsed / d.current) * (d.total - d.current)))
  }
  return {
    count: `${d.current.toLocaleString()} of ${d.total.toLocaleString()}`,
    file: d.file.split(/[\\/]/).pop() ?? d.file,
    pace: parts.length ? parts.join(' · ') : null,
  }
}
