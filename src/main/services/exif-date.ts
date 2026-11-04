/**
 * A capture date from the raw text ExifTool prints for DateTimeOriginal or
 * CreateDate: `2026:10:24 10:01:00`, optionally with fractions and a UTC
 * offset. Read this way, only those two tags are decoded: the full `read`
 * parsed every tag in every file, and a sweep was bound by that.
 *
 * A date with no offset is the camera's local clock, so it is taken as the
 * local time on this machine, as the library's own conversion does.
 */
export function parseExifDate(raw: unknown): Date | undefined {
  if (typeof raw !== 'string') return undefined
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(raw.trim())
  if (!m) return undefined
  const [, y, mo, d, h, mi, s, zone] = m
  // ExifTool writes 0000:00:00 for "no date".
  if (Number(y) === 0 || Number(mo) === 0 || Number(d) === 0) return undefined
  let date: Date
  if (zone) {
    const offset = zone === 'Z' ? '+00:00' : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone
    date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`)
  } else {
    date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  }
  return Number.isNaN(date.getTime()) ? undefined : date
}
