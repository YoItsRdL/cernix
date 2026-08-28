import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Search, X, Pencil, Trash2, Plus, Download } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { Preset, EditParams } from '@/types'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { ThumbnailPipeline, hashSourceBitmap } from '../pipeline/thumbnail-pipeline'
import { applyPresetOverCurrent } from '@/../shared/edit-params'
import { importLightroomXmp } from '../lightroom/import'

interface PresetGridProps {
  /** Read live params on demand so the grid doesn't re-render per slider tick. */
  getCurrentParams: () => EditParams
  onApply: (params: EditParams) => void
  /** Called as the user hovers a preset card so the parent can install
   *  a compareOverride and the main viewport renders the preset live.
   *  Pass `null` on leave / close to clear the override. */
  onHoverPreview: (params: EditParams | null) => void
  /** Close affordance: the parent owns the visibility state so the
   *  grid can be opened from a header button and dismissed via
   *  outside-click / Esc / explicit X. */
  onClose: () => void
 /** Source bitmap for thumbnail rendering. When null,
   *  the grid falls back to the closed-form colourway swatch. */
  getSourceBitmap?: () => ImageBitmap | null
  /** Ref to the trigger button. The outside-click handler ignores
   *  mousedowns on the trigger so a second click on it can close
   *  the grid via the parent's toggle. Without it, mousedown
   *  outside-click closes first, then the button's onClick re-opens. */
  triggerRef?: React.RefObject<HTMLElement | null>
}

/**
   * Preset browser.
   *
   * Single entry point for every preset interaction. Apply, save,
   * import (Lightroom .xmp), rename, delete. The grid replaced the
   * earlier dropdown + grid pair: two header buttons doing nearly
   * the same thing was cognitive load that didn't pay back.
   *
   * Each card carries a WebGL-rendered thumbnail of the current photo
   * with that preset applied, with the closed-form
   * colourway swatch as the loading-state fallback. Hover installs a
   * `compareOverride` so the main viewport renders the preset live
   * at full res. That's the truth-on-my-photo path; the thumbnail
   * is the scannable grid affordance.
   *
   * The footer carries the Save / Import CTAs the dropdown used to
   * own.
   */
export function PresetGrid({ getCurrentParams, onApply, onHoverPreview, onClose, getSourceBitmap, triggerRef }: PresetGridProps) {
  const [presets, setPresets] = useState<Preset[]>([])
  const [search, setSearch] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  // Save flow. When `savingName` is non-null the footer swaps to a
  // name input and a Save button; `null` = the default Save / Import
  // row.
  const [savingName, setSavingName] = useState<string | null>(null)
  const [saveInputValue, setSaveInputValue] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  // Thumbnail rendering. One ThumbnailPipeline instance
  // per grid open, reused across every preset render. Disposed on
  // unmount so the GL context doesn't leak. Per-preset thumb URLs
  // are stored as object URLs in a Map; revoked on close.
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  const pipelineRef = useRef<ThumbnailPipeline | null>(null)
  const sourceHashRef = useRef<string | null>(null)
  const objectUrlsRef = useRef<string[]>([])
  // Stash the source-bitmap getter in a ref so the rendering effect
  // can depend only on `presets`. Without this, every parent re-render
  // creates a new arrow-function identity for `getSourceBitmap`,
  // causing the effect to cancel + restart and (worse) wiping the
  // already-painted thumbs back to skeletons on every keystroke.
  const getSourceBitmapRef = useRef(getSourceBitmap)
  const getCurrentParamsRef = useRef(getCurrentParams)
  // Synced in a layout effect rather than during the render: both are
  // read inside the thumbnail effect below, which runs after this one
  // commits, so it still sees the current callbacks.
  useLayoutEffect(() => {
    getSourceBitmapRef.current = getSourceBitmap
    getCurrentParamsRef.current = getCurrentParams
  })

  useEffect(() => {
    window.electronAPI.presetList().then(setPresets).catch(() => {})
  }, [])

  // Render the per-preset thumbnails. Order:
  //   1. Hash the source bitmap (cheap. Sample 64×64 + SHA-1).
  //   2. For each preset, ask the disk cache. Hits paint instantly.
  //   3. Misses queue against the offscreen pipeline. Yields to the
  //      event loop between renders via `requestIdleCallback` so the
  //      main viewport stays responsive.
  // Cancelled cleanly on unmount: the pipeline disposes its GL
  // context, the object URLs revoke, the in-flight loop short-circuits
  // via the cancellation flag.
  useEffect(() => {
    if (presets.length === 0) return
    const bitmap = getSourceBitmapRef.current?.() ?? null
    if (!bitmap) return
    let cancelled = false
    void (async () => {
      const sourceHash = await hashSourceBitmap(bitmap)
      if (cancelled) return
      sourceHashRef.current = sourceHash
      // Lazy-construct the pipeline + upload the source once.
      if (!pipelineRef.current) {
        try {
          pipelineRef.current = new ThumbnailPipeline()
          pipelineRef.current.setSource(bitmap)
        } catch (err) {
          // GL context unavailable / shader failed. Surface so we
          // don't silently lose thumbnails to a config / driver issue.
           
          console.warn('[PresetGrid] thumbnail pipeline init failed', err)
          pipelineRef.current = null
          return
        }
      }
      // Merge into the previous thumbs map rather than replacing it:
      // re-runs (e.g. when the preset list grows) preserve already-
      // painted cards instead of flickering them back to skeletons.
      const reportThumb = (presetId: string, url: string) => {
        if (cancelled) return
        setThumbs(prev => {
          const next = new Map(prev)
          next.set(presetId, url)
          return next
        })
      }
      const current = getCurrentParamsRef.current()
      for (const preset of presets) {
        if (cancelled) return
        const cacheKey = String(preset.createdAt)
        // Cache hit?
        const cached = await window.electronAPI.presetThumbGet(sourceHash, preset.id, cacheKey)
        if (cancelled) return
        if (cached) {
          // Copy into a fresh ArrayBuffer-backed view so the Blob
          // constructor's strict DOM-types are happy (the IPC bytes
          // arrive backed by SharedArrayBuffer in some runtimes).
          const copy = new Uint8Array(cached.length)
          copy.set(cached)
          const url = URL.createObjectURL(new Blob([copy], { type: 'image/jpeg' }))
          objectUrlsRef.current.push(url)
          reportThumb(preset.id, url)
          continue
        }
        // Render with the preset merged over current. Matches what
        // applying it would actually produce. The `applyPresetOverCurrent`
        // helper already handles merging the colour-only recipe.
        const merged = applyPresetOverCurrent(preset.params, current)
        try {
          const blob = await pipelineRef.current!.render(merged)
          if (cancelled) return
          const bytes = new Uint8Array(await blob.arrayBuffer())
          await window.electronAPI.presetThumbPut(sourceHash, preset.id, cacheKey, bytes)
          if (cancelled) return
          const url = URL.createObjectURL(blob)
          objectUrlsRef.current.push(url)
          reportThumb(preset.id, url)
        } catch (err) {
          // One bad preset shouldn't block the rest. Leave the
          // skeleton up and keep going. Surface to console so a
          // systemic failure doesn't go silent.
           
          console.warn(`[PresetGrid] thumbnail render failed for preset ${preset.id}`, err)
        }
        // Yield between renders so the user can still scroll / hover.
        await new Promise(r => setTimeout(r, 0))
      }
    })()
    return () => {
      cancelled = true
    }
    // The source-bitmap + current-params getters live behind refs so
    // the parent's re-render-time function identity can't churn this
    // effect. Re-runs are gated to actual preset-list changes.
  }, [presets])

  // Cleanup on unmount: dispose the pipeline + revoke object URLs.
  useEffect(() => {
    const urls = objectUrlsRef.current
    return () => {
      pipelineRef.current?.dispose()
      pipelineRef.current = null
      for (const url of urls) URL.revokeObjectURL(url)
      objectUrlsRef.current = []
    }
  }, [])

  // Outside-click + Esc dismiss. We clear any in-flight hover preview
  // first so the viewport doesn't strand on a partially-applied
  // preset when the grid closes. The trigger button is also ignored:
  // mousedown bubbles to window before the button's click fires,
  // so without this guard the popover would close on mousedown then
  // re-open on click and look like the toggle was a no-op.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      if (triggerRef?.current?.contains(target)) return
      onHoverPreview(null)
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onHoverPreview(null)
        onClose()
      }
    }
    window.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
      // Belt-and-braces. If the parent unmounts us mid-hover, drop
      // the override so the viewport returns to truth.
      onHoverPreview(null)
    }
  }, [onClose, onHoverPreview, triggerRef])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return presets
    return presets.filter(p => p.name.toLowerCase().includes(q))
  }, [presets, search])

  const apply = (p: Preset) => {
    onHoverPreview(null)
    onApply(p.params)
    onClose()
    toast(`Applied preset: ${p.name}`, { duration: 3000 })
  }

  const remove = async (p: Preset, e: React.MouseEvent) => {
    e.stopPropagation()
    if (p.builtin) return
    await window.electronAPI.presetDelete(p.id)
    setPresets(prev => prev.filter(x => x.id !== p.id))
  }

  const beginRename = (p: Preset, e: React.MouseEvent) => {
    e.stopPropagation()
    if (p.builtin) return
    setRenaming({ id: p.id, name: p.name })
  }

  const commitRename = async () => {
    if (!renaming) return
    const trimmed = renaming.name.trim()
    if (!trimmed) { setRenaming(null); return }
    try {
      const updated = await window.electronAPI.presetRename(renaming.id, trimmed)
      if (updated) setPresets(prev => prev.map(p => p.id === updated.id ? updated : p))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed')
    }
    setRenaming(null)
  }

  // ── Save current as preset ──
  const beginSave = () => {
    setSavingName('')
    setSaveInputValue('')
  }

  const cancelSave = () => {
    setSavingName(null)
    setSaveInputValue('')
  }

  const commitSave = async () => {
    const name = saveInputValue.trim()
    if (!name) { cancelSave(); return }
    try {
      const created = await window.electronAPI.presetSave(name, getCurrentParams())
      setPresets(prev => [...prev, created])
      toast.success(`Preset saved: ${name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
    cancelSave()
  }

  // ── Import Lightroom preset ──
  // The XMP parser does the heavy lifting; the renderer-side path
  // merges the patch over current params via the existing onApply
  // write path so the import flows through XMP persistence + edit
  // history identically to a saved preset apply.
  const handleImportFile = async (file: File) => {
    try {
      const xml = await file.text()
      const { patch, unsupported, name } = importLightroomXmp(xml)
      const merged = { ...getCurrentParams(), ...patch }
      onApply(merged)
      onClose()
      const label = name || file.name.replace(/\.xmp$/i, '')
      if (unsupported.length === 0) {
        toast.success(`Imported Lightroom preset: ${label}`, { duration: 3500 })
      } else {
        toast(`Imported "${label}": ${unsupported.length} field${unsupported.length === 1 ? '' : 's'} unsupported`, {
          description: unsupported.slice(0, 4).join(' · ') + (unsupported.length > 4 ? ` · +${unsupported.length - 4} more` : ''),
          duration: 8000,
          action: {
            label: 'Copy list',
            onClick: () => navigator.clipboard.writeText(unsupported.join('\n')).catch(() => {}),
          },
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      toast.error(`Lightroom import failed: ${msg}`, { duration: 6000 })
    }
  }

  // Hover-preview wiring. Card-enter installs the override, card-
  // leave clears it. Cross-card transitions can fire leave-after-
  // enter in rare interleaves, but the next mouseEnter immediately
  // restores a valid override so the misorder is at most a single-
  // frame stale view, not worth the per-render ref tracking.
  const onCardEnter = (p: Preset) => onHoverPreview(p.params)
  const onCardLeave = () => onHoverPreview(null)

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-full mt-space-1 w-96 max-h-dropdown-lg bg-surface-raised border border-border-strong rounded-soft shadow-xl z-[60] overflow-hidden flex flex-col"
    >
      {/* Header: search + close. The X is the only chrome the user
          needs; outside-click + Esc both also dismiss. */}
      <div className="flex items-center gap-space-2 px-space-3 py-space-2 border-b border-border-subtle bg-surface-panel shrink-0">
        <Search size={12} className="text-text-muted shrink-0" />
        {/* design-allow: bare-flush search field, not a form input, the
            shadcn Input ships with h-9 + bg-surface-panel + border that
            don't fit this inline-toolbar context. */}
        {/* eslint-disable-next-line no-restricted-syntax -- see design-allow above */}
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search presets…"
          className="flex-1 bg-transparent border-none outline-none text-body text-text-emphatic placeholder:text-text-muted"
        />
        {search && (
          <IconButton
            icon={<X size={12} />}
            aria-label="Clear search"
            onClick={() => setSearch('')}
            className="w-6 h-6 p-0 bg-transparent hover:bg-transparent text-text-muted hover:text-text-emphatic"
          />
        )}
        <span className="text-metadata text-text-muted font-mono">
          {filtered.length} / {presets.length}
        </span>
      </div>

      {/* Grid */}
      {/* min-h-0 is load-bearing: flex items default to
          `min-height: auto` (= content height), which prevents the
          scroll child from shrinking and pushes the footer below
          the popover's max-height clip. */}
      <div className="flex-1 min-h-0 overflow-y-auto p-space-2">
        {presets.length === 0 ? (
          <div className="px-space-3 py-space-4 text-metadata text-text-muted font-mono text-center">
            No presets yet. Save the current edit from the dropdown to get started.
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-space-3 py-space-4 text-metadata text-text-muted font-mono text-center">
            No presets match “{search}”.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-space-2">
            {filtered.map(p => renderCard(p, {
              onApply: () => apply(p),
              onRename: (e) => beginRename(p, e),
              onRemove: (e) => remove(p, e),
              onEnter: () => onCardEnter(p),
              onLeave: () => onCardLeave(),
              renaming: renaming?.id === p.id ? renaming : null,
              setRenaming,
              commitRename,
              thumbUrl: thumbs.get(p.id) ?? null,
            }))}
          </div>
        )}
      </div>

      {/* Footer: Save / Import strip. When the user clicks Save,
          the strip swaps to a name input and a Save button;
          Esc / empty-submit reverts. The hidden file input drives
          the Import flow without dragging in a separate dialog. */}
      <div className="border-t border-border-subtle bg-surface-panel p-1 shrink-0">
        {savingName === null ? (
          <div className="flex items-center gap-space-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={beginSave}
              className="flex-1 justify-start gap-space-2 h-8 text-metadata uppercase tracking-widest text-accent-primary hover:bg-accent-primary/10 hover:text-accent-primary"
            >
              <Plus size={12} />
              Save current as preset…
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => importInputRef.current?.click()}
              className="justify-start gap-space-2 h-8 text-metadata uppercase tracking-widest text-text-muted hover:bg-overlay-hover hover:text-text-emphatic"
              title="Import a Lightroom .xmp preset"
            >
              <Download size={12} />
              Import
            </Button>
            {/* Hidden file input: clicked programmatically by the
                Import button. .xmp is the canonical extension for
                Camera Raw / Lightroom Classic presets. */}
            {/* eslint-disable-next-line no-restricted-syntax -- hidden file picker, no shadcn equivalent */}
            <input
              ref={importInputRef}
              type="file"
              accept=".xmp,application/xml,text/xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleImportFile(f)
                // Reset value so re-selecting the same file fires onChange.
                e.target.value = ''
              }}
            />
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void commitSave() }} className="flex items-center gap-space-1 px-1 py-1">
            <div className="relative flex-1 flex items-center">
              {/* design-allow: dense inline save-as field (h-7 / text-code / pr-8)
                  doesn't match the shadcn Input's h-9 / text-body form-row defaults. */}
              {/* eslint-disable-next-line no-restricted-syntax -- see design-allow above */}
              <input
                autoFocus
                value={saveInputValue}
                onChange={(e) => setSaveInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') cancelSave() }}
                placeholder="Preset name…"
                className="w-full bg-surface-workspace border border-border-strong rounded-soft pl-2 pr-8 py-1 h-7 text-code text-text-emphatic focus:outline-none focus:border-border-focus"
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              className="h-7 px-3 text-metadata uppercase tracking-widest"
            >
              Save
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}

interface CardHandlers {
  onApply: () => void
  onRename: (e: React.MouseEvent) => void
  onRemove: (e: React.MouseEvent) => void
  onEnter: () => void
  onLeave: () => void
  renaming: { id: string; name: string } | null
  setRenaming: (next: { id: string; name: string } | null) => void
  commitRename: () => void
  /** Object URL for the rendered thumbnail. When null,
   *  the card falls back to the closed-form colourway swatch. The
   *  thumbnail render is async, so the colourway covers the
   *  loading window and the no-source-bitmap edge case. */
  thumbUrl: string | null
}

/**
   * One preset card. Single layout point. When WebGL thumbnails ship
   * as a follow-up, the `<ColourwaySwatch>` block is the only place
   * that needs to swap to a `<canvas>`.
   */
function renderCard(p: Preset, h: CardHandlers) {
  const isRenaming = h.renaming?.id === p.id
  return (
    <div
      key={p.id}
      onMouseEnter={h.onEnter}
      onMouseLeave={h.onLeave}
      onClick={isRenaming ? undefined : h.onApply}
      className={cn(
        'group relative rounded-soft border border-border-subtle bg-surface-panel overflow-hidden transition-colors',
        !isRenaming && 'hover:border-border-strong cursor-pointer',
      )}
    >
      {h.thumbUrl ? (
        <img
          src={h.thumbUrl}
          alt={p.name}
          className="w-full h-20 object-cover border-b border-border-subtle"
          draggable={false}
        />
      ) : (
        // Skeleton. Subtle pulsing block while the WebGL thumb is
        // queued or rendering. Replaces the earlier closed-form
        // colourway gradient: a transient swatch that flips to the
        // real thumb on render felt like a flicker, the skeleton
        // reads as a clear loading state instead.
        <div
          aria-hidden="true"
          className="w-full h-20 border-b border-border-subtle bg-surface-workspace animate-pulse"
        />
      )}
      <div className="px-space-2 py-space-2 flex items-center gap-space-1">
        {isRenaming ? (
          <form
            onSubmit={(e) => { e.preventDefault(); h.commitRename() }}
            className="flex-1 flex items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* design-allow: dense inline rename field (h-6 / text-code / px-2)
                doesn't match the shadcn Input's h-9 / text-body / px-space-3
                form-row defaults. */}
            {/* eslint-disable-next-line no-restricted-syntax -- see design-allow above */}
            <input
              autoFocus
              value={h.renaming!.name}
              onChange={(e) => h.setRenaming({ id: p.id, name: e.target.value })}
              onBlur={h.commitRename}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); h.setRenaming(null) } }}
              className="flex-1 bg-surface-workspace border border-border-focus rounded-soft px-2 py-1 h-6 text-code text-text-emphatic focus:outline-none"
            />
          </form>
        ) : (
          <>
            <span className="flex-1 truncate text-body text-text-default group-hover:text-text-emphatic">
              {p.name}
            </span>
            {p.builtin && (
              <span className="text-metadata font-mono text-text-disabled tracking-widest">
                BUILT-IN
              </span>
            )}
          </>
        )}
      </div>

      {/* Hover-only edit/delete affordances: only on custom presets;
          built-ins are immutable. */}
      {!p.builtin && !isRenaming && (
        <div className="absolute top-1 right-1 flex items-center gap-space-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton
            icon={<Pencil size={11} />}
            aria-label="Rename preset"
            onClick={h.onRename}
            className="w-6 h-6 p-0 bg-surface-floating backdrop-blur-sm hover:bg-surface-raised text-text-muted hover:text-accent-primary"
          />
          <IconButton
            icon={<Trash2 size={11} />}
            aria-label="Delete preset"
            onClick={h.onRemove}
            className="w-6 h-6 p-0 bg-surface-floating backdrop-blur-sm hover:bg-surface-raised text-text-muted hover:text-status-danger"
          />
        </div>
      )}
    </div>
  )
}

