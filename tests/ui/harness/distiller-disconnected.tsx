import React from 'react'
import { createRoot } from 'react-dom/client'
import { Distiller } from '@/components/Distiller'
import { AppToaster } from '@/components/ui/app-toaster'
import { installMockApi } from './mock-api'

/**
 * The Workstation mounted before Drive is connected, which is the state
 * every first run is in: `Distiller` renders unconditionally, so its
 * boot asks for the root folder id while there is no token, and the call
 * rejects.
 *
 * Set before `installMockApi` so the bridge is built already failing.
 */
const w = window as unknown as {
  __failRootId?: boolean
  __emitAuthStatus?: (s: { connected: boolean }) => void
  __connect?: () => void
  __loading?: () => boolean
  __ready?: boolean
}
w.__failRootId = true

installMockApi()

/** Sign in with the app already open, the way the real flow does. */
w.__connect = () => {
  w.__failRootId = false
  w.__emitAuthStatus?.({ connected: true })
}

/**
 * The sidebar's loading row, not the grid's skeleton.
 *
 * The skeleton is gated on the viewport having measured its container,
 * which never happens in this harness, so it reads "not loading" whether
 * the state is settled or stuck. The sidebar renders straight off the
 * same `loading` flag with no such gate.
 */
w.__loading = () => Array.from(document.querySelectorAll('div'))
  .some(d => d.textContent?.trim() === 'Loading')

function Harness() {
  // The runner's mount probe, from an effect rather than during render
  // so it means "on screen" rather than "about to be". No dependency
  // array, so it re-checks as the tree settles.
  //
  // It waits on a control the header renders in every state, connected
  // or not. Waiting on content would report "mounted" only in the case
  // this harness exists to rule out.
  React.useEffect(() => {
    if (document.querySelector('[aria-label="Grid view"]')) w.__ready = true
  })

  return (
    <>
      <Distiller />
      <AppToaster />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
