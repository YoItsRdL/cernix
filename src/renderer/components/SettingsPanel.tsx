import { useState, useEffect } from 'react'
import { Settings, Coffee, Keyboard, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'

interface SettingsPanelProps {
  onClose: () => void
  /**
   * Swap Settings for the keyboard sheet.
   *
   * Owned by the caller rather than by a flag in here, because only one
   * modal may be open at a time and this panel cannot enforce that
   * about a sibling. Opening the sheet from inside Settings used to
   * render it underneath (the two disagreed about their z-index) and
   * even stacked correctly, two scrims over one another is not a thing
   * to get right, it is a thing to not do.
   */
  onShowShortcuts: () => void
}

/**
 * Configuration panel.
 *
 * Cernix stores no credentials of its own. The Google Drive OAuth
 * tokens live in main (`google-auth.ts`); everything here is local
 * housekeeping.
 */
export function SettingsPanel({ onClose, onShowShortcuts }: SettingsPanelProps) {
  /**
   * The running version, asked for once when the panel opens.
   *
   * The issue template asks reporters for it, and used to point them at
   * the installer filename or Add/Remove Programs, because the app did
   * not say anywhere. It says here now.
   */
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    window.electronAPI.systemVersion()
      .then(v => { if (live) setVersion(v) })
      .catch(() => { /* an unknown version is not worth an error state */ })
    return () => { live = false }
  }, [])

  // ── Drive ──
  const [checking, setChecking] = useState(false)
  /** How many the last check found, held briefly as the answer. */
  const [found, setFound] = useState<number | null>(null)

  return (
    <Modal
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      title="Configuration"
      icon={<Settings size={14} className="text-text-muted" />}
    >
      <div className="space-y-space-6">
        {/* This comment described the Support section and had drifted
            two sections above it. What it said about the support link
            is now beside that link, and what it said about where the
            link lives is out of date: the rail carries one too. */}
        <div className="space-y-space-4">
          <div className="flex items-center gap-space-3">
            <div className="h-px flex-1 bg-border-subtle" />
            <span className="text-caption text-text-muted px-space-2">Keyboard</span>
            <div className="h-px flex-1 bg-border-subtle" />
          </div>

          <div className="space-y-space-3">
            <p className="text-metadata text-text-muted leading-relaxed">
              Everything the app can do without a mouse: selecting, moving
              through the grid, rating, and the editor&rsquo;s tools.
            </p>
            <Button
              variant="neutral"
              onClick={onShowShortcuts}
              className="gap-space-2"
            >
              <Keyboard size={12} />
              Keyboard shortcuts
            </Button>
          </div>
        </div>

        <div className="space-y-space-4">
          <div className="flex items-center gap-space-3">
            <div className="h-px flex-1 bg-border-subtle" />
            <span className="text-caption text-text-muted px-space-2">Support</span>
            <div className="h-px flex-1 bg-border-subtle" />
          </div>

          {/* One link, no nag. The rail carries the same action as an
              icon; this is the one that gets to explain itself, which is
              why the sentence lives here and not there. The URL is in
              main (SUPPORT_URL) and the renderer only asks for it to be
              opened, so the app never contacts the host itself. */}
          <div className="space-y-space-3">
            <p className="text-metadata text-text-muted leading-relaxed">
              Cernix is free and open source, and stays that way. If it earns its
              place in your workflow, you can buy me a coffee: it changes nothing
              about the app.
            </p>
            <Button
              variant="neutral"
              onClick={() => { void window.electronAPI.supportOpen() }}
              className="gap-space-2"
            >
              <Coffee size={12} />
              Buy me a coffee
            </Button>
          </div>
        </div>

        {/*
        Refresh, not empty. The ledger already heals itself: Drive is
        re-read at startup and whenever that reading is more than twelve
        hours old. Emptying it by hand left every photograph in Drive
        reading as "New" until the next launch, which is an invitation
        to upload the whole library a second time. What anyone reaching
        for that button actually wanted is this one: ask Drive now.
      */}
        <div className="space-y-space-4">
          <div className="flex items-center gap-space-3">
            <div className="h-px flex-1 bg-border-subtle" />
            <span className="text-caption text-text-muted px-space-2">Google Drive</span>
            <div className="h-px flex-1 bg-border-subtle" />
          </div>

          <div className="space-y-space-3">
            <p className="text-metadata text-text-muted leading-relaxed">
              Cernix keeps a list of what it has already put in Drive, so it never
              offers to upload the same photograph twice. It refreshes that list
              when the app starts. If you have added or removed things in Drive
              from somewhere else, check again now.
            </p>
            <Button
              variant="neutral"
              onClick={async () => {
                setChecking(true)
                try {
                  const { count } = await window.electronAPI.authRebuildLedger()
                  setFound(count)
                  setTimeout(() => setFound(null), 5000)
                } finally {
                  setChecking(false)
                }
              }}
              disabled={checking}
              className={cn('gap-space-2', found !== null && 'text-status-success border-status-success/30')}
            >
              <RefreshCw size={12} className={cn(checking && 'animate-spin')} />
              {checking
                ? 'Checking…'
                : found !== null
                  ? `${found.toLocaleString()} in Drive`
                  : 'Check Drive again'}
            </Button>
          </div>
        </div>


        {/* Section: About. One line, and the only reason it exists is that
          a bug report is useless without a version. Selectable, because
          the point is to paste it into an issue. */}
        <div className="space-y-space-4">
          <div className="flex items-center gap-space-3">
            <div className="h-px flex-1 bg-border-subtle" />
            <span className="text-caption text-text-muted px-space-2">About</span>
            <div className="h-px flex-1 bg-border-subtle" />
          </div>

          <p className="text-metadata text-text-muted leading-relaxed">
            Cernix{' '}
            <span className="font-mono text-text-default select-text">
              {version ?? '…'}
            </span>
            . Quote this when reporting a problem.
          </p>
        </div>

      </div>
    </Modal>
  )
}
