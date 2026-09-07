import React from 'react'
import { createRoot } from 'react-dom/client'
import { DistillerSidebar } from '@/components/distiller/components/DistillerSidebar'
import type { DriveFolder, BreadcrumbItem } from '@/components/distiller/distiller-types'

/**
 * The sidebar alone, driven to the position the report describes:
 * `Cernix / 2026 / September / 06`, a day folder with nothing inside it.
 * The whole panel read "No folders" there.
 *
 * Mounted directly rather than through Distiller so the trail can be set
 * without walking a mock Drive four levels deep, and so what is measured
 * is the sidebar rather than the navigation that led to it.
 */
const TRAIL: BreadcrumbItem[] = [
  { id: 'root', name: 'Cernix' },
  { id: 'y', name: '2026' },
  { id: 'm', name: 'September' },
  { id: 'd', name: '06' },
]

function Harness() {
  const w = window as unknown as Record<string, unknown>
  const [breadcrumbs, setBreadcrumbs] = React.useState<BreadcrumbItem[]>(TRAIL)
  const [folders, setFolders] = React.useState<DriveFolder[]>([])
  const navigations = React.useRef<string[]>([])

  w.__setTrail = (n: number) => setBreadcrumbs(TRAIL.slice(0, n))
  /** A trail `n` deep, for measuring what the indent costs the label. */
  w.__setDeepTrail = (n: number) => setBreadcrumbs(
    Array.from({ length: n }, (_, i) => ({ id: 'deep' + i, name: 'Barcelona-Selects-' + i })))
  /** The label's rendered width in the row at the given depth. */
  w.__labelWidth = (depth: number) => {
    const el = document.querySelectorAll('[role="treeitem"]')[depth]
    const span = el && el.querySelector('span')
    return span ? Math.round(span.getBoundingClientRect().width) : -1
  }
  w.__setChildren = (names: string[]) =>
    setFolders(names.map((name, i) => ({ id: 'c' + i, name } as DriveFolder)))
  w.__navigations = () => navigations.current

  /** Every row, with its indent and whether it is marked as where we are. */
  w.__rows = () =>
    [...document.querySelectorAll('[role="treeitem"]')].map(n => ({
      name: (n.textContent || '').trim(),
      level: Number(n.getAttribute('aria-level')),
      current: n.getAttribute('aria-current') === 'location',
      indent: Math.round(parseFloat(getComputedStyle(n).paddingLeft)),
    }))
  /** How many rows are in the tab order. A tree must be exactly one. */
  w.__tabStops = () =>
    [...document.querySelectorAll('[role="treeitem"]')].filter(n => n.getAttribute('tabindex') === '0').length
  /** The row that holds the tab stop, by name. */
  w.__tabStopName = () => {
    const el = [...document.querySelectorAll('[role="treeitem"]')]
      .find(n => n.getAttribute('tabindex') === '0')
    return el ? (el.textContent || '').trim() : 'none'
  }
  /** Which row has focus right now. */
  w.__focused = () => {
    const a = document.activeElement
    return a && a.getAttribute('role') === 'treeitem' ? (a.textContent || '').trim() : 'none'
  }
  /** Send a key to the tree, as a person at the keyboard would. */
  w.__treeKey = (key: string) => {
    const tree = document.querySelector('[role="tree"]')!
    tree.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  }
  w.__row = (name: string) =>
    [...document.querySelectorAll('[role="treeitem"]')]
      .find(n => (n.textContent || '').trim() === name) as HTMLElement | undefined

  React.useEffect(() => { w.__ready = true })

  return (
    <div style={{ height: 500, display: 'flex' }}>
      <DistillerSidebar
        folders={folders}
        breadcrumbs={breadcrumbs}
        loading={false}
        currentFolderId={breadcrumbs[breadcrumbs.length - 1]?.id ?? null}
        rootFolderId="root"
        actions={{
          navigateToFolder: (f) => { navigations.current = [...navigations.current, 'folder:' + f.name] },
          navigateToBreadcrumb: (i) => { navigations.current = [...navigations.current, 'crumb:' + i] },
          loadContents: () => {},
        }}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
