import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useUpdates } from '@/hooks/useUpdates'

/** One id, so a notice is replaced rather than stacked. */
const TOAST_ID = 'update'

/**
 * Says once that a new version is waiting, and lets the user choose when.
 *
 * Nothing restarts on its own: on Windows and Linux the toast offers the
 * restart, and an update the user never accepts is installed the next
 * time they quit. On macOS it offers the release page instead (see
 * services/updater.ts for why the Mac cannot replace itself). Checking,
 * downloading and failing are quiet here; Settings shows them.
 *
 * Renders nothing: the toast is the surface.
 */
export function UpdateNotice() {
  const status = useUpdates()
  /** The version already announced, so a later status does not re-raise it. */
  const announced = useRef<string | null>(null)

  useEffect(() => {
    const state = status?.state
    if (!state || (state.kind !== 'ready' && state.kind !== 'available')) return
    if (announced.current === state.version) return
    announced.current = state.version

    if (state.kind === 'available') {
      toast(`Cernix ${state.version} is out`, {
        id: TOAST_ID,
        duration: Infinity,
        description: 'Download it from the release page and install it over this one.',
        action: { label: 'Download', onClick: () => { void window.electronAPI.updateOpenRelease() } },
      })
      return
    }

    const offerRestart = () => toast(`Cernix ${state.version} is ready`, {
      id: TOAST_ID,
      duration: Infinity,
      description: 'Restart to finish updating, or it installs the next time you quit.',
      action: {
        label: 'Restart',
        onClick: async () => {
          const result = await window.electronAPI.updateInstall()
          // Refused because a restart would cut something short: say
          // what, and put the offer back for when it has finished.
          if (!result.ok) {
            toast.warning(result.reason)
            offerRestart()
          }
        },
      },
    })
    offerRestart()
  }, [status])

  return null
}
