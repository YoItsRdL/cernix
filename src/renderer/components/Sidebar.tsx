import React, { useState } from 'react'
import {
  HardDrive,
  Settings,
  Sun,
  Moon,
  User,
  FolderTree,
  Coffee
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { CernixMark } from './CernixMark'
import { motion } from 'framer-motion'

import { type VolumeInfo, type AuthStatus, type TabId } from '@/types'

interface SidebarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  onOpenSettings: () => void
  volumes: VolumeInfo[]
  authStatus: AuthStatus | null
  onConnectCloud: () => void
  onRebuildLedger: () => void
}

export function Sidebar({
  activeTab,
  onTabChange,
  onOpenSettings,
  authStatus,
  onConnectCloud
}: SidebarProps) {
  // Seeded from preload, which applied the class before first paint.
  // This is display state catching up, not the source of truth.
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.electronAPI.themeGet())

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    void window.electronAPI.themeSet(next)
  }
  const [isExpanded, setIsExpanded] = useState(false)

  // Labels fade rather than unmount; see the wordmark note below.
  const expandedLabel = isExpanded ? 'opacity-100' : 'opacity-0'

  return (
    <aside
      className={cn(
        // The export ships a sidebar family. Sidebar, sidebar-border,
        // sidebar-primary, and this is the sidebar. Using it lets the
        // rail follow the theme's own intent instead of borrowing the
        // panel surface.
        'bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col items-start shrink-0 transition-all duration-300 ease-out h-full overflow-hidden whitespace-nowrap',
        isExpanded ? 'w-sidebar' : 'w-rail'
      )}
    >
      {/* Activity Bar Header - Stable Anchor Toggle */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="h-12 w-full flex items-center border-b border-border-subtle transition-colors shrink-0 group cursor-pointer hover:bg-overlay-hover active:bg-overlay-active"
      >
        <div className="w-rail h-full flex items-center justify-center shrink-0">
          {/* The app icon, tile and all, not the bare glyph.

              The tile is the same box an active nav pill occupies, so
              the rail has one chip geometry rather than two. That pill is
              `inset-1` inside a w-rail x h-12 button, which collapsed
              works out to 40 x 40, hence w-10 h-10. If the pill's inset
              or the row height changes, this has to follow; there is no
              shared constant to lean on because the pill is painted as an
              absolutely positioned sibling.

              The row was h-11 until the nav was squared up with the
              h-12 header above it, which is what moved the tile from
              40 x 36 to 40 x 40 and the mark with it.

              The colours are the icon's two, --accent-primary under
              --primary-foreground, which is also the primary button's
              pair, so icon, button and brand stay in step if the palette
              moves.

              The mark is sized off the icon rather than by eye. The
              icon's aperture is 0.594 of its tile and leaves 0.20 of it
              as margin. The ratio to hold is the mark against the tile:
              26 in a 36px tile was 0.722, and 29 in this 40px one is
              0.725, so the tile in the rail and the tile on the desktop
              stay the same drawing at the same proportions.

              It does not dim on hover the way the bare mark did. A
              brand is not a control, and a logo that fades when the
              cursor passes reads as a disabled button. */}
          <span
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-soft shrink-0',
              'bg-accent-primary text-primary-foreground shadow-sm',
              'transition-transform duration-300',
              isExpanded && 'scale-105',
            )}
          >
            <CernixMark size={29} />
          </span>
        </div>

        {/* Wordmark. Fades with the rail rather than being removed, so
            the mark does not jump when the sidebar collapses: it stays
            centred in its own w-rail column either way. */}
        <span
          className={cn(
            // Same padding as the nav labels below, so the wordmark and
            // every nav item start on one vertical line.
            'min-w-0 truncate pl-space-2 pr-space-3',
            'text-label font-semibold tracking-tight text-sidebar-foreground transition-opacity duration-300',
            expandedLabel,
          )}
        >
          Cernix
        </span>
      </div>

      {/* Activity Icons (Primary Workstations) */}
      <div className="flex flex-col items-start w-full flex-1">
        <ActivityButton
          icon={<HardDrive size={18} strokeWidth={1.5} />}
          label="Local Archive"
          active={activeTab === 'library-ingest' || activeTab === 'local'}
          expanded={isExpanded}
          onClick={() => onTabChange('library-ingest')}
        />

        <ActivityButton
          icon={<FolderTree size={18} strokeWidth={1.5} />}
          label="Workstation"
          active={activeTab === 'organize'}
          expanded={isExpanded}
          onClick={() => onTabChange('organize')}
        />
      </div>

      {/* Utility Bottom Strip */}
      <div className="flex flex-col items-start w-full">
        {/* Appearance. In the rail rather than behind Settings: it is a
            display preference, and needing a modal to change how the app
            looks is one step too many. The icon shows the theme it
            switches TO, so the button reads as an action. */}
        <ActivityButton
          icon={theme === 'dark'
            ? <Sun size={18} strokeWidth={1.5} />
            : <Moon size={18} strokeWidth={1.5} />}
          label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          active={false}
          expanded={isExpanded}
          onClick={toggleTheme}
        />
        <ActivityButton
          icon={<User size={18} strokeWidth={1.5} />}
          label="Account"
          active={authStatus?.connected ?? false}
          expanded={isExpanded}
          onClick={onConnectCloud}
          statusDot={authStatus?.connected ? 'on' : 'off'}
        />
        <ActivityButton
          icon={<Settings size={18} strokeWidth={1.5} />}
          label="Settings"
          active={false}
          expanded={isExpanded}
          onClick={onOpenSettings}
        />
        {/* Support. Last in the strip because it is the only control
            here that does nothing to the app, and it reads as an aside
            rather than an equal.

            An ActivityButton rather than anything of its own: this rail
            is the one piece of chrome on every surface, so a control
            that wants to be always available already has a home, and
            reusing it means the tooltip, the focus ring, the hit target
            and the collapse behaviour are the ones the rail already
            proved. A badge or a floating button would be a second
            vocabulary for a lesser thing.

            It opens the page in the system browser and the app never
            contacts the host itself. Nothing here is gated on it. */}
        <ActivityButton
          icon={<Coffee size={18} strokeWidth={1.5} />}
          label="Buy me a coffee"
          active={false}
          expanded={isExpanded}
          onClick={() => { void window.electronAPI.supportOpen() }}
        />
      </div>
    </aside>
  )
}

function ActivityButton({
  icon,
  label,
  active,
  expanded,
  onClick,
  statusDot,
}: {
  icon: React.ReactNode,
  label: string,
  active: boolean,
  expanded: boolean,
  onClick: () => void,
  /** When set, paints a small status dot at the bottom-right of the
   *  icon: success-green for `'on'`, muted disabled for `'off'`. */
  statusDot?: 'on' | 'off'
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={cn(
        // Hover is a CSS class, not framer-motion's whileHover.
        // whileHover writes background-color as an INLINE style, and an
        // inline style outranks every class, so an active background
        // set by class could never paint. That is why the selected item
        // was invisible.
        'w-full h-12 flex items-center transition-colors relative group',
        active
          ? 'text-secondary-foreground font-semibold'
          : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
      )}
    >
      {/* Painted behind the content and inset from the rail edges, so it
          reads as a selected item rather than a change of background.
          Hover gets the same shape, which is why it is an element and
          not a background on the button.

          Every active item in the rail is --secondary, workspace nav and
          utility strip alike. This used to be split by a `tone` prop,
          one colour above and the other below, but the brand tile takes
          --primary, and an active nav in the same colour directly under
          it read as two selected things stacked. The rule is the
          contrast, not the hue: --primary means "the app" and is the
          brand tile's; --secondary means "where you are" and is every
          active item's. They must stay different whichever way round a
          palette assigns them. The prop is gone rather than left with
          one value at every call site. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-1 inset-x-1 rounded-soft transition-colors pointer-events-none',
          active ? 'bg-secondary' : 'group-hover:bg-overlay-hover',
        )}
      />

      <div className="w-rail h-full flex items-center justify-center shrink-0 relative">
        <div className={cn('relative transition-transform duration-200', !expanded && 'group-hover:scale-110')}>
          {icon}
          {statusDot && (
            <span
              aria-hidden
              className={cn(
                'absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-pill ring-2 ring-surface-workspace',
                statusDot === 'on' ? 'bg-status-success' : 'bg-text-disabled'
              )}
            />
          )}
        </div>
      </div>

      <span className={cn(
        // relative so it stacks above the pill, which is absolutely
        // positioned and would otherwise paint over the label.
        //
        // pl-space-2 puts every label on one x, 8px past the icon column.
        // The column is 48 wide and the brand tile inside it is 40, so
        // the tile ends 4px short of where labels used to start. Close
        // enough to read as a collision. Nav glyphs are only 18 wide, so
        // they get more air than the tile does; labels sharing one
        // baseline matters more here than each having the same gap.
        //
        // pr-space-3 keeps the text off the pill's right edge, which is
        // inset by only 4px, and min-w-0 is what lets truncate actually
        // fire inside a flex row.
        'relative min-w-0 truncate pl-space-2 pr-space-3',
        'text-body font-medium tracking-tight transition-all duration-300',
        expanded ? 'opacity-100' : 'opacity-0'
      )}>
        {label}
      </span>

      {!expanded && (
        <div className="absolute left-full ml-3 px-3 py-1.5 bg-surface-workspace border border-accent-primary/10 rounded-none shadow-[0_0_20px_rgba(0,0,0,0.8)] text-code font-mono tracking-widest whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50">          
          {label.toUpperCase()}
        </div>
      )}
    </motion.button>
  )
}
