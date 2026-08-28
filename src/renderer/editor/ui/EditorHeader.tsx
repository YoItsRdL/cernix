import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Check, Loader2, Crop, Undo2, Eye } from 'lucide-react'
import type { ParamsStore } from '../state/params-store'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import { DURATION_FAST, DURATION_STANDARD, EASE_STANDARD } from '@/lib/motion'

interface EditorHeaderProps {
  fileName: string
  store: ParamsStore | null
  onExit: () => void
  onCrop?: () => void
  cropping?: boolean
  /** When true, a committed crop is active: show a "clear" affordance. */
  hasCrop?: boolean
  onClearCrop?: () => void
  /** True while the user is viewing the untouched original (hold `\` or
   *  press-and-hold the Compare button). */
  comparing?: boolean
  /** Enters compare mode on pointer down. Release fires `onCompareUp`. */
  onCompareDown?: () => void
  onCompareUp?: () => void
  children?: React.ReactNode
}

/**
 * Editor header. Quiet typography (no shouting caps), generous spacing,
 * subtle save indicator that reads like Apple Notes / iA Writer. The
 * user never wonders whether their edits persisted.
 */
export function EditorHeader({ fileName, store, onExit, onCrop, cropping, hasCrop, onClearCrop, comparing, onCompareDown, onCompareUp, children }: EditorHeaderProps) {
  const [saved, setSaved] = useState(true)

  useEffect(() => {
    if (!store) return
    return store.subscribeSaved(setSaved)
  }, [store])

  return (
    <header className="h-12 flex items-center justify-between px-space-5 border-b border-border-subtle bg-surface-panel shrink-0">
      <div className="flex items-center gap-space-4 min-w-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onExit}
          className="gap-space-1 text-text-muted hover:text-text-emphatic px-2 -ml-2"
          title="Back to library (Esc)"
        >
          <ChevronLeft size={16} />
          Library
        </Button>
        <div className="h-4 w-px bg-border-strong" />
        <div className="flex items-center gap-space-2 min-w-0">
          <span className="text-body text-text-emphatic truncate font-medium">{fileName}</span>
          <SaveIndicator saved={saved} />
        </div>
      </div>
      <div className="flex items-center gap-space-2">
        {onCompareDown && onCompareUp && (
          // Press-and-hold semantics. Matches the hold-`\` keyboard
          // gesture and the iOS Photos "touch to see original" muscle
          // memory. `onPointerLeave` and `onPointerCancel` release
          // defensively so dragging the cursor away or an interrupted
          // touch doesn't leave the canvas stuck showing the source.
          <Button
            variant={comparing ? 'primary' : 'outline'}
            size="sm"
            onPointerDown={(e) => { e.preventDefault(); onCompareDown() }}
            onPointerUp={onCompareUp}
            onPointerLeave={onCompareUp}
            onPointerCancel={onCompareUp}
            className="gap-space-1.5 h-7 select-none touch-none"
            title="Hold to compare with original (\\)"
            aria-pressed={comparing}
          >
            <Eye size={14} />
            {comparing ? 'Original' : 'Compare'}
          </Button>
        )}
        {onCrop && (
          <div className="flex items-center">
            <Button
              variant={cropping ? 'primary' : 'outline'}
              size="sm"
              onClick={onCrop}
              className={cn(
                'gap-space-1.5 h-7',
                hasCrop && onClearCrop ? 'rounded-r-none' : ''
              )}
              title="Crop (C)"
            >
              <Crop size={14} />
              Crop
            </Button>
            {hasCrop && onClearCrop && (
              <Button
                variant={cropping ? 'primary' : 'outline'}
                size="sm"
                onClick={onClearCrop}
                className={cn(
                  'gap-space-1 h-7 border-l-0 rounded-l-none',
                  cropping ? 'border-l border-overlay-strong' : '' // Ensure border separator is visible in primary state
                )}
                title="Restore original: full-frame, no rotation or transform (Shift+C)"
                aria-label="Restore original image"
              >
                <Undo2 size={14} />
                Restore
              </Button>
            )}
          </div>
        )}
        {children}
        <IconButton
          icon={<span className="font-mono font-bold">?</span>}
          aria-label="Keyboard shortcuts"
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}
          title="Keyboard shortcuts (?)"
          className="h-7 w-7"
        />
      </div>
    </header>
  )
}

function SaveIndicator({ saved }: { saved: boolean }) {
  return (
    <div className="flex items-center gap-space-1.5 text-metadata tabular-nums ml-space-2">
      <AnimatePresence mode="wait">
        {saved ? (
          <motion.div
            key="saved"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION_STANDARD, ease: EASE_STANDARD }}
            className="flex items-center gap-space-1 text-text-muted"
          >
            <Check size={12} strokeWidth={2.5} />
            <span>Saved</span>
          </motion.div>
        ) : (
          <motion.div
            key="saving"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.8 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION_FAST, ease: EASE_STANDARD }}
            className="flex items-center gap-space-1 text-text-muted"
          >
            <Loader2 size={12} className="animate-spin" />
            <span>Saving…</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
