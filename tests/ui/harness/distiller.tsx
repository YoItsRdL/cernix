import React from 'react'
import { createRoot } from 'react-dom/client'
import { Distiller } from '@/components/Distiller'
import { AppToaster } from '@/components/ui/app-toaster'
import { installMockApi } from './mock-api'

// AppToaster lives in App, not Distiller, so it has to be mounted
// alongside. Without it toast actions have nowhere to render and the
// undo-from-toast assertions silently find nothing.
installMockApi()

/**
 * The Workstation, with the one thing App owns that changes its
 * behaviour: whether the editor is open over it.
 *
 * The editor is a sibling of Distiller in App, not a child, so this
 * grid cannot see it and kept its keyboard while the editor had focus.
 * The real EditorView is not mounted here — it wants WebGL and a raw
 * file — and it does not need to be: what is under test is whether
 * this surface yields the keyboard when told something is over it.
 */
function Harness() {
  const [editorOpen, setEditorOpen] = React.useState(false)
  const w = window as unknown as Record<string, unknown>
  w.__setEditorOpen = (v: boolean) => setEditorOpen(v)
  w.__editorOpen = () => editorOpen

  // Deliberately no `__ready`. The runner's mount probe ORs it with
  // `__ui.tile("DSC_0001")`, so setting it here would report "mounted"
  // the moment React committed and let the ten existing suites on this
  // harness start before the fixture is on screen. The tile is the
  // stronger probe and it already works.

  return (
    <>
      <Distiller editorOpen={editorOpen} />
      <AppToaster />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
