import React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Share2, Copy, Check, ExternalLink, Globe } from 'lucide-react'
import { Modal } from '@/components/ui/modal'

interface ShareModalProps {
  isOpen: boolean
  onClose: () => void
  folderUrl: string
  folderName: string
}

/** The link to a shared Drive folder, as a QR code and as text: for
 *  handing a gallery to someone standing in front of you. */
export function ShareModal({ isOpen, onClose, folderUrl, folderName }: ShareModalProps) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(folderUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(next) => { if (!next) onClose() }}
      title="Share this folder"
      icon={<Share2 size={14} className="text-secondary" />}
      size="md"
    >
      {/* Industrial Content Area */}
      <div className="flex flex-col items-center space-y-10">
        {/* QR Pattern Layer */}
        <div className={'p-8 bg-white rounded-sm shadow-[0_0_50px_rgba(59,130,246,0.15)] relative group group' /* eslint-disable-line no-restricted-syntax -- design-allow: a QR code needs a pure-white substrate for scanner contrast */}>
           <div className="absolute inset-0 border-2 border-secondary/20 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity" />
           <QRCodeSVG 
             value={folderUrl} 
             size={200} 
             includeMargin={false}
             level="H"
             className="grayscale-0"
           />
        </div>

        {/* Asset Metadata */}
        <div className="w-full text-center space-y-4">
           <div>
              <span className="text-caption font-bold text-muted-foreground/30 uppercase tracking-[0.2em] block mb-1">Folder</span>
              <h2 className="text-label font-medium text-text-emphatic truncate max-w-full px-4">{folderName}</h2>
           </div>
           
           {/* States what sharing did, not a security property. The
               call behind this modal is a Drive permission of
               `{ role: 'reader', type: 'anyone' }`: an open link, with
               no access control and nothing verified. The earlier badge
               read "Public Handshake Verified" under a shield, which
               told the user the opposite of what had happened. */}
           <div className="flex items-center justify-center gap-1.5 py-1.5 px-4 bg-status-warn/10 border border-status-warn/20 rounded-sm w-fit mx-auto">
              <Globe size={10} className="text-status-warn" />
              <span className="text-metadata font-bold text-status-warn uppercase tracking-tight">Anyone with the link can view</span>
           </div>
        </div>

        {/* Interaction Strip */}
        <div className="w-full space-y-3 pt-6 border-t border-overlay-hover">
           <div className="flex items-center gap-2">
              <div className="flex-1 bg-scrim-medium border border-overlay-hover h-8 px-4 flex items-center overflow-hidden">
                 <span className="text-code font-mono text-muted-foreground/40 italic truncate">{folderUrl}</span>
              </div>
              <button /* eslint-disable-line no-restricted-syntax -- design-allow: a copy affordance sized to the link row */ 
                 onClick={handleCopy}
                 className="h-8 w-12 bg-surface-raised border border-overlay-hover hover:bg-overlay-active text-text-muted hover:text-text-emphatic flex items-center justify-center transition-all"
              >
                 {copied ? <Check size={14} className="text-status-success" /> : <Copy size={14} />}
              </button>
              <a 
                 href={folderUrl} 
                 target="_blank" 
                 rel="noopener noreferrer"
                 className="h-8 w-12 bg-surface-raised border border-overlay-hover hover:bg-overlay-active text-text-muted hover:text-text-emphatic flex items-center justify-center transition-all"
              >
                 <ExternalLink size={14} />
              </a>
           </div>
           <p className="text-metadata text-center text-muted-foreground/40 leading-relaxed">Anyone who scans this code can open the folder. No sign-in, no account. The link stays live until you remove access in Google Drive.</p>
        </div>
      </div>

    </Modal>
  )
}
