import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Panel } from '@/components/ui/panel'
import { Toolbar } from '@/components/ui/toolbar'
import { IconButton } from '@/components/ui/icon-button'
import { Camera, Cloud, CloudUpload, Download, HardDrive, Image as ImageIcon, Inbox, Plus, Settings, Share2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { MenuItem } from '@/components/ui/menu-item'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadingState } from '@/components/ui/loading-state'

export function DesignSandbox() {
  return (
    <div className="bg-surface-workspace p-8 min-h-screen text-text-default flex flex-col gap-space-6 overflow-y-auto">
      <h1 className="text-display text-text-emphatic">Design System Primitives</h1>
      
      <section className="flex flex-col gap-space-4">
        <h2 className="text-body text-text-emphatic border-b border-border-subtle pb-2">Buttons</h2>
        <div className="flex flex-wrap gap-4 items-center">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="neutral">Neutral</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="primary" disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap gap-4 items-center">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
        </div>
      </section>

      <section className="flex flex-col gap-space-4">
        <h2 className="text-body text-text-emphatic border-b border-border-subtle pb-2">Icon Buttons</h2>
        <div className="flex flex-wrap gap-4 items-center">
          <IconButton icon={<Settings size={16} />} aria-label="Settings" />
          <IconButton icon={<Camera size={16} />} aria-label="Camera" />
          <IconButton icon={<Share2 size={16} />} aria-label="Share" disabled />
        </div>
      </section>

      <section className="flex flex-col gap-space-4">
        <h2 className="text-body text-text-emphatic border-b border-border-subtle pb-2">Badges (Chips)</h2>
        {/* On chrome: the word, one fill strength for every tone, so no
            state shouts louder than another. */}
        <div className="flex flex-wrap gap-4 items-center">
          <Badge tone="neutral">Neutral</Badge>
          <Badge tone="accent">New</Badge>
          <Badge tone="success">Synced</Badge>
          <Badge tone="warn">Pending</Badge>
          <Badge tone="danger">Failed</Badge>
          <Badge tone="info">Info</Badge>
        </div>

        {/* On media: one ground for every tone, glyphs only, shown over
            the three worst grounds a photograph can offer. If a mark is
            not legible on all of them it is not legible. */}
        <div className="flex flex-wrap gap-4 items-center">
          {['#ffffff', '#000000', '#7f7f7f'].map(bg => ( // eslint-disable-line no-restricted-syntax -- design-allow: the gallery draws its grounds literally, to show what a mark looks like on each
            <div key={bg} className="flex items-center gap-2 p-2 rounded-soft" style={{ background: bg }}>
              <Badge ground="media" shape="mark" tone="accent"><HardDrive size={12} /></Badge>
              <Badge ground="media" shape="mark" tone="warn"><CloudUpload size={12} /></Badge>
              <Badge ground="media" shape="mark" tone="success"><Cloud size={12} /></Badge>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-space-4">
        <h2 className="text-body text-text-emphatic border-b border-border-subtle pb-2">Menus</h2>
        <div className="flex flex-wrap gap-4 items-start">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="neutral">Open Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 bg-surface-raised border border-border-strong rounded-soft p-1">
              <MenuItem icon={<Plus size={14} />}>Add New</MenuItem>
              <MenuItem icon={<Download size={14} />}>Export</MenuItem>
              <MenuItem disabled icon={<Settings size={14} />}>Settings (Disabled)</MenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      <section className="flex flex-col gap-space-4">
        <h2 className="text-body text-text-emphatic border-b border-border-subtle pb-2">State Primitives</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-space-4">
          <div className="bg-surface-panel border border-border-subtle rounded-soft min-h-48 flex items-center justify-center">
            <EmptyState
              icon={<Inbox size={20} strokeWidth={1.5} />}
              title="No presets yet"
              detail="Save your current edit as a preset to see it here."
              action={<Button variant="primary" size="sm">Save current</Button>}
            />
          </div>
          <div className="bg-surface-panel border border-border-subtle rounded-soft min-h-48 flex items-center justify-center">
            <LoadingState
              label="Loading source"
              icon={<ImageIcon size={20} strokeWidth={1.5} />}
              done={4200000}
              total={9600000}
              unit="MB"
            />
          </div>
          <div className="bg-surface-panel border border-border-subtle rounded-soft min-h-48 flex items-center justify-center">
            <ErrorState
              title="Load failed"
              detail="ECONNRESET: check your network and try again."
              action={{ label: 'Retry', onClick: () => {} }}
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-space-4 h-64">
        <h2 className="text-body text-text-emphatic border-b border-border-subtle pb-2">Panel & Toolbar</h2>
        <Panel
          className="w-80 h-full border border-border-subtle rounded-soft"
          header={<span className="text-caption font-bold">LIBRARY PANEL</span>}
          footer={<Button variant="primary" className="w-full">Sync All</Button>}
        >
          <Toolbar 
            left={<span className="text-metadata">Toolbar Left</span>}
            right={<IconButton icon={<Settings size={14} />} aria-label="Toolbar Settings" />}
          />
          <div className="p-space-4 flex flex-col gap-space-2 text-body">
            <div>Panel content body goes here.</div>
            <div className="text-text-muted">It scrolls independently.</div>
          </div>
        </Panel>
      </section>
    </div>
  )
}
