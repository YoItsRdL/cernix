import { ExternalLink, CheckSquare, Square, FolderSearch, Trash2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { MenuItem } from '@/components/ui/menu-item'
import { Separator } from '@/components/ui/separator'

export interface ReviewMenuState {
  x: number
  y: number
  /** The file right-clicked, by its relative path. */
  path: string
}

interface ReviewContextMenuProps {
  menu: ReviewMenuState | null
  /** Whether the right-clicked file is in the selection now. */
  isSelected: boolean
  /** Trash is the Local Archive's own selection action, so it waits for one the user made. */
  canTrash: boolean
  onOpen: (path: string) => void
  onToggleSelect: (path: string) => void
  onReveal: (path: string) => void
  onTrash: () => void
  onClose: () => void
}

/**
 * Right-click menu for a photograph in the Local Archive (decision 26).
 *
 * The same shell as the Workstation's: a zero-size trigger parked at the
 * pointer, so the menu is Radix's and brings its keyboard handling, outside
 * click and Escape with it. Four actions and no more: Open, Select or
 * Deselect, Show in Explorer, Move to Trash. The right-clicked file is made
 * the selection first when it is not part of it, as Finder does, so Trash
 * acts on what the menu is visibly about.
 */
export function ReviewContextMenu({ menu, isSelected, canTrash, onOpen, onToggleSelect, onReveal, onTrash, onClose }: ReviewContextMenuProps) {
  return (
    <DropdownMenu open={!!menu} onOpenChange={(open) => { if (!open) onClose() }}>
      <DropdownMenuTrigger
        aria-hidden
        tabIndex={-1}
        className="fixed w-0 h-0 p-0 m-0 border-0 bg-transparent pointer-events-none"
        style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
      />
      <DropdownMenuContent align="start" sideOffset={2} className="w-52">
        {menu && (
          <>
            <MenuItem icon={<ExternalLink size={14} />} onClick={() => { onOpen(menu.path); onClose() }}>
              Open
            </MenuItem>
            <MenuItem
              icon={isSelected ? <Square size={14} /> : <CheckSquare size={14} />}
              onClick={() => { onToggleSelect(menu.path); onClose() }}
            >
              {isSelected ? 'Deselect' : 'Select'}
            </MenuItem>
            <MenuItem icon={<FolderSearch size={14} />} onClick={() => { onReveal(menu.path); onClose() }}>
              Show in Explorer
            </MenuItem>
            <Separator className="my-1" />
            <MenuItem
              icon={<Trash2 size={14} />}
              disabled={!canTrash}
              onClick={() => { onTrash(); onClose() }}
              className="text-status-danger"
            >
              Move to Trash
            </MenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
