import React from 'react'
import { createRoot } from 'react-dom/client'
import { TerminalPanel } from '@/components/TerminalPanel'
import { logActivity, drivePath } from '@/lib/activity-log'

/**
 * The drawer subscribes to seven IPC channels on mount and would throw
 * without them, taking the tree down with it — which is what an empty
 * `#root` and a suite of assertions that all threw turned out to mean.
 * Only the subscriptions are stubbed: each returns its unsubscribe, and
 * none of them ever fires, so what reaches the drawer here can only have
 * come from the activity bus.
 */
const NEVER = () => () => {}
function installLogBridge() {
  const w = window as unknown as { electronAPI?: Record<string, unknown> }
  w.electronAPI = {
    ...(w.electronAPI ?? {}),
    onSweepProgress: NEVER, onSweepComplete: NEVER, onSweepError: NEVER,
    onUploadStarted: NEVER, onUploadProgress: NEVER, onUploadComplete: NEVER,
    onSysLog: NEVER,
  }
}
installLogBridge()

/**
 * The Output drawer, open, with the activity bus wired as the app wires
 * it. What is under test is that a line logged by renderer code reaches
 * the drawer and is legible there — the bus itself is covered by unit
 * tests, and the join between them was what did not exist.
 */
function Harness() {
  const w = window as unknown as Record<string, unknown>
  const [open, setOpen] = React.useState(true)

  // The drawer subscribes on mount; nothing may be logged before that or
  // the test would be asserting on a line that was never delivered.
  w.__log = (source: string, level: string, message: string) =>
    logActivity(source as 'drive', level as 'info', message)
  w.__drivePath = (trail: { name: string }[], leaf?: string) => drivePath(trail, leaf)
  /** Every line on screen, newest last. */
  w.__lines = () =>
    [...document.querySelectorAll('[role="log"] > div')].map(n => (n.textContent || '').trim())
  w.__lineCount = () => document.querySelectorAll('[role="log"] > div').length

  React.useEffect(() => { w.__ready = true })

  return (
    <div style={{ height: 400, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <TerminalPanel isOpen={open} onToggle={() => setOpen(o => !o)} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
