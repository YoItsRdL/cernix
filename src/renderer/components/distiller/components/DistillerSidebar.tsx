import React, { useState } from 'react'
import { Sparkles, FolderSync, RefreshCw, FolderX, FolderOpen 
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { DriveFolder } from '../distiller-types'

type SidebarColor = 'info' | 'primary' | 'warn' | 'danger' | 'neutral'

interface SidebarActionProps {
  icon: React.ReactNode
  label: string
  color: SidebarColor
  onClick: () => void
  disabled?: boolean
  /** Native `title` attribute: hover tooltip explaining why a row is disabled. */
  title?: string
}

const COLOR_MAP: Record<SidebarColor, { idle: string; disabled: string }> = {
  primary: { idle: 'text-accent-primary hover:text-accent-primary/80', disabled: 'text-accent-primary/30' },
  info:    { idle: 'text-status-info hover:text-status-info/80',       disabled: 'text-status-info/30' },
  warn:    { idle: 'text-status-warn hover:text-status-warn/80',       disabled: 'text-status-warn/30' },
  danger:  { idle: 'text-status-danger hover:text-status-danger/80',   disabled: 'text-status-danger/30' },
  neutral: { idle: 'text-text-muted hover:text-text-emphatic',         disabled: 'text-text-disabled' },
}

function SidebarAction({ icon, label, color, onClick, disabled, title }: SidebarActionProps) {
  const c = COLOR_MAP[color]
  return (
    <button /* eslint-disable-line no-restricted-syntax -- design-allow: a full-width sidebar action row, colour-coded by kind */
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'w-full flex items-center gap-space-3 px-space-2 py-1.5 text-body transition-colors font-medium rounded-soft',
        disabled ? `${c.disabled} cursor-not-allowed` : `${c.idle} hover:bg-overlay-hover`
      )}
    >
      <span className="shrink-0 flex items-center">{icon}</span>
      {label}
    </button>
  )
}

function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-space-3 border-b border-border-subtle space-y-1">
      <div className="px-space-2 pb-1.5 text-caption font-bold text-text-disabled">{label}</div>
      {children}
    </div>
  )
}

interface DistillerSidebarProps {
  folders: DriveFolder[]
  loading: boolean
  currentFolderId: string | null
  rootFolderId: string | null
  actions: {
    navigateToFolder: (f: DriveFolder) => void
    loadContents: (id: string) => void
  }
}

export function DistillerSidebar({
  folders, loading,
  currentFolderId, rootFolderId, actions
}: DistillerSidebarProps) {
  // Both entries mutate the same Drive folder, so one flag guards both:
  // re-entry would race two reorganisations against each other.
  const [busy, setBusy] = useState<'organize' | 'empty' | null>(null)

  const run = async (
    kind: 'organize' | 'empty',
    op: (folderId: string) => Promise<unknown>,
  ) => {
    const targetId = currentFolderId || rootFolderId
    if (!targetId || busy) return
    setBusy(kind)
    try {
      await op(targetId)
      actions.loadContents(targetId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Folder operation failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <aside className="w-52 bg-surface-panel border-r border-border-strong flex flex-col shrink-0 z-10 overflow-hidden">
      <div className="h-12 flex items-center px-space-4 border-b border-border-subtle bg-surface-raised shrink-0">
        <span className="text-caption font-bold text-text-muted flex items-center gap-space-2">
          <FolderSync size={12} className="text-secondary" /> DISTILLER
        </span>
      </div>

      {/* ORGANIZE: structural changes */}
      <SidebarSection label="ORGANIZE">
        <SidebarAction
          icon={busy === 'organize' ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
          label={busy === 'organize' ? 'Sorting…' : 'Organize by Date'}
          color="primary"
          disabled={busy !== null}
          title={busy && busy !== 'organize' ? 'Another folder operation is running' : undefined}
          onClick={() => { void run('organize', id => window.electronAPI.driveOrganizeByDate(id)) }}
        />
      </SidebarSection>

      {/* REMOVE: cleanup operations */}
      <SidebarSection label="REMOVE">
         <SidebarAction
            icon={busy === 'empty' ? <RefreshCw size={14} className="animate-spin" /> : <FolderX size={14} />}
            label={busy === 'empty' ? 'Removing…' : 'Empty Folders'}
            color="neutral"
            disabled={busy !== null}
            title={busy && busy !== 'empty' ? 'Another folder operation is running' : undefined}
            onClick={() => { void run('empty', id => window.electronAPI.driveRemoveEmptyFolders(id)) }}
          />
      </SidebarSection>

      {/* Navigation Folder List */}
      <div className="flex-1 p-space-3 overflow-y-auto">
        {loading ? (
          <div className="px-space-2 py-1.5 text-metadata text-text-disabled flex items-center gap-space-2">
            <RefreshCw size={12} className="animate-spin" /> Loading
          </div>
        ) : folders.length > 0 ? (
          <div className="space-y-0.5">
            {folders.slice(0, 20).map(f => (
              <button /* eslint-disable-line no-restricted-syntax -- design-allow: a full-width sidebar action row, colour-coded by kind */
                key={'nav-' + f.id}
                onClick={() => actions.navigateToFolder(f)}
                className="w-full flex items-center gap-space-2 px-space-2 py-1.5 hover:bg-overlay-hover text-metadata text-text-muted hover:text-text-emphatic transition-colors truncate rounded-soft"
              >
                <FolderOpen size={12} className="text-text-disabled shrink-0" />
                <span className="truncate">{f.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="px-space-2 py-1.5 text-metadata text-text-disabled">No folders</p>
        )}
      </div>
    </aside>
  )
}
