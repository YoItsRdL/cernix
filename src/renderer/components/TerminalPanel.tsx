/**
 * The activity log drawer.
 *
 * A diagnostic surface, not a product one: it exists so that a failed
 * ingest or a stalled upload can be explained without attaching a
 * debugger, which matters most on the machines least likely to have one.
 * Nothing here leaves the process, and nothing is written to disk.
 *
 * It is self-contained on purpose: it subscribes to the sweep, upload
 * and editor IPC events itself and keeps its own buffer, capped at 500
 * entries, so a long session cannot grow it without bound and no parent
 * has to thread log state down to it.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Terminal, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface LogEntry {
  timestamp: Date
  level: 'info' | 'warn' | 'error' | 'success'
  source: string
  message: string
}

const LEVEL_COLORS: Record<LogEntry['level'], string> = {
  info:    'text-text-muted',
  warn:    'text-status-warn/70',
  error:   'text-status-danger/80',
  success: 'text-status-success/70',
}

// Source tags distinguish log origins at a glance. Each tint is a
// categorical role token (`cat-*` in tokens.css), not a status state.
// Hence no mapping to `status-success/warn/danger`. `drive` reuses the
// accent because it represents the primary cloud surface.
const SOURCE_COLORS: Record<string, string> = {
  'sweep':  'text-cat-sweep/60',
  'upload': 'text-cat-upload/60',
  'drive':  'text-secondary/70',
  'system': 'text-text-disabled',
  'editor': 'text-cat-editor/60',
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface TerminalPanelProps {
  isOpen: boolean
  onToggle: () => void
}

export function TerminalPanel({ isOpen, onToggle }: TerminalPanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  const addLog = useCallback((level: LogEntry['level'], source: string, message: string) => {
    setLogs(prev => {
      const next = [...prev, { timestamp: new Date(), level, source, message }]
      // Keep last 500 entries
      return next.length > 500 ? next.slice(-500) : next
    })
  }, [])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  // Track if user has scrolled up
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40
  }, [])

  // Subscribe to all relevant IPC events
  useEffect(() => {
    const unsubProgress = window.electronAPI.onSweepProgress((p) => {
      addLog('info', 'sweep', `COPY ${p.file}  (${p.current}/${p.total})  ${formatSpeed(p.bytesPerSecond)}`)
    })

    const unsubComplete = window.electronAPI.onSweepComplete((s) => {
      addLog('success', 'sweep', `Staging complete: ${s.processedFiles} files staged to local archive.`)
    })

    const unsubError = window.electronAPI.onSweepError((e) => {
      addLog('error', 'sweep', `${e.error}${e.file ? ` [${e.file}]` : ''}`)
    })

    const unsubUploadStarted = window.electronAPI.onUploadStarted((s) => {
      addLog('info', 'upload', `Cloud sync initiated: ${s.totalFiles} file(s) queued for transfer.`)
    })

    const unsubUploadProgress = window.electronAPI.onUploadProgress((p) => {
      // Was guarded on `p.fileName`, which this payload has never
      // carried, so the terminal logged no upload line at all.
      if (p.file) {
        addLog('info', 'upload', `PUSH ${p.file}  ${Math.round(p.percent || 0)}%`)
      }
    })

    const unsubUploadComplete = window.electronAPI.onUploadComplete((s) => {
      addLog('success', 'upload', `Cloud sync complete. Drive folder: ${s.driveFolderUrl || s.driveFolderId || 'linked'}`)
    })

    const unsubSysLog = window.electronAPI.onSysLog((entry) => {
      addLog(entry.level as LogEntry['level'] || 'info', entry.source || 'system', entry.message)
    })

    return () => {
      unsubProgress()
      unsubComplete()
      unsubError()
      unsubUploadStarted()
      unsubUploadProgress()
      unsubUploadComplete()
      unsubSysLog()
    }
  }, [addLog])

  const clearLogs = () => {
    setLogs([])
    addLog('info', 'system', 'Terminal cleared.')
  }

  return (
    <div className={cn(
      'flex flex-col bg-surface-panel border-t border-border-strong transition-all duration-200',
      isOpen ? 'h-terminal' : 'h-terminal-bar'
    )}>
      {/* Title Bar */}
      <button /* eslint-disable-line no-restricted-syntax -- design-allow: the panel title bar is itself the toggle */
        onClick={onToggle}
        className="h-terminal-bar shrink-0 flex items-center justify-between px-3 bg-surface-raised hover:bg-surface-raised transition-colors cursor-pointer border-b border-border-subtle"
      >
        <div className="flex items-center gap-2">
          <Terminal size={11} className="text-text-disabled" />
          <span className="text-caption font-bold uppercase tracking-[0.15em] text-text-muted">Output</span>
          {logs.length > 0 && (
            <span className="text-metadata text-text-disabled tabular-nums">{logs.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isOpen && (
            <div
              onClick={(e) => { e.stopPropagation(); clearLogs() }}
              className="p-0.5 hover:bg-overlay-active rounded-sm transition-colors cursor-pointer"
            >
              <Trash2 size={10} className="text-text-disabled hover:text-text-muted" />
            </div>
          )}
          {isOpen ? (
            <ChevronDown size={12} className="text-text-disabled" />
          ) : (
            <ChevronUp size={12} className="text-text-disabled" />
          )}
        </div>
      </button>

      {/* Log Output */}
      {isOpen && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden font-mono text-body leading-[18px] p-2" // eslint-disable-line no-restricted-syntax -- design-allow: the panel title bar is itself the toggle
        >
          {logs.map((entry, i) => (
            <div key={i} className="flex gap-2 hover:bg-overlay-hover px-1">
              <span className="text-text-disabled shrink-0 tabular-nums">{formatTime(entry.timestamp)}</span>
              <span className={cn('shrink-0 w-log-source text-right uppercase text-caption', SOURCE_COLORS[entry.source] || 'text-text-disabled')}>
                {entry.source}
              </span>
              <span className={cn('min-w-0 break-all', LEVEL_COLORS[entry.level])}>
                {entry.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return ''
  const k = 1024
  if (bytesPerSecond < k) return `${bytesPerSecond} B/s`
  if (bytesPerSecond < k * k) return `${(bytesPerSecond / k).toFixed(1)} KB/s`
  return `${(bytesPerSecond / k / k).toFixed(1)} MB/s`
}
