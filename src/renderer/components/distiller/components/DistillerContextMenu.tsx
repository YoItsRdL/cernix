import React from 'react'
import { ExternalLink, Download, Pencil, Cloud, Trash2, FolderPlus, FolderInput } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MenuItem } from '@/components/ui/menu-item'
import { Separator } from '@/components/ui/separator'
import type { DriveFile, ContextMenuState } from '../distiller-types'

interface DistillerContextMenuProps {
  menu: ContextMenuState | null
  actions: {
    setRenaming: (id: string | null) => void
    setRenameValue: (val: string) => void
    setLightboxId: (id: string) => void
    handleDownloadBatch: (items: Pick<DriveFile, 'id' | 'name'>[]) => void
    handleStageForEditing: (items: Pick<DriveFile, 'id' | 'name'>[]) => void
    handleTrash: (ids: string[]) => void
    setCreatingFolder: (val: boolean) => void
    armMove: (ids: string[]) => void
    onClose: () => void
  }
  /**
   * Ids the move should carry. The right-clicked item alone unless it is
   * part of the current selection, in which case the whole selection
   * moves. Matching what dragging that same tile would do.
   */
  moveIdsFor: (id: string) => string[]
  // Helper to find item name
  getItemName: (id: string) => string
  /** True for video files. Used to hide editor-only actions
   *  (Stage for Editing) since the editor doesn't process video. */
  getItemIsVideo?: (id: string) => boolean
}

/**
 * Right-click menu for a file or folder.
 *
 * MenuItem wraps Radix's DropdownMenuItem, which throws outright if it is
 * rendered without a menu around it. This component used to drop the
 * items into a bare positioned div, so every right-click crashed the view
 * with "`MenuItem` must be used within `Menu`".
 *
 * Radix anchors a menu to a trigger, but a context menu's anchor is the
 * pointer. The trigger below is a zero-size element parked at the click
 * point: real enough for Radix to measure and position against, invisible
 * and untouchable to the user. Going through the primitive rather than
 * hand-rolling the popup is what brings back Escape-to-close,
 * outside-click dismissal, focus handling and arrow-key navigation, none
 * of which the div version had.
 *
 * The first three actions deliberately mirror the metadata sidebar.
 * Same labels, same icons, same order, so the two ways of reaching an
 * asset agree. Below the separator are the actions the sidebar has no
 * room for.
 */
export function DistillerContextMenu({ menu, actions, getItemName, getItemIsVideo, moveIdsFor }: DistillerContextMenuProps) {
  const isVideo = !!menu && menu.type === 'file' && (getItemIsVideo?.(menu.id) ?? false)

  return (
    <DropdownMenu
      open={!!menu}
      onOpenChange={(open) => { if (!open) actions.onClose() }}
    >
      <DropdownMenuTrigger
        aria-hidden
        tabIndex={-1}
        className="fixed w-0 h-0 p-0 m-0 border-0 bg-transparent pointer-events-none"
        style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
      />

      <DropdownMenuContent align="start" sideOffset={2} className="w-48">
        {menu && (
          <>
            {menu.type === 'file' && (
              <>
                <MenuItem
                  icon={<ExternalLink size={14} />}
                  onClick={() => {
                    actions.setLightboxId(menu.id)
                    actions.onClose()
                  }}
                >
                  Preview
                </MenuItem>
                <MenuItem
                  icon={<Download size={14} />}
                  onClick={() => {
                    actions.handleDownloadBatch([{ id: menu.id, name: getItemName(menu.id) }])
                    actions.onClose()
                  }}
                >
                  Download
                </MenuItem>
              </>
            )}

            {/* Arms a destination pick rather than opening a picker: the
                breadcrumbs and folders already on screen are the same
                targets a drag uses, so both routes end in one place. */}
            <MenuItem
              icon={<FolderInput size={14} />}
              onClick={() => {
                actions.armMove(moveIdsFor(menu.id))
                actions.onClose()
              }}
            >
              Move to…
            </MenuItem>

            <MenuItem
              icon={<Pencil size={14} />}
              onClick={() => {
                actions.setRenaming(menu.id)
                actions.setRenameValue(getItemName(menu.id))
                actions.onClose()
              }}
            >
              Rename
            </MenuItem>

            {menu.type === 'file' && !isVideo && (
              <MenuItem
                icon={<Cloud size={14} />}
                onClick={() => {
                  actions.handleStageForEditing([{ id: menu.id, name: getItemName(menu.id) }])
                  actions.onClose()
                }}
              >
                Stage for Editing
              </MenuItem>
            )}

            {menu.type === 'folder' && (
              <MenuItem
                icon={<FolderPlus size={14} />}
                onClick={() => {
                  actions.setCreatingFolder(true)
                  actions.onClose()
                }}
              >
                New Folder Inside
              </MenuItem>
            )}

            <Separator className="my-1" />

            <MenuItem
              icon={<Trash2 size={14} />}
              className="text-status-danger focus:text-status-danger focus:bg-status-danger/10"
              onClick={() => {
                actions.handleTrash([menu.id])
                actions.onClose()
              }}
            >
              Move to Trash
            </MenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
