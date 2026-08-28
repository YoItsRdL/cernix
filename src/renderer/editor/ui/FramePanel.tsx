import { cn } from '@/lib/utils'
import { FRAME_PRESETS } from '@/../shared/frame-presets'
import { frameAssetUrl } from '../frame-assets'

interface FramePanelProps {
  value: string | null
  onChange: (next: string | null) => void
}

/**
 * Frame picker. None + a thumbnail per preset. Single-select. Thumbnails
 * use the frame PNG itself on a dim background so the user sees the cutout
 * shape and outer aspect at a glance.
 */
export function FramePanel({ value, onChange }: FramePanelProps) {
  return (
    <div className="px-space-4 py-space-2 grid grid-cols-4 gap-space-2">
      <Tile selected={value == null} aspect={1} onClick={() => onChange(null)}>
        <span className="text-caption text-text-muted">None</span>
      </Tile>
      {FRAME_PRESETS.map(p => (
        <Tile
          key={p.id}
          selected={value === p.id}
          aspect={p.outer.w / p.outer.h}
          onClick={() => onChange(p.id)}
          title={p.label}
        >
          <img
            src={frameAssetUrl(p.id) ?? ''}
            alt={p.label}
            className="absolute inset-0 w-full h-full object-contain"
            draggable={false}
          />
        </Tile>
      ))}
    </div>
  )
}

function Tile({
  selected,
  aspect,
  onClick,
  title,
  children,
}: {
  selected: boolean
  aspect: number
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button /* eslint-disable-line no-restricted-syntax -- design-allow: a frame-preview tile, not a labelled control */
      onClick={onClick}
      title={title}
      className={cn(
        'relative flex items-center justify-center rounded-sm border bg-surface-workspace overflow-hidden transition-colors',
        selected
          ? 'border-accent-primary ring-1 ring-accent-primary'
          : 'border-border-subtle hover:border-border-strong',
      )}
      style={{ aspectRatio: aspect }}
    >
      {children}
    </button>
  )
}
