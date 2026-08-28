import { motion } from 'framer-motion'
import { Plus, RefreshCw, Layers, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SPRING_STANDARD } from '@/lib/motion'

interface EmptyStateProps {
  hasVolumes: boolean
  isScanning: boolean
  onScan: () => void
  onImportFolder: () => void
}

/**
 * The first screen of an empty archive.
 *
 * Composed from the landing page's hero rather than invented: a quiet
 * mark, a sentence-case headline at the top of the scale, one muted
 * supporting line on a comfortable measure, pill actions, and a small
 * meta line underneath. Same rhythm, same restraint, translated from
 * marketing sizes to the in-app scale.
 *
 * Deliberately NOT a card. The landing page boxes the product mockup
 * and never the copy. A headline inside a panel reads as a dialog, and
 * this is the room, not a message about the room.
 *
 * Deliberately says nothing about dragging files in: there is no drop
 * handler anywhere in the renderer, and an affordance that does nothing
 * is worse than no affordance.
 */
export function EmptyState({
  hasVolumes,
  isScanning,
  onScan,
  onImportFolder,
}: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-surface-workspace">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING_STANDARD}
        className="flex-1 flex flex-col items-center justify-center px-space-6 text-center"
      >
        {/* An anchor, not a widget. It was an 80px bordered tile with a
            heavy shadow and an infinite shimmer: motion that never
            resolves reads as loading, and this screen is idle. */}
        <Layers
          size={36}
          strokeWidth={1}
          className="text-text-disabled mb-space-6"
          aria-hidden
        />

        <h2 className="text-title font-semibold text-text-emphatic tracking-tight text-balance mb-space-3">
          Ready to import
        </h2>

        <p className="text-body text-text-muted leading-relaxed max-w-sm mb-space-6">
          Connect an SD card or external drive and Cernix will find it.
          Or bring in media from any folder on this machine.
        </p>

        {/* Pill actions at the landing page's proportions, scaled to the
            app: one filled primary, one outlined beside it. */}
        <div className="flex items-center gap-space-3">
          <Button
            variant="primary"
            size="sm"
            onClick={onImportFolder}
            disabled={isScanning}
            className="h-10 px-space-6 gap-space-2"
          >
            <FolderOpen size={14} />
            Import folder
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onScan}
            disabled={!hasVolumes || isScanning}
            className="h-10 px-space-6 gap-space-2"
          >
            {isScanning
              ? <RefreshCw size={14} className="animate-spin text-text-muted" />
              : <Plus size={14} />}
            Scan device
          </Button>
        </div>

        {/* The landing page's quiet meta line. A disabled control with no
            explanation is a dead end, so this says what is missing and
            what would fix it. */}
        <p className="mt-space-5 text-caption text-text-disabled h-4">
          {isScanning
            ? 'Scanning connected volumes…'
            : hasVolumes
              ? 'A removable drive is connected and ready to scan.'
              : 'No removable drive detected: plug one in to scan.'}
        </p>
      </motion.div>
    </div>
  )
}
