import { useState, useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { type IngestState, type ScannedFile } from '@/types'
import type { SweepDetail } from '@/lib/sweep-status'

/**
 * How long the renderer waits for `sweep:scan` before giving up on it.
 *
 * Longer than the 120s cap main puts on the scan itself, so main's own
 * error wins whenever there is one: it names the real problem, and this
 * one can only say that nothing came back.
 */
const SCAN_DEADLINE_MS = 135_000

export function useIngest() {
  const [state, setState] = useState<IngestState>('idle')
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState(0)
  /** What the copy is on, for the progress screen. */
  const [sweepDetail, setSweepDetail] = useState<SweepDetail | null>(null)
  /** Set when the copy finished and only the upload could not start. */
  const [errorKind, setErrorKind] = useState<'drive-disconnected' | null>(null)
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
  /** Files the sweep could not copy, added to the upload's failures at the end. */
  const copyFailuresRef = useRef(0)
  /** Which files, and why, for the end screen. Copy and upload failures both. */
  const failuresRef = useRef<{ file: string; error: string }[]>([])
  const [failureList, setFailureList] = useState<{ file: string; error: string }[]>([])

  // Mirror `state` in a ref so async actions (startScan / startSweep)
  // can read the *live* value without recreating the callback on every
  // transition. Recreating callbacks on every state change tears down
  // and rebuilds the App.tsx subscription effect that depends on them:
  // a known foot-gun for stale closures around in-flight IPC calls.
  /**
   * The path the live scan is walking.
   *
   * The scanning screen said only "Discovering media files", which is
   * true of every scan and so tells nobody anything. A card with a few
   * thousand files takes a while, and with nothing on screen naming
   * what it is working on, a slow scan and a hung one look identical.
   */
  const [scanningPath, setScanningPath] = useState<string | null>(null)

  /**
   * Whether the selection is still the one the scan made (every file not
   * yet on Drive), rather than one the user made. Selected-for-import is
   * not chosen-for-trash: while it is the scan's, the Local Archive offers
   * no Trash, so its toolbar no longer opens on "Trash 678".
   */
  const [selectionIsPreset, setSelectionIsPreset] = useState(true)

  /**
   * The folder or card the review on screen came from, and so the only
   * thing a sweep may copy.
   *
   * The sweep used to take its source from the caller, which passed
   * "the imported folder, else the first card". With two cards in, the
   * review showed the second card and the sweep copied the first, then
   * said the files were staged: format the card you had just reviewed
   * and its photographs were gone. The source now travels with the
   * review instead of being worked out again at the moment of copying.
   */
  const [reviewPath, setReviewPath] = useState<string | null>(null)
  const reviewPathRef = useRef<string | null>(null)
  const setReviewSource = useCallback((p: string | null) => {
    reviewPathRef.current = p
    setReviewPath(p)
  }, [])

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

    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      // No toast here. The next line hands the whole content area over
      // to a spinner reading "Scanning files… / Discovering media
      // files", so a toast saying the same thing arrives in the same
      // frame as the screen that already says it.
      //
      // A toast is for something you would otherwise miss. This is the
      // opposite: it is the only thing on screen.
      setScanningPath(path)
      transition('scanning')
      console.log('[useIngest] sweepScan invoke →', path)

      // A deadline, because `scanning` is otherwise terminal: the guard
      // at the top of this function refuses every later attempt while
      // it is the live state, so an invoke that never settles leaves
      // the library spinning with no way back, and the only recovery is
      // relaunching the app.
      //
      // Main caps the scan itself and rejects with its own message, so
      // in the normal slow-card case that error arrives first and says
      // something specific. This one is for no answer arriving at all:
      // a renderer reloaded out from under the invoke, a handler that
      // resolved into a window that no longer exists.
      const files = await Promise.race([
        window.electronAPI.sweepScan(path),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error('The scan never reported back. Try again.')),
            SCAN_DEADLINE_MS,
          )
        }),
      ])
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
        setReviewSource(null)
        transition('idle')
        return
      }
      setReviewSource(path)
      setScannedFiles(files)
      // Only select files that are neither on Drive nor already in the archive
      setSelectedFiles(new Set(files.filter(f => !f.isUploaded && !f.isCopied && !f.damage).map(f => f.relativePath)))
      setSelectionIsPreset(true)
      console.log('[useIngest] transition → review')
      transition('review')
    } catch (err) {
      console.error('[useIngest] startScan threw', err)
      setErrorMessage(err instanceof Error ? err.message : 'Scan failed')
      transition('error')
    } finally {
      if (deadline !== undefined) clearTimeout(deadline)
      setScanningPath(null)
    }
  }, [transition, setReviewSource])

  const toggleFile = useCallback((relativePath: string) => {
    setSelectionIsPreset(false)
    setSelectedFiles(prev => {
      const next = new Set(prev)
      if (next.has(relativePath)) next.delete(relativePath)
      else next.add(relativePath)
      return next
    })
  }, [])

  const setSelection = useCallback((paths: string[]) => {
    setSelectedFiles(new Set(paths))
    setSelectionIsPreset(false)
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

  const startSweep = useCallback(async (customFolder?: string) => {
    const sourcePath = reviewPathRef.current
    if (stateRef.current !== 'review' || !sourcePath) return

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
      setSweepDetail(prev => ({
        file: p.file, current: p.current, total: p.total, bytesPerSecond: p.bytesPerSecond,
        startedAt: prev?.startedAt ?? Date.now(),
        at: Date.now(),
      }))
    })

    const unsubComplete = window.electronAPI.onSweepComplete((s) => {
      setCurrentSession(s.sessionId)
      // Files that never reached the archive never reach Drive either, so
      // they count with the upload's failures on the end screen.
      copyFailuresRef.current = s.errors?.length ?? 0
      failuresRef.current = [...(s.errors ?? [])]
      // A cancelled sweep still emits `sweep:complete`. Re-entering
      // `sweeping` here is what made "Terminate Protocol" look dead.
      // The overlay came straight back. Land on `idle` instead.
      if (s?.status === 'cancelled') {
        // What the stop left behind: files already copied stay in the
        // archive, and nothing said so.
        toast(s.processedFiles > 0
          ? `Import stopped. ${s.processedFiles.toLocaleString()} of ${s.totalFiles.toLocaleString()} files were already in your archive and stay there.`
          : 'Import stopped before anything was copied.')
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
      setErrorKind(e.kind ?? null)
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

    const unsubUploadError = window.electronAPI.onUploadError((e) => {
      failuresRef.current = [...failuresRef.current, e]
    })

    const unsubUploadComplete = window.electronAPI.onUploadComplete((s) => {
      setFailureList(failuresRef.current)
      setDriveFolderId(s.driveFolderId)
      setDriveFolderUrl(s.driveFolderUrl)
      setUploadFailures((s.failedFiles ?? 0) + copyFailuresRef.current)
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
      unsubUploadError()
      unsubUploadComplete()
    }
  }, [transition])

  const reset = useCallback(() => {
    setScannedFiles([])
    setSelectedFiles(new Set())
    setProgress(0)
    setSweepDetail(null)
    setErrorKind(null)
    setUploadProgress(0)
    setDriveFolderId(null)
    setDriveFolderUrl(null)
    setErrorMessage(null)
    setUploadFailures(0)
    failuresRef.current = []
    setFailureList([])
    // Clear the progress refs too, so a subsequent sweep doesn't
    // inherit the previous batch's done/total counters.
    doneRef.current = 0
    totalRef.current = 0
    setReviewSource(null)
    transition('idle')
  }, [transition, setReviewSource])

  return {
    state,
    scanningPath,
    reviewPath,
    selectionIsPreset,
    scannedFiles,
    selectedFiles,
    progress,
    sweepDetail,
    errorKind,
    uploadProgress,
    currentSession,
    driveFolderId,
    driveFolderUrl,
    errorMessage,
    uploadFailures,
    failureList,
    startScan,
    toggleFile,
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
