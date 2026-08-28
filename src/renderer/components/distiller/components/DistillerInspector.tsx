import React from 'react'
import {
  FileText, Image, Film, ExternalLink, Download, Pencil, Check, FolderOpen
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AuthImage } from './AuthImage'
import { getIcon, formatSize, formatDate } from '../utils/distiller-utils'
import { DriveFile, DriveFolder } from '../distiller-types'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Inspector, InspectorRow, InspectorSection } from '@/components/ui/inspector'

interface DistillerInspectorProps {
  focusedId: string | null
  selected: Set<string>
  files: DriveFile[]
  folders: DriveFolder[]
  focusFiles: DriveFile[] | null
  renaming: string | null
  renameValue: string
  actions: {
    setShowInspector: (val: boolean) => void
    setLightboxId: (id: string) => void
    handleDownloadBatch: (items: { id: string; name: string }[]) => void
    setRenaming: (id: string | null) => void
    setRenameValue: (val: string) => void
    handleRename: (id: string) => void
  }
}

export function DistillerInspector({
  focusedId, selected, files, folders, focusFiles, renaming, renameValue,
  actions
}: DistillerInspectorProps) {
  const id = focusedId || (selected.size === 1 ? Array.from(selected)[0] : null)

  const pool = focusFiles ?? files
  const file = id ? pool.find(f => f.id === id) : undefined
  const folder = id ? folders.find(f => f.id === id) : undefined
  const item = file || folder


  return (
    <Inspector
      title="Metadata Inspector"
      icon={<FileText size={12} className="text-text-muted" />}
      onClose={() => actions.setShowInspector(false)}
    >

      {!item ? (
        <div className="h-full flex flex-col items-center justify-center p-space-8 text-center gap-space-4 opacity-30">
          <div className="w-16 h-16 border border-border-strong rounded-soft flex items-center justify-center"><Image size={24} className="text-text-disabled" /></div>
          <p className="text-metadata font-mono tracking-widest uppercase text-text-muted">No Asset Focused</p>
        </div>
      ) : (
        <div className="flex flex-col">
            <div
              onClick={() => file && actions.setLightboxId(file.id)}
              className={cn(
                'aspect-video w-full bg-surface-workspace border-b border-border-subtle relative flex items-center justify-center group overflow-hidden',
                file && 'cursor-zoom-in'
              )}
            >
              {file?.thumbnailLink ? (
                <>
                  <AuthImage url={file.thumbnailLink.replace('=s220', '=s600')} className="w-full h-full object-cover" />
                  {file.mimeType.startsWith('video/') && (
                    <div className="absolute inset-0 flex items-center justify-center bg-scrim-soft">
                      <div className="w-10 h-10 rounded-full bg-overlay-active backdrop-blur-md flex items-center justify-center border border-overlay-strong">
                        <Film size={16} className="text-text-emphatic ml-0.5" />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="opacity-20">{file ? getIcon(file.mimeType) : <FolderOpen size={32} />}</div>
              )}
            </div>

            <InspectorSection>
              <h2 className="text-body font-semibold text-text-emphatic truncate leading-tight mb-space-3 tracking-tight">{item.name}</h2>
              <InspectorRow label="Type" value={file ? file.mimeType.split('/').pop()?.toUpperCase() : 'Folder'} mono />
              <InspectorRow label="Size" value={file ? formatSize(file.size) : ''} mono />
              <InspectorRow label="Created" value={formatDate(item.createdTime)} />
            </InspectorSection>

            <div className="p-space-4 flex flex-col gap-space-2">
              {file && (
                <Button
                  variant="outline"
                  className="w-full gap-space-1.5"
                  onClick={() => actions.setLightboxId(file.id)}
                >
                  <ExternalLink size={14} /> Preview
                </Button>
              )}
              {file && (
                <Button
                  variant="outline"
                  className="w-full gap-space-1.5"
                  onClick={() => actions.handleDownloadBatch([{ id: file.id, name: file.name }])}
                >
                  <Download size={14} /> Download
                </Button>
              )}
              {renaming === item.id ? (
                <div className="flex items-center gap-space-2 mt-space-2">
                  {/* design-allow: Native input pending shadcn Input adoption */}
                  <input /* eslint-disable-line no-restricted-syntax -- design-allow: an inline rename field sized to the inspector row */
                    autoFocus
                    value={renameValue}
                    onChange={e => actions.setRenameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') actions.handleRename(item.id)
                      if (e.key === 'Escape') actions.setRenaming(null)
                    }}
                    className="flex-1 h-8 px-space-2 bg-surface-workspace border border-border-focus text-code text-text-emphatic focus:outline-none rounded-soft"
                  />
                  <IconButton
                    icon={<Check size={14} />}
                    aria-label="Confirm Rename"
                    onClick={() => actions.handleRename(item.id)}
                    className="bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 h-8 w-8"
                  />
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full gap-space-1.5"
                  onClick={() => { actions.setRenaming(item.id); actions.setRenameValue(item.name) }}
                >
                  <Pencil size={14} /> Rename
                </Button>
              )}
            </div>
        </div>
      )}
    </Inspector>
  )
}
