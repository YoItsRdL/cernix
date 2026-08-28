/**
 * Workstation: the library over the user's Google Drive, where already
 * imported work is browsed, rated and organised. Named `Distiller` in
 * the source and "Workstation" in the interface; the mapping is in
 * README.
 *
 * This file is only the composition root. The parts live in
 * `distiller/`: `useDistiller` holds every piece of state and every
 * action, and the six child components are given exactly what they
 * render. Splitting it that way is what lets the selection model, the
 * paging and the grid sizing be shared outright with Local Archive
 * (`ReviewView.tsx`) rather than reimplemented, which is how the two
 * surfaces drifted apart the first time.
 */
import React, { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useDistiller } from './distiller/hooks/useDistiller'
import { DistillerSidebar } from './distiller/components/DistillerSidebar'
import { DistillerHeader } from './distiller/components/DistillerHeader'
import { DistillerViewport } from './distiller/components/DistillerViewport'
import { DistillerInspector } from './distiller/components/DistillerInspector'
import { DistillerLightbox } from './distiller/components/DistillerLightbox'
import { DistillerContextMenu } from './distiller/components/DistillerContextMenu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface DistillerProps {
  onOpenEditor?: (file: { id: string; name: string; modifiedTime: string; thumbnailLink?: string }) => void
}

/** Workstation: the Drive-backed library. Composition root; the parts
 *  are in distiller/. */
export function Distiller({ onOpenEditor }: DistillerProps) {
  const { state, actions, setters, refs } = useDistiller(onOpenEditor)

  // Close context menu on external click
  useEffect(() => {
    const close = () => setters.setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [setters])

  const viewportActions = React.useMemo(() => ({
    ...actions,
    ...setters,
    onSetStars: actions.handleSetStars,
    onSetFlag: actions.handleSetFlag
  }), [actions, setters])

  return (
    <div className="flex h-full bg-surface-workspace text-text-emphatic select-none overflow-hidden font-sans">
      <DistillerSidebar
        folders={state.folders}
        loading={state.loading}
        currentFolderId={state.currentFolderId}
        rootFolderId={state.rootFolderId}
        actions={actions}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-surface-workspace relative">
        <DistillerHeader
          breadcrumbs={state.breadcrumbs}
          selectedCount={state.selected.size}
          viewMode={state.viewMode}
          columnOverride={state.columnOverride}
          autoMaxColumns={state.autoMaxColumns}
          defaultColumns={state.defaultColumns}
          draggingIds={state.draggingIds}
          pendingMove={state.pendingMove}
          starsFilter={state.starsFilter}
          loading={state.loading}
          showInspector={state.showInspector}
          actions={{
            ...actions,
            ...setters,
            handleDownloadBatch: () => {
              const items = state.files.filter(f => state.selected.has(f.id)).map(f => ({ id: f.id, name: f.name }))
              actions.handleDownloadBatch(items)
            },
            handleTrashBatch: () => {
              actions.handleTrashBatch(Array.from(state.selected))
            },
            refresh: () => state.currentFolderId && actions.loadContents(state.currentFolderId)
          }}
        />

        {/* Move mode is a mode, and an unannounced mode is a trap: clicks
            stop doing what they did a second ago. This says what is being
            carried, what to do next, and how to get out. */}
        {state.pendingMove && (
          <div className="h-9 shrink-0 flex items-center justify-between gap-space-3 px-space-4 bg-secondary text-secondary-foreground">
            <span className="text-caption font-medium truncate">
              Moving {state.pendingMove.length} item{state.pendingMove.length === 1 ? '' : 's'}: pick a folder or a breadcrumb
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={actions.cancelMove}
              className="h-6 px-2 shrink-0 text-caption text-secondary-foreground hover:bg-overlay-strong hover:text-secondary-foreground"
            >
              Cancel (Esc)
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-hidden relative">
          <DistillerViewport
            items={state.focusFiles ?? [...state.folders, ...state.visibleFiles]}
            // The folder, or the focus set when one is open. Either way,
            // a different list of pictures than the one before it.
            loading={state.loading}
            listId={state.focusFiles ? 'focus' : state.currentFolderId ?? 'root'}
            viewMode={state.viewMode}
            selected={state.selected}
            focusedId={state.focusedId}
            ratings={state.ratings}
            columnOverride={state.columnOverride}
            autoMaxColumns={state.autoMaxColumns}
            defaultColumns={state.defaultColumns}
            draggingIds={state.draggingIds}
            pendingMove={state.pendingMove}
            renaming={state.renaming}
            renameValue={state.renameValue}
            actions={viewportActions}
          />
        </div>
      </main>

      {state.showInspector && (
        <div className="hidden lg:block h-full border-l border-border-subtle bg-surface-panel/40 backdrop-blur-3xl shrink-0 overflow-hidden">
          <DistillerInspector
          focusedId={state.focusedId}
          selected={state.selected}
          files={state.files}
          folders={state.folders}
          focusFiles={state.focusFiles}
          renaming={state.renaming}
          renameValue={state.renameValue}
          actions={{
            ...actions,
            ...setters
          }}
        />
        </div>
      )}

      {/* Overlays */}
      <DistillerLightbox
        lightboxId={state.lightboxId}
        items={state.focusFiles ?? state.visibleFiles}
        ratings={state.ratings}
        selected={state.selected}
        actions={{
          ...actions,
          setLightboxId: setters.setLightboxId,
          handleSetStars: actions.handleSetStars,
          handleSetFlag: actions.handleSetFlag,
          onOpenEditor
        }}
      />

      <DistillerContextMenu
        menu={state.contextMenu}
        actions={{
          ...actions,
          ...setters,
          onClose: () => setters.setContextMenu(null)
        }}
        moveIdsFor={(id) => (state.selected.has(id) ? [...state.selected] : [id])}
        getItemName={(id) => {
          const item = state.files.find(f => f.id === id) || state.folders.find(f => f.id === id)
          return item?.name || ''
        }}
        getItemIsVideo={(id) => {
          const file = state.files.find(f => f.id === id)
          return file?.mimeType?.startsWith('video/') ?? false
        }}
      />

      <AnimatePresence>
        {state.creatingFolder && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-scrim backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm bg-surface-panel border border-border-strong shadow-2xl p-space-6"
            >
              <h3 className="text-caption font-bold text-text-muted uppercase tracking-widest mb-space-4">Create New Folder</h3>
              <Input
                autoFocus
                /* eslint-disable-next-line react-hooks/refs -- passing a ref
                   object to `ref` is what a ref object is for; nothing here
                   reads `.current` */
                ref={refs.newFolderInputRef}
                value={state.newFolderName}
                onChange={e => setters.setNewFolderName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') actions.handleCreateFolder()
                  if (e.key === 'Escape') setters.setCreatingFolder(false)
                }}
                placeholder="Folder name..."
                className="mb-space-6"
              />
              <div className="flex justify-end gap-space-3">
                <Button variant="ghost" size="sm" onClick={() => setters.setCreatingFolder(false)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={actions.handleCreateFolder}>Create Folder</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* No Toaster here. Distiller renders inside App, which mounts
          one; a second live Toaster made every toast render twice. */}
    </div>
  )
}
