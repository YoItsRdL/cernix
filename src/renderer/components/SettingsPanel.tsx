import { useState, useEffect } from 'react'
import { Settings, Coffee, Keyboard, RefreshCw, Download, RotateCw, LogOut, LogIn, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Modal } from '@/components/ui/modal'
import { ArchiveMove } from './ArchiveMove'
import { AppearanceChoice } from './AppearanceChoice'
import { useUpdates } from '@/hooks/useUpdates'
import type { AuthStatus, UpdateStatus } from '@/types'

interface SettingsPanelProps {
  /** The Drive connection, owned by the app shell; null until main has answered. */
  authStatus: AuthStatus | null
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
export function SettingsPanel({ authStatus, onClose, onShowShortcuts }: SettingsPanelProps) {
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

  // ── Archive ──
  const [archivePath, setArchivePath] = useState<string | null>(null)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    window.electronAPI.archiveInfo().then(a => { if (live) setArchivePath(a.path) }).catch(() => {})
    return () => { live = false }
  }, [])

  // ── Drive ──
  const [checking, setChecking] = useState(false)
  /** How many the last check found, held briefly as the answer. */
  const [found, setFound] = useState<number | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const connected = authStatus?.connected ?? false

  return (
    <Modal
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      title="Settings"
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
            <span className="text-caption text-text-muted px-space-2">Appearance</span>
            <div className="h-px flex-1 bg-border-subtle" />
          </div>

          <div className="space-y-space-3">
            <p className="text-metadata text-text-muted leading-relaxed">
              Follow the system, or keep Cernix light or dark whatever the system does.
            </p>
            <AppearanceChoice />
          </div>
        </div>

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
              place in your workflow, you can buy us a coffee: it changes nothing
              about the app.
            </p>
            <Button
              variant="neutral"
              onClick={() => { void window.electronAPI.supportOpen() }}
              className="gap-space-2"
            >
              <Coffee size={12} />
              Buy us a coffee
            </Button>
          </div>
        </div>

        <div className="space-y-space-4">
          <div className="flex items-center gap-space-3">
            <div className="h-px flex-1 bg-border-subtle" />
            <span className="text-caption text-text-muted px-space-2">Archive</span>
            <div className="h-px flex-1 bg-border-subtle" />
          </div>

          {/* Said in one place: the privacy page tells people their
              photographs are kept on this computer and to copy them out
              before deleting the folder, and nothing showed which folder. */}
          <div className="space-y-space-3">
            <p className="text-metadata text-text-muted leading-relaxed">
              Photographs Cernix copies from a card are kept here, on this
              computer. Copy them elsewhere before deleting this folder or
              uninstalling.
            </p>
            {archivePath && (
              <p className="text-metadata font-mono text-text-default select-text break-all">{archivePath}</p>
            )}
            <Button
              variant="neutral"
              onClick={async () => {
                setArchiveError(null)
                const r = await window.electronAPI.archiveOpen().catch(() => ({ ok: false as const, reason: 'unknown' }))
                if (!r.ok) setArchiveError('The folder could not be opened.')
              }}
              className="gap-space-2"
            >
              <FolderOpen size={12} />
              Open folder
            </Button>
            {archiveError && (
              <p className="text-metadata text-status-danger" role="alert">{archiveError}</p>
            )}
            <ArchiveMove onMoved={setArchivePath} />
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

          {/* The privacy page sends people here to disconnect, and
              there was nothing here. Disconnecting revokes the grant at
              Google and deletes the token Cernix stored; photographs
              already in Drive stay there. */}
          <div className="space-y-space-3">
            <p className="text-metadata text-text-muted leading-relaxed">
              {connected
                ? <>Connected as <span className="text-text-default select-text">{authStatus?.email ?? 'your Google account'}</span>. Disconnecting removes Cernix&rsquo;s access and the sign-in it stored on this computer; what is already in Drive stays there.</>
                : 'Not connected. Cernix works without Drive; connect it to upload and organise there.'}
            </p>
            {connected ? (
              <Button
                variant="neutral"
                onClick={async () => {
                  setDisconnecting(true)
                  try { await window.electronAPI.authDisconnect() } finally { setDisconnecting(false) }
                }}
                disabled={disconnecting}
                className="gap-space-2"
              >
                <LogOut size={12} />
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            ) : (
              <Button
                variant="neutral"
                onClick={() => { void window.electronAPI.authConnect() }}
                className="gap-space-2"
              >
                <LogIn size={12} />
                Connect Google Drive
              </Button>
            )}
          </div>

          {/* Only while connected: signed out it failed with nothing
              said, and the line above already offers Connect. */}
          {connected && (
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
                  setCheckError(null)
                  try {
                    const { count } = await window.electronAPI.authRebuildLedger()
                    setFound(count)
                    setTimeout(() => setFound(null), 5000)
                  } catch {
                    setCheckError('Drive could not be reached. Check the connection and try again.')
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
              {checkError && (
                <p className="text-metadata text-status-danger" role="alert">{checkError}</p>
              )}
            </div>
          )}
        </div>


        <UpdatesSection />

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

/** One line saying where the updater is. */
function describeUpdate(status: UpdateStatus): string {
  if (!status.supported) return 'Updates are checked by the installed app, not by a development build.'
  if (!status.enabled) return 'Off. Cernix makes no update requests.'
  const s = status.state
  switch (s.kind) {
    case 'idle': return 'On.'
    case 'checking': return 'Checking…'
    case 'current': return `Up to date: ${s.version} is the latest.`
    case 'available': return `Cernix ${s.version} is out.`
    case 'downloading': return `Downloading ${s.version}: ${s.percent}%`
    case 'ready': return `Cernix ${s.version} is downloaded and installs when you restart.`
    case 'error': return s.message
  }
}

/**
 * The one network request Cernix makes without being asked, so it is
 * said in full here and can be switched off here. The same words are in
 * the README and the privacy policy.
 */
function UpdatesSection() {
  const status = useUpdates()
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  if (!status) return null

  const isMac = window.electronAPI.platform === 'darwin'
  const state = status.state
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try { await action() } finally { setBusy(false) }
  }

  return (
    <div className="space-y-space-4">
      <div className="flex items-center gap-space-3">
        <div className="h-px flex-1 bg-border-subtle" />
        <span className="text-caption text-text-muted px-space-2">Updates</span>
        <div className="h-px flex-1 bg-border-subtle" />
      </div>

      <div className="space-y-space-3">
        <p className="text-metadata text-text-muted leading-relaxed">
          Cernix asks GitHub, where its releases are published, whether there is
          a newer version: when it starts, and every few hours. GitHub sees your
          address, this version and your system; nothing else is sent.{' '}
          {isMac
            ? 'On a Mac you download a new version yourself, from the link Cernix gives you.'
            : 'A new version downloads in the background and installs when you restart.'}
        </p>

        {/* A label, so the words toggle it as well as the box. */}
        <label className="flex items-center gap-space-2 cursor-pointer">
          <Checkbox
            checked={status.enabled}
            onToggle={() => { void run(() => window.electronAPI.updateSetEnabled(!status.enabled)) }}
            label="Check for updates"
          />
          <span className="text-metadata text-text-default">Check for updates</span>
        </label>

        <p className="text-metadata text-text-muted" aria-live="polite">
          {refused ?? describeUpdate(status)}
        </p>

        {status.supported && status.enabled && (
          <div className="flex flex-wrap gap-space-2">
            {state.kind === 'ready' ? (
              <Button
                variant="neutral"
                className="gap-space-2"
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    const result = await window.electronAPI.updateInstall()
                    setRefused(result.ok ? null : result.reason)
                  })
                }}
              >
                <RotateCw size={12} />
                Restart to update
              </Button>
            ) : state.kind === 'available' ? (
              <Button
                variant="neutral"
                className="gap-space-2"
                onClick={() => { void window.electronAPI.updateOpenRelease() }}
              >
                <Download size={12} />
                Download {state.version}
              </Button>
            ) : (
              <Button
                variant="neutral"
                className="gap-space-2"
                disabled={busy || state.kind === 'checking' || state.kind === 'downloading'}
                onClick={() => { setRefused(null); void run(() => window.electronAPI.updateCheck()) }}
              >
                <RefreshCw size={12} className={cn(state.kind === 'checking' && 'animate-spin')} />
                Check now
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
