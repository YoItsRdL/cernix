import { useEffect, useState } from 'react'
import { Coffee } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { topOverlay } from '@/lib/overlay'

/** Written the moment it opens, so closing the app mid-view still counts
 *  as having been asked. */
const SEEN_KEY = 'cernix.coffee.invited'

/** Long enough for the result on screen to be read before anything is asked. */
const DELAY_MS = 1500

function alreadyInvited(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return true }
}

/**
 * Asks once, after the first import has finished, and never again on
 * that install.
 *
 * It used to ask four seconds after the first launch, before anything
 * had been done: over the first-launch screen, over a card's review,
 * over Settings. Now the caller says when the moment is (an import's end
 * screen), and it still stands down if a dialog is open by then; it is
 * only marked as asked once it has actually been shown.
 *
 * The once-ness is the design rather than a nicety. Cernix gates nothing
 * behind this and says so in its own copy; a box that returned on every
 * launch would be the loudest contradiction of that available, and it
 * would arrive before the user had done any work.
 *
 * Nothing here is remembered anywhere but this machine, and the app
 * never contacts the host: opening the page is main's job, through
 * `supportOpen`.
 */
export function CoffeeInvite({ moment }: { moment: boolean }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!moment || alreadyInvited()) return
    const t = setTimeout(() => {
      if (topOverlay()) return
      try { localStorage.setItem(SEEN_KEY, '1') } catch { /* asked anyway */ }
      setOpen(true)
    }, DELAY_MS)
    return () => clearTimeout(t)
  }, [moment])

  if (!open) return null

  return (
    <Modal
      open
      onOpenChange={(next) => { if (!next) setOpen(false) }}
      title="Made with far too many coffees"
      icon={<Coffee size={14} className="text-text-muted" />}
    >
      <div className="space-y-space-5">
        {/* One sentence. The dialog interrupted someone, so it owes
            them brevity; the only thing it must establish beyond the
            ask is that saying no costs them nothing. */}
        <p className="text-metadata text-text-muted leading-relaxed">
          Cernix is free and open source. If it earns its place in your workflow, consider buying us a coffee as a kind way to say so.
        </p>

        {/* "Maybe later" rather than a greyed-out no: refusing should
            not read as the lesser option.

            `neutral`, which carries an outline drawn from
            `--foreground`. On this dialog its panel fill matches the
            surface behind it, so what reads is the edge, and that is
            the intent: a button with no fill of its own still has to
            state where it is. The landing's dialog does the same. */}
        <div className="flex items-center justify-end gap-space-3">
          <Button variant="neutral" onClick={() => setOpen(false)}>
            Maybe later
          </Button>
          <Button
            onClick={() => {
              void window.electronAPI.supportOpen()
              setOpen(false)
            }}
            className="gap-space-2"
          >
            <Coffee size={12} />
            Support the project
          </Button>
        </div>
      </div>
    </Modal>
  )
}
