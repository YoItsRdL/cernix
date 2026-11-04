import { useEffect, useState } from 'react'
import { Monitor, Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Choice = 'system' | 'light' | 'dark'

const OPTIONS: { value: Choice; label: string; icon: React.ReactNode }[] = [
  { value: 'system', label: 'System', icon: <Monitor size={12} /> },
  { value: 'light', label: 'Light', icon: <Sun size={12} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={12} /> },
]

/**
 * Light, dark, or whatever the system is set to (decision 29).
 *
 * "System" is the default, and the only way to get back to it once the rail
 * button or the shortcut has made an explicit choice. The choice is read
 * again whenever the theme changes under it, so the highlighted option is
 * never one the rail has since overridden.
 */
export function AppearanceChoice() {
  const [choice, setChoice] = useState<Choice | null>(null)

  useEffect(() => {
    let live = true
    const read = () => { window.electronAPI.themePreference().then(c => { if (live) setChoice(c) }).catch(() => {}) }
    read()
    const off = window.electronAPI.onThemeChanged(read)
    return () => { live = false; off() }
  }, [])

  return (
    <div role="radiogroup" aria-label="Appearance" className="flex flex-wrap gap-space-2">
      {OPTIONS.map(o => (
        <Button
          key={o.value}
          role="radio"
          aria-checked={choice === o.value}
          variant={choice === o.value ? 'primary' : 'neutral'}
          size="sm"
          onClick={() => { setChoice(o.value); void window.electronAPI.themeSet(o.value) }}
          className="gap-space-2"
        >
          {o.icon}
          {o.label}
        </Button>
      ))}
    </div>
  )
}
