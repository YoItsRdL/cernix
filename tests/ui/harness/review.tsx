import React from 'react'
import { createRoot } from 'react-dom/client'
import { ReviewView } from '@/components/ReviewView'
import { AppToaster } from '@/components/ui/app-toaster'
import type { ScannedFile } from '@/types'

/**
 * Local Archive, the other of the two libraries.
 *
 * The shared selection model is already driven directly by the
 * `selection` harness, both entry points including the toggle-click one
 * this surface uses. What that cannot reach is this component's
 * destructive path: trashing moves a photograph off the user's card,
 * and the list afterwards is the only thing telling them whether it
 * worked.
 *
 * The interesting case is a partial refusal. Main returns the paths it
 * actually trashed, and anything it refused has to stay visible, or the
 * user believes a file is gone while it is still on the card.
 *
 * The API is stubbed here rather than in `mock-api`, which is built
 * around Drive and knows nothing about a local card.
 */

const FILES: ScannedFile[] = ['a', 'b', 'c', 'd'].map((id, i) => ({
  absolutePath: 'D:\\CARD\\DCIM\\DSC_000' + (i + 1) + '.ARW',
  relativePath: 'DCIM\\DSC_000' + (i + 1) + '.ARW',
  sizeBytes: 1024 * (i + 1),
  mtime: new Date('2026-05-01T10:00:00Z'),
  captureDate: new Date('2026-05-01T10:00:00Z'),
  isUploaded: false,
  camera: id.toUpperCase(),
}))

/** Absolute paths main will refuse. Set per assertion by the suite. */
let refuse: string[] = []

;(window as unknown as { electronAPI: unknown }).electronAPI = {
  mediaTrash: async (paths: string[]) => ({
    trashedPaths: paths.filter(p => !refuse.includes(p)),
    failures: paths.filter(p => refuse.includes(p)).map(p => `forbidden:${p}`),
  }),
  onSweepProgress: () => () => {},
  onSweepComplete: () => () => {},
  onSweepError: () => () => {},
}

function Harness() {
  const [files, setFiles] = React.useState<ScannedFile[]>(FILES)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  const w = window as unknown as Record<string, unknown>
  // By index, not by path: a backslash crossing harness, suite and
  // executeJavaScript needs escaping at three levels and silently
  // becomes an identity escape at the first one it gets wrong.
  w.__refuseIdx = (idx: number[]) => { refuse = idx.map(i => FILES[i].absolutePath) }
  w.__selectIdx = (idx: number[]) => setSelected(new Set(idx.map(i => FILES[i].relativePath)))
  w.__remaining = () => files.map(f => f.relativePath.split(/[\\/]/).pop()).join(',')
  w.__selected = () => [...selected].map(p => p.split(/[\\/]/).pop()).join(',')
  w.__ready = true

  return (
    <>
      <ReviewView
        scannedFiles={files}
        selectedFiles={selected}
        onToggleAll={() => setSelected(new Set(files.map(f => f.relativePath)))}
        onSetSelection={paths => setSelected(new Set(paths))}
        onRemoveFiles={rel => {
          const drop = new Set(rel)
          setFiles(prev => prev.filter(f => !drop.has(f.relativePath)))
          setSelected(prev => new Set([...prev].filter(p => !drop.has(p))))
        }}
        onCancel={() => {}}
        onBeginIngest={() => {}}
      />
      <AppToaster />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
