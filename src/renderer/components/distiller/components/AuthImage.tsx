import React, { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { MediaPlaceholder } from '@/components/ui/frame-ground'
import { useDeferredLoading } from '@/hooks/useDeferredLoading'

const thumbnailCache = new Map<string, string>()
const thumbnailInflight = new Map<string, Promise<string | null>>()
const THUMBNAIL_CACHE_MAX = 500

function getCachedThumbnail(url: string): Promise<string | null> {
  const cached = thumbnailCache.get(url)
  if (cached) {
    thumbnailCache.delete(url)
    thumbnailCache.set(url, cached)
    return Promise.resolve(cached)
  }
  const inflight = thumbnailInflight.get(url)
  if (inflight) return inflight

  const p = window.electronAPI.driveGetThumbnail(url).then(data => {
    thumbnailInflight.delete(url)
    if (data) {
      thumbnailCache.set(url, data)
      if (thumbnailCache.size > THUMBNAIL_CACHE_MAX) {
        const oldest = thumbnailCache.keys().next().value
        if (oldest) thumbnailCache.delete(oldest)
      }
    }
    return data
  })
  thumbnailInflight.set(url, p)
  return p
}

export function AuthImage({ url, lowUrl, className }: { url: string; lowUrl?: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(() => thumbnailCache.get(url) ?? null)
  const [isVisible, setIsVisible] = useState(false)
  // The smaller thumbnail the grid already fetched, read straight out of
  // the cache. The viewer asks for =s2000 while the tiles asked for
  // =s400, so opening a photograph showed nothing even though a
  // perfectly good picture of it was already in memory.
  const low = lowUrl ? thumbnailCache.get(lowUrl) ?? null : null
  const waiting = useDeferredLoading(!src && !low)
  const imgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // The url is a prop, not an identity: arrowing to the next
    // photograph re-renders this component rather than remounting it,
    // and `src` held the PREVIOUS frame until the new one arrived. The
    // viewer showed the wrong photograph and then swapped, which is
    // worse than showing nothing. A cull is a decision about the frame
    // in front of you.
    //
    // Cleared in the same pass that takes a cache hit, so a thumbnail
    // already decoded never blinks through a placeholder.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above: clearing here is what stops the previous photograph showing
    setSrc(thumbnailCache.get(url) ?? null)
    if (thumbnailCache.has(url)) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '300px' })

    if (imgRef.current) observer.observe(imgRef.current)
    return () => observer.disconnect()
  }, [url])

  useEffect(() => {
    if (!isVisible || !url) return
    let active = true
    getCachedThumbnail(url).then(data => {
      if (active && data) setSrc(data)
    })
    return () => { active = false }
  }, [url, isVisible])

  return (
    <div ref={imgRef} className={cn('w-full h-full overflow-hidden', className)}>
      {src ? (
        <img src={src} className={cn('w-full h-full', className)} alt="" loading="lazy" decoding="async" />
      ) : low ? (
        // Soft, because it is being shown larger than it was made, and
        // that is the whole signal: a photograph that sharpens reads as
        // arriving, where a grey box reads as waiting.
        <img src={low} aria-hidden className={cn('w-full h-full', className)} alt="" decoding="async" />
      ) : (
        // Deferred, so a thumbnail already in the cache does not flash
        // grey on its way in. Nothing on screen for the first fraction
        // of a second is the deliberate half of that trade.
        waiting ? <MediaPlaceholder /> : null
      )}
    </div>
  )
}
