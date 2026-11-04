import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@/types'

/**
 * The updater's state, kept current: asked for once on mount, then
 * followed through `update:status`. Main owns every decision; this only
 * mirrors it, so Settings and the notice can never disagree.
 */
export function useUpdates(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    let live = true
    const off = window.electronAPI.onUpdateStatus(s => { if (live) setStatus(s) })
    window.electronAPI.updateStatus()
      .then(s => { if (live) setStatus(s) })
      .catch(() => { /* no status is shown as no status, not as an error */ })
    return () => { live = false; off() }
  }, [])
  return status
}
