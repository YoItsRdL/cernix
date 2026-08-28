import { useState, useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { type IngestState, type ScannedFile } from '@/types'

export function useIngest() {
  const [state, setState] = useState<IngestState>('idle')
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState(0)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [currentSession, setCurrentSession] = useState<string | null>(null)
  const [driveFolderId, setDriveFolderId] = useState<string | null>(null)
  const [driveFolderUrl, setDriveFolderUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  /**
   * How many files the upload could not deliver.
   *
   * Carried separately from `errorMessage` because it is not an error
   * state: the ingest finished, and most of it worked. It exists so the
   * completion screen cannot say "successfully" over a session that
   * left photographs behind, which is the moment the user reaches for
   * the card.
   */
  const [uploadFailures, setUploadFailures] = useState(0)

  // Refs for computing aggregate progress inside event callbacks
  const doneRef = useRef(0)
  const totalRef = useRef(0)

  // Mirror `state` in a ref so async actions (startScan / startSweep)
  // can read the *live* value without recreating the callback on every
  // transition. Recreating callbacks on every state change tears down
  // and rebuilds the App.tsx subscription effect that depends on them:
  // a known foot-gun for stale closures around in-flight IPC calls.
  const stateRef = useRef<IngestState>('idle')
  useEffect(() => { stateRef.current = state }, [state])

  // ── Atomic Transitions ──
  const transition = useCallback((next: IngestState) => {
    setState(next)
  }, [])

  // ── Actions ──
  const startScan = useCallback(async (path: string) => {
    const live = stateRef.current
    if (!['idle', 'error', 'complete', 'review'].includes(live)) {
      console.log(`[useIngest] Scan blocked: current state: ${live}`)
      toast.info('Please wait for the current operation to finish.')
      return
    }

    try {
      // No toast here. The next line hands the whole content area over
      // to a spinner reading "Scanning files… / Discovering media
      // files", so a toast saying the same thing arrives in the same
      // frame as the screen that already says it.
      //
      // A toast is for something you would otherwise miss. This is the
      // opposite: it is the only thing on screen.
      transition('scanning')
      console.log('[useIngest] sweepScan invoke →', path)
      const files = await window.electronAPI.sweepScan(path)
      console.log('[useIngest] sweepScan resolved ←', {
        count: files?.length ?? 'nullish',
        isArray: Array.isArray(files),
      })
      if (!Array.isArray(files)) {
        // Defensive: if the IPC bridge returns a non-array (e.g. a
        // serialization-collapsed payload on certain Electron versions),
        // surface it as an explicit error rather than hanging the UI.
        throw new Error(`sweepScan returned non-array: ${typeof files}`)
      }
      if (files.length === 0) {
        toast.info('No supported media files found in this folder.')
        setScannedFiles([])
        setSelectedFiles(new Set())
        transition('idle')
        return
      }
      setScannedFiles(files)
      // Only select files that haven't been imported yet
      setSelectedFiles(new Set(files.filter(f => !f.isUploaded).map(f => f.relativePath)))
      console.log('[useIngest] transition → review')
      transition('review')
    } catch (err) {
      console.error('[useIngest] startScan threw', err)
      setErrorMessage(err instanceof Error ? err.message : 'Scan failed')
      transition('error')
    }
  }, [transition])

  const toggleFile = useCallback((relativePath: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      if (next.has(relativePath)) next.delete(relativePath)
      else next.add(relativePath)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedFiles(prev => {
      if (prev.size === scannedFiles.length) return new Set()
      return new Set(scannedFiles.map(f => f.relativePath))
    })
  }, [scannedFiles])

  const setSelection = useCallback((paths: string[]) => {
    setSelectedFiles(new Set(paths))
  }, [])

  /** Remove files from the local review list: used after they've been
   *  trashed by the OS so the UI doesn't keep them in `scannedFiles`.
   *  No filesystem call here; the caller is responsible for the
   *  destructive op (`window.electronAPI.mediaTrash`) and only invokes
   *  this with the paths the OS actually accepted. */
  const removeFiles = useCallback((relativePaths: string[]) => {
    if (relativePaths.length === 0) return
    const drop = new Set(relativePaths)
    setScannedFiles(prev => prev.filter(f => !drop.has(f.relativePath)))
    setSelectedFiles(prev => {
      const next = new Set(prev)
      for (const p of drop) next.delete(p)
      return next
    })
  }, [])

  const startSweep = useCallback(async (sourcePath: string, customFolder?: string) => {
    if (stateRef.current !== 'review') return

    try {
      transition('sweeping')
      const selectedPaths = scannedFiles
        .filter(f => selectedFiles.has(f.relativePath))
        .map(f => f.relativePath)
      await window.electronAPI.sweepStart(sourcePath, selectedPaths, customFolder)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Sweep failed')
      transition('error')
    }
  }, [transition, scannedFiles, selectedFiles])

  // ── Event Synchronization ──
  useEffect(() => {
    const unsubProgress = window.electronAPI.onSweepProgress((p) => {
      setProgress(p.percentComplete)
    })

    const unsubComplete = window.electronAPI.onSweepComplete((s) => {
      setCurrentSession(s.sessionId)
      // A cancelled sweep still emits `sweep:complete`. Re-entering
      // `sweeping` here is what made "Terminate Protocol" look dead.
      // The overlay came straight back. Land on `idle` instead.
      if (s?.status === 'cancelled') {
        transition('idle')
        return
      }
      // Otherwise hold in `sweeping` while the upload phase reports in
      // (or main emits `sweep:error` when Drive isn't connected).
      transition('sweeping')
    })

    const unsubError = window.electronAPI.onSweepError((e) => {
      // Emitters send the text as `error`; `message` is the fallback.
      // Reading only `.message` here surfaced `undefined`, which the
      // UI then replaced with a generic "Something went wrong".
      setErrorMessage(e.error ?? e.message ?? 'Ingest failed.')
      transition('error')
    })

    // Upload:started carries the session summary with totalFiles
    const unsubUploadStarted = window.electronAPI.onUploadStarted((s) => {
      totalRef.current = s.totalFiles ?? 0
      doneRef.current = 0
      setUploadProgress(0)
    })

    // Per-file progress → compute overall batch %
    const unsubUploadProgress = window.electronAPI.onUploadProgress((p) => {
      const filePercent = p.percent ?? 0
      if (totalRef.current > 0) {
        const overall = ((doneRef.current + filePercent / 100) / totalRef.current) * 100
        setUploadProgress(Math.min(Math.round(overall), 99))
      }
      // When a file finishes, increment the done counter
      if (filePercent >= 100) {
        doneRef.current++
      }
    })

    const unsubUploadComplete = window.electronAPI.onUploadComplete((s) => {
      setDriveFolderId(s.driveFolderId)
      setDriveFolderUrl(s.driveFolderUrl)
      setUploadFailures(s.failedFiles ?? 0)
      // Only a session that delivered everything gets to show a full bar.
      setUploadProgress(s.failedFiles > 0 && s.totalFiles > 0
        ? Math.round((s.completedFiles / s.totalFiles) * 100)
        : 100)
      transition('complete')
    })

    return () => {
      unsubProgress()
      unsubComplete()
      unsubError()
      unsubUploadStarted()
      unsubUploadProgress()
      unsubUploadComplete()
    }
  }, [transition])

  const reset = useCallback(() => {
    setScannedFiles([])
    setSelectedFiles(new Set())
    setProgress(0)
    setUploadProgress(0)
    setDriveFolderId(null)
    setDriveFolderUrl(null)
    setErrorMessage(null)
    setUploadFailures(0)
    // Clear the progress refs too, so a subsequent sweep doesn't
    // inherit the previous batch's done/total counters.
    doneRef.current = 0
    totalRef.current = 0
    transition('idle')
  }, [transition])

  return {
    state,
    scannedFiles,
    selectedFiles,
    progress,
    uploadProgress,
    currentSession,
    driveFolderId,
    driveFolderUrl,
    errorMessage,
    uploadFailures,
    startScan,
    toggleFile,
    toggleAll,
    setSelection,
    removeFiles,
    startSweep,
    reset,
    /**
     * Abort an in-flight sweep, then clear local state. `reset` alone
     * only cleared the renderer. Main kept copying files and its
     * eventual `sweep:complete` put the overlay straight back, so the
     * button appeared to do nothing.
     */
    cancelSweep: async () => {
      try {
        await window.electronAPI.sweepCancel()
      } catch (err) {
        console.error('[useIngest] sweepCancel failed', err)
        toast.error('Could not terminate the ingest.')
      } finally {
        reset()
      }
    }
  }
}
