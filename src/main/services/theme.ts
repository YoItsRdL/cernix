/**
 * The interface theme: what the person chose, and what that comes to.
 *
 * There are three choices (decision 29): light, dark, and following the
 * system. "System" is the default, so the app is dark at night on a machine
 * that is, with nothing set up. What is stored is the choice, and what is
 * painted is the answer for the moment: the two differ exactly when the
 * choice is "system".
 */
import type { ThemeName } from '../constants'

export type ThemePreference = ThemeName | 'system'

/** The stored value, defaulting to following the system. A value nobody writes counts as none. */
export function parsePreference(raw: string | null | undefined): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

/** What to paint, given the choice and whether the system is dark right now. */
export function effectiveTheme(preference: ThemePreference, systemIsDark: boolean): ThemeName {
  if (preference === 'system') return systemIsDark ? 'dark' : 'light'
  return preference
}
