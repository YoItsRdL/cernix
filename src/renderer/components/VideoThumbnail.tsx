import React from 'react'
import { cn } from '@/lib/utils'

// ── Video thumbnails ──
//
// Electron's `nativeImage.createThumbnailFromPath` doesn't decode video
// formats (only common image formats) so the main-process thumbnail
// cache returns an empty result for .mp4/.mov/.avi and the renderer
// has to do its own frame extraction.
//
// Approach: load the file into a hidden <video>, seek to ~1 s in, draw
// the frame onto a sized canvas, hand back a JPEG blob URL. The
// renderer's media-element pipeline is the same one used for the
// in-app DriveVideoPlayer. No new decoder, no FFmpeg dependency.
//
// Used by both the local PhotoGrid (videoUrl = cernix-media://local/…)
// and the Drive Distiller (videoUrl = cernix-media://drive/<id>). The
// component is source-agnostic; whatever URL resolves to playable
// video bytes works.
//
// A module-level LRU keeps the blob URLs across cell remounts so
// scrolling through 100 videos doesn't re-decode each one. Cap is
// modest because each entry holds onto a Blob until revoked.

const VIDEO_THUMB_CACHE = new Map<string, string>()
const VIDEO_THUMB_MAX = 200

function cacheVideoThumb(key: string, blobUrl: string): string {
  const existing = VIDEO_THUMB_CACHE.get(key)
  if (existing) {
    // Same key replaced. Let the prior URL go and adopt the new one.
    URL.revokeObjectURL(existing)
    VIDEO_THUMB_CACHE.delete(key)
  }
  VIDEO_THUMB_CACHE.set(key, blobUrl)
  while (VIDEO_THUMB_CACHE.size > VIDEO_THUMB_MAX) {
    const oldest = VIDEO_THUMB_CACHE.keys().next().value
    if (!oldest) break
    const url = VIDEO_THUMB_CACHE.get(oldest)
    if (url) URL.revokeObjectURL(url)
    VIDEO_THUMB_CACHE.delete(oldest)
  }
  return blobUrl
}

export interface VideoThumbnailProps {
  /** Source URL for the full video file: typically
   *  `cernix-media://local/<encoded-abs-path>` for local files or
   *  `cernix-media://drive/<id>` for Drive files. */
  videoUrl: string
  /** Stable key for the LRU cache: file absolute path for local,
   *  Drive file id for cloud. */
  cacheKey: string
  /** Long-edge target in pixels for the rendered canvas. */
  thumbSize?: number
  /** Visual reflection of the parent tile's selection state. */
  /** Optional className applied to the rendered <img>. */
  imgClassName?: string
  /** Rendered in place of the <img> when frame extraction fails
   *  (rare codec / network error / etc.). */
  fallback?: React.ReactNode
}

export function VideoThumbnail({
  videoUrl,
  cacheKey,
  thumbSize = 256,
  imgClassName,
  fallback,
}: VideoThumbnailProps) {
  const [isVisible, setIsVisible] = React.useState(false)
  const [blobUrl, setBlobUrl] = React.useState<string | null>(() => VIDEO_THUMB_CACHE.get(cacheKey) ?? null)
  const [hasError, setHasError] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '300px' })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    if (!isVisible || blobUrl || hasError) return

    // Already in cache (in case another tile for the same file
    // extracted it while we were off-screen).
    const cached = VIDEO_THUMB_CACHE.get(cacheKey)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a cache hit for an async extraction
    if (cached) { setBlobUrl(cached); return }

    let cancelled = false
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    video.playsInline = true
    video.src = videoUrl

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      video.src = ''
      video.load()
    }
    const onMeta = () => {
      if (cancelled) return
      // 1s in or 10% of duration, whichever is smaller. Far enough
      // past leader frames / black intros to land on real content.
      const t = Math.min(1, (video.duration || 0) * 0.1)
      try { video.currentTime = isFinite(t) ? t : 0 } catch { onError() }
    }
    const onSeeked = () => {
      if (cancelled) return
      try {
        const vw = video.videoWidth || 1
        const vh = video.videoHeight || 1
        const ar = vw / vh
        const w = ar >= 1 ? thumbSize : Math.max(1, Math.round(thumbSize * ar))
        const h = ar >= 1 ? Math.max(1, Math.round(thumbSize / ar)) : thumbSize
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { onError(); return }
        ctx.drawImage(video, 0, 0, w, h)
        canvas.toBlob((blob) => {
          if (cancelled || !blob) { if (!cancelled) onError(); return }
          const url = URL.createObjectURL(blob)
          cacheVideoThumb(cacheKey, url)
          setBlobUrl(url)
          cleanup()
        }, 'image/jpeg', 0.78)
      } catch {
        onError()
      }
    }
    const onError = () => {
      if (cancelled) return
      setHasError(true)
      cleanup()
    }

    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.load()

    return () => { cancelled = true; cleanup() }
  }, [isVisible, blobUrl, hasError, videoUrl, cacheKey, thumbSize])

  return (
    <div ref={ref} className="w-full h-full bg-surface-panel">
      {blobUrl && !hasError && (
        <img
          src={blobUrl}
          alt=""
          className={cn(
            'w-full h-full object-cover',
            imgClassName,
          )}
          decoding="async"
        />
      )}
      {hasError && fallback && (
        <div className="w-full h-full flex items-center justify-center">
          {fallback}
        </div>
      )}
    </div>
  )
}
