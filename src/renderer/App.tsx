import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, RefreshCw, FolderTree, FileImage, AlertTriangle, Share2 } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { EmptyState } from './components/EmptyState'
import { ReviewView } from './components/ReviewView'
import { SettingsPanel } from './components/SettingsPanel'
import { CoffeeInvite } from './components/CoffeeInvite'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { ShareModal } from './components/ShareModal'
import { Distiller } from './components/Distiller'
import { EditorView, type EditorFile } from './editor/EditorView'
import { TerminalPanel } from './components/TerminalPanel'
import { useIngest } from './hooks/useIngest'
import { WindowControls } from './components/WindowControls'
import { AppToaster } from './components/ui/app-toaster'
import { toast } from 'sonner'
import { type VolumeInfo, type AuthStatus, type TabId } from '@/types'
import { Button } from '@/components/ui/button'
import { SPRING_STANDARD } from '@/lib/motion'

/**
 * The application shell.
 *
 * Owns three things and delegates everything else: which tab is showing,
 * which modal is up, and the connection state the tabs need in order to
 * render at all. The two libraries it switches between are ReviewView
 * (Local Archive) and Distiller (Workstation); see README for why the
 * interface names and the file names differ.
 *
 * Ingest is not owned here. It lives in useIngest, which holds the state
 * machine, so this file never has to reason about what happens between
 * "card inserted" and "files staged".
 */
export default function App() {
  // ── Ingest ──
  const {
    state: sweepState,
    scanningPath,
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
    toggleAll,
    setSelection,
    removeFiles,
    startSweep,
    reset: resetIngest,
    cancelSweep,
  } = useIngest()

  // ── Shell state ──
  const [activeTab, setActiveTab ] = useState<TabId>('library-ingest')
  const [volumes, setVolumes] = useState<VolumeInfo[]>([])
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  /**
   * Which modal is up, if any.
   *
   * One field rather than a boolean each, so two cannot be open at
   * once, which is not a hypothetical: the keyboard sheet was opened
   * from inside Settings and rendered behind it. Closing the sheet
   * returns to Settings, because that is where it was opened from and
   * dropping the user all the way out would lose their place.
   */
  const [modal, setModal] = useState<'settings' | 'shortcuts' | null>(null)
  const showSettings = modal === 'settings'
  const setShowSettings = (open: boolean) => setModal(open ? 'settings' : null)
  const [showShare, setShowShare] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const [editorFile, setEditorFile] = useState<EditorFile | null>(null)
  const [showDesignSandbox, setShowDesignSandbox] = useState(false)

  // Lazy-loaded so the sandbox never ships weight to production-mode
  // users who don't press the hidden shortcut.
  const [DesignSandbox, setDesignSandbox] = useState<React.ComponentType | null>(null)
  useEffect(() => {
    if (showDesignSandbox && !DesignSandbox) {
      import('./components/_design-sandbox/primitives').then(m => setDesignSandbox(() => m.DesignSandbox))
    }
  }, [showDesignSandbox, DesignSandbox])

  useEffect(() => {
    if (!editorFile) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditorFile(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editorFile])

  // Hidden design-system sandbox. Ctrl/Cmd + Shift + D. The sandbox
  // is the in-app equivalent of Storybook; keeps design work inside
  // the running renderer where tokens, primitives, and state treatments
  // can be verified against live app conditions (DPR, font rendering,
  // theme) instead of a separate harness. Esc dismisses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        setShowDesignSandbox(v => !v)
      } else if (e.key === 'Escape' && showDesignSandbox) {
        setShowDesignSandbox(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showDesignSandbox])

  // ── Infrastructure Synchronization ──
  useEffect(() => {
    const loadInitial = async () => {
      const v = await window.electronAPI.volumeList()
      setVolumes(v)
      const s = await window.electronAPI.authStatus()
      setAuthStatus(s)
    }
    loadInitial()

    const unsubDetected = window.electronAPI.onVolumeDetected((vol) => {
      setVolumes(prev => [...prev, vol])
      const label = vol.label || 'Removable drive'
      // Says what happens next, not just what happened. A card appearing
      // is only interesting because of the scan it starts, and when a
      // sweep is already running it deliberately does not start one,
      // which is worth saying rather than leaving the user waiting.
      const willScan = sweepState === 'idle'
      if (willScan) {
        toast.success(`${label} mounted: scanning`)
        startScan(vol.path)
      } else {
        toast(`${label} mounted`, { description: 'Scan already in progress.' })
      }
    })

    const unsubRemoved = window.electronAPI.onVolumeRemoved((vol) => {
      setVolumes(prev => prev.filter(v => v.path !== vol.path))
    })

    const unsubAuth = window.electronAPI.onAuthStatus((s) => {
      setAuthStatus(s)
    })

    // Without this the Account button was a silent no-op whenever
    // `connect()` bailed before opening the browser. Most commonly
    // when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing.
    const unsubAuthError = window.electronAPI.onAuthError((e) => {
      toast.error(e.message)
    })

    return () => {
      unsubDetected()
      unsubRemoved()
      unsubAuth()
      unsubAuthError()
    }
  }, [sweepState, startScan])

  // ── Actions ──
  const handleConnectCloud = async () => {
    await window.electronAPI.authConnect()
  }

  const handleManualScan = async () => {
    if (volumes.length > 0) await startScan(volumes[0].path)
  }

  const [importPath, setImportPath] = useState<string | null>(null)

  const reset = useCallback(() => {
    resetIngest()
    setImportPath(null)
  }, [resetIngest])

  /** "Terminate Protocol": abort the sweep in main, then clear the UI. */
  const handleTerminate = useCallback(async () => {
    await cancelSweep()
    setImportPath(null)
  }, [cancelSweep])

  const handleImportFolder = async () => {
    const folderPath = await window.electronAPI.openFolderDialog()
    if (!folderPath) return
    setImportPath(folderPath)
    startScan(folderPath)
  }

  // Direct edit of a local image. Bypasses Drive ingest entirely.
  // The picked file opens in the editor with `localPath` set; export
  // is forced to the save-to-disk path since there's no Drive identity.
  const handleOpenLocalFile = async () => {
    try {
      const picked = await window.electronAPI.openImageDialog()
      if (!picked) return
      setEditorFile({
        id: `local:${picked.path}`,
        name: picked.name,
        modifiedTime: picked.modifiedTime,
        localPath: picked.path,
      })
    } catch (err) {
      // Most commonly hit during dev when the main process hasn't been
      // restarted after the IPC handler was added. Surface the error
      // rather than letting the click be a silent no-op.
      console.error('[open-local-file] failed:', err)
    }
  }

  const handleBeginIngest = async () => {
    const sourcePath = importPath || volumes[0]?.path
    if (!sourcePath) return
    await startSweep(sourcePath)
  }

  // Once, on the first card seen. The ref is what makes it once; the
  // dependency list only decides when the question gets asked again, so
  // it names everything the body reads. `volumes.length` alone would
  // have scanned a stale path if the array changed without changing
  // length.
  const hasAutoScanned = useRef(false)
  useEffect(() => {
    if (volumes.length > 0 && sweepState === 'idle' && !hasAutoScanned.current) {
      hasAutoScanned.current = true
      startScan(volumes[0].path)
    }
  }, [volumes, sweepState, startScan])

  const handleRebuildLedger = async () => {
    await window.electronAPI.authRebuildLedger()
  }
 
  const handleShare = useCallback(async () => {
    if (!driveFolderId) return
    setSharing(true)
    try {
      await window.electronAPI.driveSetPublic(driveFolderId)
      setShowShare(true)
    } finally {
      setSharing(false)
    }
  }, [driveFolderId])

  const getTabLabel = (id: TabId) => {
    switch(id) {
       case 'library-ingest': return 'Local Archive'
       case 'organize': return 'Workstation'
       default: return id
    }
  }

  return (
    <div className="flex h-screen bg-surface-panel overflow-hidden text-text-default antialiased font-sans">
      {/* The window's own controls. Rendered here rather than inside the
          header so no overlay can cover them: see WindowControls. */}
      <WindowControls />
      {showDesignSandbox && DesignSandbox && (
        <div className="fixed inset-0 z-[999] bg-surface-workspace overflow-auto">
          <DesignSandbox />
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        {/* Workstation Sidebar (Left Explorer) */}
        <Sidebar 
          activeTab={activeTab} 
          onTabChange={setActiveTab}
          volumes={volumes}
          authStatus={authStatus}
          onConnectCloud={handleConnectCloud}
          onRebuildLedger={handleRebuildLedger}
          onOpenSettings={() => setShowSettings(true)}
        />

        <main className="flex-1 flex flex-row overflow-hidden bg-surface-workspace">
          {/* Main Workbench (Center Column) */}
          <div className="flex-1 flex flex-col overflow-hidden relative border-r border-border-strong shadow-inner">
            {/* The workbench header, and, with the sidebar header
                beside it: the window's title bar. `app-drag` is what
                makes the window movable at all now that the OS caption
                is hidden; everything clickable inside it has to opt back
                out with `app-no-drag`, or the window manager takes the
                gesture and the control never sees the click. */}
            <header className="app-drag h-12 flex items-center justify-between bg-surface-panel border-b border-border-subtle px-4 shrink-0 transition-all duration-300">
               {/* Left: View Title (Lightroom style) */}
               <div className="flex items-center gap-4">
                  <span className="text-body font-medium text-text-disabled uppercase tracking-widest">{getTabLabel(activeTab)}</span>
               </div>

               {/* Right: the row's own controls, then the corner the
                   window's three caption buttons occupy.

                   The reserve is INSIDE this group on purpose. As a
                   third child of a `justify-between` header it became
                   the third position and pushed Open File into the
                   middle of the row. Here the group is [button][reserve]
                   and lands as one block at the right, which puts Open
                   File immediately left of minimise, where it belongs.

                   It is also what keeps those buttons clickable. A drag
                   region only yields to `no-drag` reliably inside its
                   own subtree, and WindowControls is a fixed overlay,
                   a sibling of this header rather than a child, so its
                   own carve-out never reached. This group is no-drag and
                   its box now covers the corner, which does.

                   `-mr-4` cancels the header's `px-4`: measured, a
                   reserve that stops at the padding edge lands 17px
                   short and leaves the close button inside the drag
                   region. Coupled to that padding on purpose; change one
                   and the other has to follow. */}
               <div className="app-no-drag flex items-center gap-0.5">
                 <Button
                   size="sm"
                   variant="neutral"
                   onClick={handleOpenLocalFile}
                   className="h-7 gap-space-2 text-caption"
                   title="Open a local image for editing (bypasses Drive)"
                 >
                   <FileImage size={12} />
                   Open File…
                 </Button>
                 <div
                   // `app-no-drag` on the spacer itself, not just on the
                   // group: the negative margin lets this child overflow
                   // the header's padding, but a parent's box does not
                   // grow to include an overflowing child, so the group
                   // alone stopped 16px short of the corner. Measured.
                   className="app-no-drag w-caption h-full shrink-0 -mr-4"
                   aria-hidden
                 />
               </div>

            </header>

             {/* Dynamic Content Area */}
             <div className="flex-1 flex flex-col overflow-hidden relative">
                <AnimatePresence mode="wait">
                   {activeTab === 'library-ingest' || activeTab === 'local' ? (
                      sweepState === 'scanning' ? (
                        <motion.div key="scanning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                          <RefreshCw className="w-6 h-6 text-text-muted animate-spin mb-6" />
                          <h2 className="text-heading font-medium text-text-emphatic mb-1">Scanning files…</h2>
                          {/* Naming the volume is the difference between
                              a slow scan and an apparently hung one. A
                              card with a few thousand files takes real
                              time, and "Discovering media files" alone
                              is true of every scan, so it reassures
                              nobody that anything is happening. */}
                          <p className="text-body text-text-muted">
                            {scanningPath
                              ? <>Reading <span className="font-mono text-text-default">{scanningPath}</span></>
                              : 'Discovering media files'}
                          </p>
                        </motion.div>
                      ) : sweepState === 'review' ? (
                        <ReviewView
                          key="review"
                          scannedFiles={scannedFiles}
                          selectedFiles={selectedFiles}
                          onToggleAll={toggleAll}
                          onSetSelection={setSelection}
                          onRemoveFiles={removeFiles}
                          onCancel={reset}
                          onBeginIngest={handleBeginIngest}
                        />
                      ) : sweepState === 'sweeping' ? (
                        <motion.div key="sweeping" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center p-12">
                          <div className="w-64 h-1 bg-border-subtle rounded-none mb-6 overflow-hidden shadow-inner">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${(progress * 0.3) + (uploadProgress * 0.7)}%` }}
                              className="h-full bg-accent-primary rounded-none"
                            />
                          </div>
                          <h2 className="text-heading font-medium text-text-emphatic mb-1.5 tracking-tight">
                            Importing Media...
                          </h2>
                          <p className="text-body text-text-muted">
                            {uploadProgress > 0
                              ? `Syncing to Drive (${Math.round(uploadProgress)}%)`
                              : `Optimizing local staging (${Math.round(progress)}%)`
                            }
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleTerminate}
                            className="mt-8 text-caption font-bold uppercase text-text-disabled hover:text-status-danger"
                          >
                            Terminate Protocol
                          </Button>
                        </motion.div>
                      ) : sweepState === 'error' ? (
                        <motion.div
                          key="error"
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 1.05 }}
                          className="flex-1 flex flex-col items-center justify-center p-12 text-center"
                        >
                          <AlertTriangle size={32} className="text-status-warn mb-8" />
                          <h2 className="text-heading font-medium text-text-emphatic mb-1.5 tracking-tight">
                            Ingest paused
                          </h2>
                          <p className="text-body text-text-muted mb-10 max-w-md mx-auto">
                            {errorMessage ?? 'Something went wrong during ingest.'}
                          </p>
                          <div className="flex items-center gap-3">
                            <Button variant="neutral" size="sm" onClick={reset} className="gap-2 font-bold">
                              <RefreshCw size={12} />
                              Reset
                            </Button>
                            <Button variant="primary" size="sm" onClick={handleConnectCloud} className="gap-2 font-bold">
                              Reconnect Drive
                            </Button>
                          </div>
                        </motion.div>
                      ) : sweepState === 'complete' ? (
                        <motion.div 
                          key="complete" 
                          initial={{ opacity: 0, scale: 0.95 }} 
                          animate={{ opacity: 1, scale: 1 }} 
                          exit={{ opacity: 0, scale: 1.05 }} 
                          className="flex-1 flex flex-col items-center justify-center p-12 text-center"
                        >
                          <motion.div
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.1, ...SPRING_STANDARD }}
                          >
                             {uploadFailures > 0
                               ? <AlertTriangle size={32} className="text-status-warn mb-8" />
                               : <CheckCircle2 size={32} className="text-status-success mb-8" />}
                          </motion.div>

                          <motion.h2
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.2, ...SPRING_STANDARD }}
                            className="text-heading font-medium text-text-emphatic mb-1 tracking-tight"
                          >
                             {uploadFailures > 0 ? 'INGEST INCOMPLETE' : 'INGEST COMPLETE'}
                          </motion.h2>

                          <motion.p
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.3, ...SPRING_STANDARD }}
                            className="text-body text-text-muted mb-10 max-w-xs mx-auto font-mono uppercase tracking-widest"
                          >
                             {uploadFailures > 0
                               ? `${uploadFailures} file${uploadFailures === 1 ? '' : 's'} did not reach Drive. Keep the card until they have.`
                               : 'Media Assets Indexed Successfully'}
                          </motion.p>

                          <motion.div
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.4, ...SPRING_STANDARD }}
                            className="flex items-center gap-3"
                          >
                             <Button variant="neutral" size="sm" onClick={reset} className="gap-2 font-bold">
                               <RefreshCw size={12} />
                               Finish & Reset
                             </Button>
                             {driveFolderId && (
                               <Button
                                 variant="neutral"
                                 size="sm"
                                 onClick={handleShare}
                                 disabled={sharing}
                                 className="gap-2 font-bold"
                                 title="Make this folder link-shareable and show the link"
                               >
                                 <Share2 size={12} />
                                 {sharing ? 'Sharing…' : 'Share'}
                               </Button>
                             )}
                             <Button variant="primary" size="sm" onClick={() => setActiveTab('organize')} className="gap-2 font-bold">
                               <FolderTree size={12} />
                               Go to Workstation
                             </Button>
                          </motion.div>
                        </motion.div>
                      ) : (
                        <EmptyState key="empty" hasVolumes={volumes.length > 0} isScanning={false} onScan={handleManualScan} onImportFolder={handleImportFolder} />
                      )
                   ) : activeTab === 'organize' ? (
                      <Distiller key="distiller" onOpenEditor={setEditorFile} />
                   ) : activeTab === 'settings' ? (
                      <div className="flex-1 flex items-center justify-center text-text-disabled text-body font-mono italic">Configuration Terminal Active...</div>
                   ) : (
                      <div className="flex-1 flex items-center justify-center text-text-muted text-body font-mono">{getTabLabel(activeTab)} Module - In Development</div>
                   )}
                </AnimatePresence>

                <AnimatePresence>
                  {editorFile && <EditorView key="editor" file={editorFile} onExit={() => setEditorFile(null)} />}
                </AnimatePresence>

                {/* The app's only toast surface. See app-toaster.tsx for
                    why there is exactly one.

                    The offset tracks the terminal so a toast lands on its
                    top edge rather than over it: the terminal is a
                    sibling in the layout, but the toaster is fixed to the
                    viewport and cannot see it. */}
                <AppToaster
                  bottomOffset={showTerminal ? 'var(--spacing-terminal)' : 'var(--spacing-terminal-bar)'}
                />
             </div>

             {/* Output Terminal (VS Code style bottom panel) */}
             <TerminalPanel isOpen={showTerminal} onToggle={() => setShowTerminal(prev => !prev)} />
          </div>
        </main>
      </div>

      {/* Asks once per install, a few seconds after launch, and then
          never again. Outside AnimatePresence because it owns its own
          open state and is not one of the mutually exclusive shell
          modals; it should not be able to displace Settings or be
          displaced by it. */}
      <CoffeeInvite />

      {/* Global Overlays */}
      <AnimatePresence>
        {showSettings && (
          <SettingsPanel
            onClose={() => setModal(null)}
            onShowShortcuts={() => setModal('shortcuts')}
          />
        )}
        {modal === 'shortcuts' && (
          <KeyboardShortcuts
            open
            onOpenChange={(next) => setModal(next ? 'shortcuts' : 'settings')}
          />
        )}
        {showShare && driveFolderUrl && (
          <ShareModal 
            isOpen={showShare} 
            onClose={() => setShowShare(false)} 
            folderUrl={driveFolderUrl} 
            folderName={currentSession || 'Active Shoot'} 
          />
        )}
      </AnimatePresence>
    </div>
  )
}
