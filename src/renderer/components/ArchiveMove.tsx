import { useEffect, useState } from 'react'
import { FolderInput } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/format-bytes'
import type { ArchiveProgress } from '@/types'

type Step =
  | { kind: 'idle' }
  | { kind: 'confirm'; destination: string; from: string; files: number; bytes: number }
  | { kind: 'moving'; progress: ArchiveProgress | null }
  | { kind: 'done'; path: string; files: number; leftovers: number }

const PHASE_WORDS: Record<ArchiveProgress['phase'], string> = {
  counting: 'Counting photographs',
  copying: 'Copying',
  checking: 'Checking the copies',
  removing: 'Removing the old files',
}

/**
 * Move the Local Archive to another folder (decision 20), from Settings.
 *
 * The whole flow is stated before it starts and in the order it happens,
 * because these may be the only copies of a shoot: copy everything, check
 * every copy, switch over, and only then remove the old files. The picked
 * folder and the move itself both go through main, which holds the
 * destination in between, so nothing here names a path to move to.
 */
export function ArchiveMove({ onMoved }: { onMoved: (path: string) => void }) {
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => window.electronAPI.onArchiveProgress(p => {
    setStep(s => (s.kind === 'moving' ? { kind: 'moving', progress: p } : s))
  }), [])

  const pick = async () => {
    setError(null)
    const r = await window.electronAPI.archivePickDestination().catch(() => ({ error: 'The folder could not be checked.' }))
    if ('cancelled' in r) return
    if ('error' in r) { setError(r.error); return }
    setStep({ kind: 'confirm', ...r })
  }

  const move = async () => {
    setError(null)
    setStep({ kind: 'moving', progress: null })
    const r = await window.electronAPI.archiveMove().catch(() => ({ error: 'The archive could not be moved. Nothing was changed.' }))
    if ('error' in r) { setError(r.error); setStep({ kind: 'idle' }); return }
    onMoved(r.path)
    setStep({ kind: 'done', path: r.path, files: r.files, leftovers: r.leftovers.length })
  }

  const p = step.kind === 'moving' ? step.progress : null
  // Once the copies are checked there is nothing to stop: the switch-over has happened.
  const canStop = step.kind === 'moving' && (p === null || p.phase === 'counting' || p.phase === 'copying' || p.phase === 'checking')

  return (
    <div className="space-y-space-3">
      {step.kind === 'idle' && (
        <Button variant="neutral" onClick={pick} className="gap-space-2">
          <FolderInput size={12} />
          Move archive…
        </Button>
      )}

      {step.kind === 'confirm' && (
        <div className="space-y-space-3 border border-border-subtle rounded-soft p-space-4" role="group" aria-label="Confirm moving the archive">
          <p className="text-metadata text-text-default leading-relaxed">
            Move {step.files.toLocaleString()} {step.files === 1 ? 'file' : 'files'} ({formatBytes(step.bytes)}) to
          </p>
          <p className="text-metadata font-mono text-text-emphatic select-text break-all">{step.destination}</p>
          <p className="text-metadata text-text-muted leading-relaxed">
            Cernix copies everything there, checks every copy, switches over, and only then removes the old files.
            Nothing is overwritten, and if anything fails the archive stays where it is. Importing waits until it is done.
          </p>
          <div className="flex gap-space-2">
            <Button variant="primary" size="sm" onClick={move}>Move archive</Button>
            <Button variant="neutral" size="sm" onClick={() => setStep({ kind: 'idle' })}>Cancel</Button>
          </div>
        </div>
      )}

      {step.kind === 'moving' && (
        <div className="space-y-space-3" aria-live="polite">
          <p className="text-metadata text-text-default">
            {p ? `${PHASE_WORDS[p.phase]}${p.total > 0 ? `: ${p.done.toLocaleString()} of ${p.total.toLocaleString()}` : ''}` : 'Starting…'}
          </p>
          {canStop && (
            <Button variant="neutral" size="sm" onClick={() => { void window.electronAPI.archiveMoveCancel() }}>Stop</Button>
          )}
        </div>
      )}

      {step.kind === 'done' && (
        <div className="space-y-space-2" role="status">
          <p className="text-metadata text-status-success">
            Moved {step.files.toLocaleString()} {step.files === 1 ? 'file' : 'files'} to the new folder.
          </p>
          {step.leftovers > 0 && (
            <p className="text-metadata text-status-warn">
              {step.leftovers} old {step.leftovers === 1 ? 'file' : 'files'} could not be removed and are still in the old folder. The new archive is complete; delete them yourself when you like.
            </p>
          )}
          <Button variant="neutral" size="sm" onClick={() => setStep({ kind: 'idle' })}>Done</Button>
        </div>
      )}

      {error && <p className="text-metadata text-status-danger" role="alert">{error}</p>}
    </div>
  )
}
