import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from './icon-button'

/**
 * The application's modal.
 *
 * There were three, written three times: Settings, Share, and the
 * keyboard sheet. They disagreed about the scrim, the corner radius,
 * the header, and (the part that actually broke) how high they sit.
 * Settings claimed `z-[1000]`, the keyboard sheet inherited `z-50` from
 * the dialog primitive, and opening one from inside the other put it
 * behind. The z-values across the app ran 50, 60, 100, 200, 500, 999,
 * 1000: seven numbers, none of them chosen against each other.
 *
 * So there is one shell, and it owns the stacking. A modal is a title,
 * an icon and a body; nothing at a call site should be deciding how
 * high it floats.
 *
 * Built on Radix rather than a bare motion.div, which is what Settings
 * was. That is not a preference. A hand-rolled overlay has no focus
 * trap, so Tab walked straight out of the dialog into the application
 * behind it, and a screen reader was never told a dialog had opened.
 */

/**
 * Above every surface in the app, and the only place that number is
 * written down. Panels, headers and drop targets all live below 100.
 */
const MODAL_LAYER = 'z-[1000]'

export interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Shown in the header bar. */
  title: string
  /** Optional glyph before the title. */
  icon?: React.ReactNode
  /** Sentence under the title, for anything the body assumes. */
  description?: string
  /** Header-bar content before the close button. */
  actions?: React.ReactNode
  /** Tailwind max-width for the card. */
  size?: 'md' | 'lg' | 'xl'
  className?: string
  children: React.ReactNode
}

const SIZES = {
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-3xl',
} as const

export function Modal({
  open, onOpenChange, title, icon, description, actions,
  size = 'lg', className, children,
}: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 bg-scrim', MODAL_LAYER,
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0'
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2', MODAL_LAYER,
            'w-[calc(100%-var(--spacing-space-6)*2)]', SIZES[size],
            // Never taller than the window. Centred by a -50% translate,
            // so a card that outgrows the viewport does not scroll. It
            // hangs off both ends at once, out of reach. The body
            // scrolls instead.
            'max-h-[85vh]',
            'bg-surface-panel border border-border-subtle shadow-2xl rounded-soft',
            'flex flex-col overflow-hidden',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            className
          )}
        >
          {/* The same 40px bar Settings has always had. It is the one
              piece of chrome every modal shares, so it is the one piece
              that must not be re-invented. */}
          <div className="h-10 shrink-0 border-b border-border-subtle bg-surface-raised flex items-center gap-space-3 px-space-4">
            {icon}
            <DialogPrimitive.Title className="text-caption font-bold text-text-muted flex-1 min-w-0 truncate">
              {title}
            </DialogPrimitive.Title>
            {actions}
            <DialogPrimitive.Close asChild>
              <IconButton icon={<X size={14} />} aria-label={`Close ${title}`} />
            </DialogPrimitive.Close>
          </div>

          {description ? (
            <DialogPrimitive.Description className="px-space-6 pt-space-4 text-metadata text-text-muted leading-relaxed">
              {description}
            </DialogPrimitive.Description>
          ) : (
            // Radix warns when a dialog has no description. The warning
            // is right in principle and noise here, where the header
            // already names the thing.
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto p-space-6">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
