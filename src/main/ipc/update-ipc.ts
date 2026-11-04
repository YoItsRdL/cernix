import { ipcMain, shell } from 'electron'
import type { UpdateService } from '../services/updater'
import { RELEASES_URL } from '../constants'

/**
 * The update banner and the Settings section. Four operations, and one
 * event (`update:status`) that main sends whenever the state moves.
 */
export function registerUpdateHandlers(updater: UpdateService) {
  ipcMain.handle('update:status', () => updater.status())
  ipcMain.handle('update:set-enabled', (_, enabled: boolean) => updater.setEnabled(enabled === true))
  ipcMain.handle('update:check', () => updater.check())
  ipcMain.handle('update:install', () => updater.install())

  /**
   * The Mac's "Download". The URL is built here from the version main
   * found, never taken from the renderer, so this cannot be used to open
   * anything but a Cernix release page.
   */
  ipcMain.handle('update:open-release', async () => {
    const state = updater.status().state
    await shell.openExternal(state.kind === 'available' ? state.releaseUrl : RELEASES_URL)
    return { ok: true as const }
  })
}
