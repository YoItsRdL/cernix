import React, { useRef, useState } from 'react'
import { Sparkles, FolderSync, RefreshCw, FolderX, FolderOpen, Folder
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { DriveFolder, BreadcrumbItem } from '../distiller-types'
import { folderTreeRows } from '@/lib/folder-tree'

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
  /** The trail walked to get here. It is the tree's ancestry. */
  breadcrumbs: BreadcrumbItem[]
  loading: boolean
  currentFolderId: string | null
  rootFolderId: string | null
  actions: {
    navigateToFolder: (f: DriveFolder) => void
    navigateToBreadcrumb: (index: number) => void
    loadContents: (id: string) => void
  }
}

export function DistillerSidebar({
  folders, breadcrumbs, loading,
  currentFolderId, rootFolderId, actions
}: DistillerSidebarProps) {
  const rows = folderTreeRows(breadcrumbs, folders)

  /**
   * One tab stop for the tree, arrows to move inside it.
   *
   * `role="tree"` promises this: a reader who is told the widget is a
   * tree presses Down and expects to move. The first version announced
   * the role and left every row an independent tab stop, so crossing a
   * four-deep trail took four presses and Down did nothing at all.
   *
   * The stop defaults to the folder you are in rather than the first
   * row, so tabbing in lands where you already are instead of at the
   * top of a trail you have already walked.
   */
  const treeRef = useRef<HTMLDivElement>(null)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const currentIndex = rows.findIndex(r => r.kind === 'current')
  const tabStop = focusIndex ?? (currentIndex >= 0 ? currentIndex : 0)

  const focusRow = (i: number) => {
    if (rows.length === 0) return
    const next = Math.max(0, Math.min(rows.length - 1, i))
    setFocusIndex(next)
    treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')[next]?.focus()
  }

  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    // Home and End are the tree's, but a modifier means something else
    // is asking for them.
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const from = focusIndex ?? tabStop
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusRow(from + 1); break
      case 'ArrowUp': e.preventDefault(); focusRow(from - 1); break
      case 'Home': e.preventDefault(); focusRow(0); break
      case 'End': e.preventDefault(); focusRow(rows.length - 1); break
      default:
    }
  }
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

      {/* Where you are, and how you got here.
          This listed only the current folder's children, so arriving
          anywhere with none of its own emptied the panel to "No folders"
          — at the point where knowing your position matters most. The
          trail is drawn as the tree now, with the folder you are in
          marked, and children hanging below it. */}
      <div className="flex-1 p-space-3 overflow-y-auto">
        {loading ? (
          <div className="px-space-2 py-1.5 text-metadata text-text-disabled flex items-center gap-space-2">
            <RefreshCw size={12} className="animate-spin" /> Loading
          </div>
        ) : rows.length > 0 ? (
          // `tree` and `treeitem` carry the nesting to a screen reader,
          // which the indent only shows to someone looking at it.
          <div
            ref={treeRef}
            role="tree"
            aria-label="Folders"
            onKeyDown={onTreeKeyDown}
            className="space-y-0.5"
          >
            {rows.map((row, i) => {
              const current = row.kind === 'current'
              return (
                <button /* eslint-disable-line no-restricted-syntax -- design-allow: a full-width sidebar action row, colour-coded by kind */
                  key={'nav-' + row.id}
                  role="treeitem"
                  aria-level={row.depth + 1}
                  // Roving: one row in the tab order at a time, so the
                  // tree is one stop from outside and arrows move within
                  // it. This is also what makes the current row's focus
                  // legitimate rather than an orphan stop on a control
                  // that can never do anything.
                  tabIndex={i === tabStop ? 0 : -1}
                  onFocus={() => setFocusIndex(i)}
                  // `current` rather than `selected`: this says which
                  // folder the grid is showing, not which row is picked.
                  aria-current={current ? 'location' : undefined}
                  // The row you are already in is not a link. Pressing it
                  // would navigate to where you already are, and it stays
                  // focusable so the tree can still be walked.
                  onClick={current
                    ? undefined
                    : row.kind === 'ancestor'
                      ? () => actions.navigateToBreadcrumb(row.crumbIndex ?? 0)
                      : () => actions.navigateToFolder({ id: row.id, name: row.name } as DriveFolder)}
                  className={cn(
                    'w-full flex items-center gap-space-2 px-space-2 py-1.5 text-metadata transition-colors truncate rounded-soft',
                    current
                      ? 'bg-overlay-active text-text-emphatic font-medium cursor-default'
                      : 'text-text-muted hover:text-text-emphatic hover:bg-overlay-hover',
                  )}
                  // Indent by depth. A padding rather than a margin so the
                  // hover and current backgrounds still run the full width
                  // of the panel instead of stepping in with the label.
                  // `indentDepth`, not `depth`: the indent stops at
                  // MAX_INDENT_DEPTH so a deep folder keeps a readable
                  // name, while aria-level above still reports the real
                  // nesting.
                  style={{ paddingLeft: `calc(var(--spacing-space-2) + ${row.indentDepth} * var(--spacing-space-3))` }}
                >
                  {current
                    ? <FolderOpen size={12} className="text-accent-primary shrink-0" />
                    : <Folder size={12} className="text-text-disabled shrink-0" />}
                  <span className="truncate">{row.name}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="px-space-2 py-1.5 text-metadata text-text-disabled">No folders</p>
        )}
      </div>
    </aside>
  )
}
