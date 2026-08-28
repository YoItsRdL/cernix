import { useEffect, useRef, useState } from 'react'
import { Upload, HardDrive, Cloud } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type ExportFormat = 'image/jpeg' | 'image/png' | 'image/webp'
export type ExportDestination = 'drive' | 'local'

export interface ExportOptions {
  format: ExportFormat
  quality: number      // 0.5..1.0 (ignored for PNG)
  maxLongEdge: number  // 0 = original size
  destination: ExportDestination
}

const DEFAULT_OPTIONS: ExportOptions = { format: 'image/jpeg', quality: 1, maxLongEdge: 0, destination: 'drive' }
const STORAGE_KEY = 'cernix.editor.exportOptions'

interface ExportOptionsPopoverProps {
  exporting: boolean
  onCommit: (opts: ExportOptions) => void
  /** When true, hide the Drive destination option and force `local`.
   *  Used when the source has no Drive identity (Open File… entry
   *  point); the upload pipeline keys off a Drive file ID we don't
   *  have. */
  localOnly?: boolean
}

const FORMAT_LABEL: Record<ExportFormat, string> = {
  'image/jpeg': 'JPEG',
  'image/png':  'PNG',
  'image/webp': 'WebP',
}

export function ExportOptionsPopover({ exporting, onCommit, localOnly = false }: ExportOptionsPopoverProps) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<ExportOptions>(() => loadOptions())
  const containerRef = useRef<HTMLDivElement>(null)

  // For local-only sources the Drive upload path doesn't apply, so the
  // persisted destination preference is overridden at read-time. This
  // is the derive-at-use-site shape rather than a setState-in-effect
  // sync. The persisted preference is preserved untouched, and
  // commit/render use this view of it.
  const effectiveOptions: ExportOptions = localOnly
    ? { ...options, destination: 'local' }
    : options

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(options))
  }, [options])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  const commit = () => {
    setOpen(false)
    onCommit(effectiveOptions)
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        size="sm"
        variant="primary"
        onClick={() => setOpen(v => !v)}
        disabled={exporting}
        className="gap-space-2 h-7"
        title={effectiveOptions.destination === 'local' ? 'Export to disk' : 'Export to Drive'}
      >
        <Upload size={12} />
        {exporting ? 'Exporting…' : 'Export'}
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-space-2 w-64 bg-surface-raised border border-border-strong rounded-soft shadow-xl z-50 p-space-4 space-y-space-4">
          {!localOnly && (
            <div>
              <div className="text-caption font-mono tracking-widest text-text-muted uppercase mb-space-2">Destination</div>
              <div className="grid grid-cols-2 gap-space-2">
                <Button
                  size="sm"
                  variant={options.destination === 'drive' ? 'secondary' : 'outline'}
                  onClick={() => setOptions(o => ({ ...o, destination: 'drive' }))}
                  className="h-7 gap-space-1.5 text-code font-mono"
                >
                  <Cloud size={12} />
                  Drive
                </Button>
                <Button
                  size="sm"
                  variant={options.destination === 'local' ? 'secondary' : 'outline'}
                  onClick={() => setOptions(o => ({ ...o, destination: 'local' }))}
                  className="h-7 gap-space-1.5 text-code font-mono"
                >
                  <HardDrive size={12} />
                  Local
                </Button>
              </div>
            </div>
          )}

          <div>
            <div className="text-caption font-mono tracking-widest text-text-muted uppercase mb-space-2">Format</div>
            <div className="grid grid-cols-3 gap-space-2">
              {(Object.keys(FORMAT_LABEL) as ExportFormat[]).map(f => (
                <Button
                  key={f}
                  size="sm"
                  variant={options.format === f ? 'secondary' : 'outline'}
                  onClick={() => setOptions(o => ({ ...o, format: f }))}
                  className="h-7 text-code font-mono px-0"
                >
                  {FORMAT_LABEL[f]}
                </Button>
              ))}
            </div>
          </div>

          {options.format !== 'image/png' && (
            <div>
              <div className="flex items-center justify-between text-caption font-mono tracking-widest text-text-muted uppercase mb-space-2">
                <span>Quality</span>
                <span className="text-text-emphatic tabular-nums">{Math.round(options.quality * 100)}</span>
              </div>
              {/* design-allow: Native input pending shadcn Slider adoption */}
              <input /* eslint-disable-line no-restricted-syntax -- design-allow: a native range input; the shared Input is a text field */
                type="range"
                min={0.5}
                max={1}
                step={0.01}
                value={options.quality}
                onChange={e => setOptions(o => ({ ...o, quality: Number(e.target.value) }))}
                className="w-full accent-accent-primary"
              />
            </div>
          )}

          <Button
            variant="primary"
            className="w-full h-8 text-metadata uppercase tracking-widest"
            onClick={commit}
          >
            Export
          </Button>
        </div>
      )}
    </div>
  )
}

function loadOptions(): ExportOptions {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_OPTIONS, ...JSON.parse(raw) }
  } catch {
    // Malformed JSON or storage unavailable. Fall through to defaults.
  }
  return DEFAULT_OPTIONS
}
