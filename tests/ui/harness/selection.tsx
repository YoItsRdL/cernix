import React from 'react'
import { createRoot } from 'react-dom/client'
import { useListSelection } from '@/hooks/useListSelection'

const IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

/** Drives the hook directly: the model, without a grid in the way. */
function Harness() {
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const { handleSelectClick, handleToggleClick } = useListSelection({
    orderedIds: IDS,
    selected,
    onChange: ids => setSelected(new Set(ids)),
  })
  const w = window as unknown as Record<string, unknown>
  w.__click = (id: string, mods: Record<string, boolean>) => handleSelectClick(id, mods as never)
  // The entry point Local Archive uses, where the tile is the checkbox.
  w.__toggleClick = (id: string, mods: Record<string, boolean>) => handleToggleClick(id, mods as never)
  w.__sel = () => [...selected].join(',')
  return <div id="ready">{[...selected].join(',')}</div>
}

createRoot(document.getElementById('root')!).render(<Harness />)
