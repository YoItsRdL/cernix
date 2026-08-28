import { cn } from '@/lib/utils'
import { FULL_FRAME_CROP } from '@/../shared/edit-params'
import type { CropRect } from '@/types'

interface DimensionPanelProps {
  crop: CropRect
  imageDims: { w: number; h: number } | null
  onChange: (next: CropRect) => void
}

// Popular aspect ratios for social + print delivery. `ratio` is w/h in
// real-pixel terms; `null` means "remove the constraint" and resets the
// crop to full frame. Parallel to FramePanel's None tile.
const DIMENSIONS: { label: string; ratio: number | null }[] = [
  { label: 'Full',  ratio: null    },
  { label: '1:1',   ratio: 1       },
  { label: '4:5',   ratio: 4 / 5   },
  { label: '9:16',  ratio: 9 / 16  },
  { label: '3:2',   ratio: 3 / 2   },
  { label: '2:3',   ratio: 2 / 3   },
  { label: '16:9',  ratio: 16 / 9  },
  { label: '4:3',   ratio: 4 / 3   },
]

/**
 * Quick-pick aspect ratios. Reshapes the current crop to a target
 * aspect, centred on the existing crop and grown to the largest rect
 * that fits inside the image. One click, no modal crop step.
 */
export function DimensionPanel({ crop, imageDims, onChange }: DimensionPanelProps) {
  const imageAspect = imageDims && imageDims.w && imageDims.h ? imageDims.w / imageDims.h : 1
  const activeIdx = detectActive(crop, imageAspect)

  const pick = (i: number) => {
    const ratio = DIMENSIONS[i].ratio
    if (ratio == null) { onChange(FULL_FRAME_CROP); return }
    onChange(fitAspect(crop, ratio, imageAspect))
  }

  return (
    <div className="px-space-4 py-space-2 grid grid-cols-4 gap-space-2">
      {DIMENSIONS.map((d, i) => {
        const tileAspect = d.ratio ?? 1
        return (
          <button /* eslint-disable-line no-restricted-syntax -- design-allow: an aspect-ratio tile that draws its own proportions */
            key={d.label}
            onClick={() => pick(i)}
            title={d.label}
            className={cn(
              'relative flex items-center justify-center rounded-sm border bg-surface-workspace overflow-hidden transition-colors',
              activeIdx === i
                ? 'border-accent-primary ring-1 ring-accent-primary'
                : 'border-border-subtle hover:border-border-strong',
            )}
          >
            {/* Inner shape visualises the aspect inside a square tile so
                the grid cells all share the same footprint. */}
            <span
              className={cn(
                'rounded-sm border',
                activeIdx === i ? 'border-accent-primary' : 'border-border-strong',
              )}
              style={{
                aspectRatio: tileAspect,
                width: tileAspect >= 1 ? '72%' : 'auto',
                height: tileAspect < 1 ? '72%' : 'auto',
              }}
            />
            <span
              className={cn(
                'absolute bottom-0.5 left-1 text-caption font-mono tracking-tight',
                activeIdx === i ? 'text-accent-primary' : 'text-text-muted',
              )}
            >
              {d.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Matches the crop's current aspect (within tolerance) against the
 *  preset list; 0 = Full (no constraint / full-frame rect). */
function detectActive(rect: CropRect, imageAspect: number): number {
  const isFull = rect.x === 0 && rect.y === 0 && rect.w === 1 && rect.h === 1
  if (isFull) return 0
  const rectAspect = (rect.w * imageAspect) / rect.h
  const tol = 0.01
  for (let i = 1; i < DIMENSIONS.length; i++) {
    const r = DIMENSIONS[i].ratio
    if (r != null && Math.abs(rectAspect - r) < tol) return i
  }
  return -1
}

/** Same math as CropOverlay.fitAspect: kept local so this panel can
 *  act without importing from a sibling overlay component. */
function fitAspect(prev: CropRect, ratio: number, imageAspect: number): CropRect {
  const normTarget = ratio / imageAspect
  const cx = prev.x + prev.w / 2
  const cy = prev.y + prev.h / 2
  const maxW = 2 * Math.min(cx, 1 - cx)
  const maxH = 2 * Math.min(cy, 1 - cy)
  let w = Math.min(maxW, maxH * normTarget)
  let h = w / normTarget
  if (h > maxH) { h = maxH; w = h * normTarget }
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}
