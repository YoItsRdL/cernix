import React, { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

export function DriveVideoPlayer({ fileId, className }: { fileId: string; className?: string }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    // Only ever a "is Drive connected" probe: the token itself was
    // never used, and the stream is fetched by the main process through
    // cernix-media://, which attaches its own credentials. Asking for
    // the bearer token instead put an hour-long Drive credential in the
    // renderer for nothing.
    window.electronAPI.authStatus().then((status) => {
      if (!active) return
      if (!status?.connected) {
        setError('DRIVE_NOT_CONNECTED')
        return
      }
      setVideoUrl(`cernix-media://drive/${fileId}`)
    }).catch((err) => {
      if (active) setError(err.message || 'AUTH_INVOKE_FAILED')
    })
    return () => { active = false }
  }, [fileId])

  if (error) return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-code text-status-danger/80 font-mono tracking-widest uppercase">Media Access Error</div>
      <div className="text-micro text-text-disabled font-mono uppercase">{error}</div>
    </div>
  )
  
  if (!videoUrl) return <div className="text-code text-text-disabled font-mono tracking-widest animate-pulse">ESTABLISHING_STREAM…</div>

  return (
    <video 
      src={videoUrl} 
      controls 
      autoPlay 
      className={cn('max-w-full max-h-full outline-none bg-black ring-1 ring-overlay-active object-contain', className)} // eslint-disable-line no-restricted-syntax -- design-allow: true black letterbox is the standard video-player backdrop
      onError={() => setError('STREAM_READ_FAILURE')}
    />
  )
}
