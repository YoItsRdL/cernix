import React from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsPanel } from '@/components/SettingsPanel'
import { UpdateNotice } from '@/components/UpdateNotice'
import { AppToaster } from '@/components/ui/app-toaster'
import type { UpdateStatus } from '@/types'

/**
 * Settings and the update toast, over a bridge the suite drives.
 *
 * Main owns every decision about updates; what is under test here is
 * that the renderer says each state truthfully and sends the right
 * request back. `__push` plays main announcing a state, `__refuse` makes
 * the next restart come back refused, and `__calls` lists what the
 * renderer asked for.
 */
const calls: string[] = []
const listeners = new Set<(s: UpdateStatus) => void>()
let current: UpdateStatus = {
  enabled: true, supported: true, installsInPlace: true, state: { kind: 'current', version: '1.2.4' },
}
let refusal: string | null = null

const w = window as unknown as Record<string, unknown> & { electronAPI?: Record<string, unknown> }
w.electronAPI = {
  ...(w.electronAPI ?? {}),
  platform: 'win32',
  systemVersion: async () => '1.2.4',
  archiveInfo: async () => ({ path: 'C:/data/staging/library' }),
  archiveOpen: async () => ({ ok: true }),
  archivePickDestination: async () => ({ cancelled: true as const }),
  archiveMove: async () => ({ error: 'not in this harness' }),
  archiveMoveCancel: async () => {},
  onArchiveProgress: () => () => {},
  themePreference: async () => 'system' as const,
  onThemeChanged: () => () => {},
  themeSet: async () => ({ ok: true as const }),
  supportOpen: async () => ({ ok: true }),
  authRebuildLedger: async () => ({ count: 0 }),
  updateStatus: async () => current,
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => { listeners.add(cb); return () => listeners.delete(cb) },
  updateSetEnabled: async (enabled: boolean) => {
    calls.push(`set-enabled:${enabled}`)
    current = { ...current, enabled }
    listeners.forEach(l => l(current))
    return current
  },
  updateCheck: async () => { calls.push('check'); return current },
  updateInstall: async () => {
    calls.push('install')
    return refusal ? { ok: false, reason: refusal } : { ok: true }
  },
  updateOpenRelease: async () => { calls.push('open-release'); return { ok: true } },
}

w.__push = (status: UpdateStatus) => { current = status; listeners.forEach(l => l(status)) }
w.__refuse = (reason: string | null) => { refusal = reason }
w.__platform = (p: string) => { (w.electronAPI as Record<string, unknown>).platform = p }
w.__calls = () => calls.join(',')
/** Every toast on screen, title then description, in order. */
w.__toasts = () => [...document.querySelectorAll('[data-sonner-toast]')].map(t => (t.textContent || '').trim())
/** Presses the action button of the toast whose text includes `text`. */
w.__toastAction = (text: string) => {
  const t = [...document.querySelectorAll('[data-sonner-toast]')].find(n => (n.textContent || '').includes(text))
  const b = t?.querySelector('[data-button]') as HTMLButtonElement | null
  b?.click()
  return !!b
}
/** The Updates section's status line and buttons. */
w.__settings = () => {
  const text = document.body.innerText
  const buttons = [...document.querySelectorAll('[role="dialog"] button')].map(b => (b.textContent || b.getAttribute('aria-label') || '').trim())
  return JSON.stringify({ text, buttons })
}
w.__press = (label: string) => {
  const b = [...document.querySelectorAll('[role="dialog"] button')]
    .find(n => (n.textContent || '').trim() === label || n.getAttribute('aria-label') === label) as HTMLButtonElement | undefined
  b?.click()
  return !!b
}

function Harness() {
  React.useEffect(() => { w.__ready = true })
  return (
    <>
      <SettingsPanel authStatus={null} onClose={() => {}} onShowShortcuts={() => {}} />
      <UpdateNotice />
      <AppToaster />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
