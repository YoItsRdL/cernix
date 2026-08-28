import * as React from 'react'
import { cn } from '@/lib/utils'
import { Keyboard } from 'lucide-react'
import { Modal } from './ui/modal'
import { SHORTCUT_GROUPS, forPlatform, type Shortcut } from '@/lib/shortcuts'

/**
 * The keyboard reference.
 *
 * One sheet for the whole app rather than one per surface. The editor
 * had its own and it had quietly gone out of date, which is what
 * happens to a second copy of a list nobody is looking at.
 *
 * Reachable from Settings, and from `?` inside the editor.
 */
export function KeyboardShortcuts({
  open, onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      icon={<Keyboard size={14} className="text-text-muted" />}
      description="Every key the app listens for. Text fields always win: nothing here fires while you are typing."
      size="xl"
    >
      {/* A grid, not CSS columns. Multi-column flows overflow sideways,
          so inside a scrolling box it pushed half the groups off the
          right edge behind a horizontal scrollbar: the sheet looked
          complete and was missing two of its four sections. Modal owns
          the scrolling now; this only decides the columns. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-space-6 items-start">
        {SHORTCUT_GROUPS.map(group => (
          <section key={group.title} className="mb-space-5 min-w-0">
            <h3 className="text-caption font-bold text-text-disabled uppercase tracking-widest mb-space-2">
              {group.title}
            </h3>
            {group.note && (
              <p className="text-metadata text-text-muted leading-relaxed mb-space-2">
                {group.note}
              </p>
            )}
            <dl className="space-y-px">
              {group.shortcuts.map(s => (
                <Row key={group.title + s.keys + s.what} shortcut={s} />
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  )
}

function Row({ shortcut }: { shortcut: Shortcut }) {
  return (
    <div className="flex items-baseline justify-between gap-space-4 py-1">
      <dt className="shrink-0 order-2">
        <Keys keys={forPlatform(shortcut.keys)} />
      </dt>
      <dd className="text-metadata text-text-muted min-w-0 order-1">{shortcut.what}</dd>
    </div>
  )
}

/**
 * Renders "mod + A" as separate keycaps, so a chord reads as keys to
 * press rather than as a sentence with a plus sign in it.
 */
function Keys({ keys }: { keys: string }) {
  const parts = keys.split(/\s*\+\s*/)
  return (
    <span className="flex items-center gap-1">
      {parts.map((part, i) => (
        <React.Fragment key={part + i}>
          {i > 0 && <span className="text-text-disabled text-metadata">+</span>}
          <kbd
            className={cn(
              'inline-flex items-center justify-center h-5 min-w-5 px-1.5',
              'rounded-nested border border-border-subtle bg-surface-workspace',
              'text-metadata font-mono text-text-default whitespace-nowrap'
            )}
          >
            {part}
          </kbd>
        </React.Fragment>
      ))}
    </span>
  )
}
