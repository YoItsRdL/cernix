import React from 'react'
import { Lightbox } from '../../Lightbox'
import { DriveVideoPlayer } from './DriveVideoPlayer'
import { AuthImage } from './AuthImage'
import { DriveFile } from '../distiller-types'
import { RatingStars, RatingFlag } from '../../../types'
import type { RatingRecord } from '@/types'
import type { EditorFile } from '@/editor/EditorView'

interface DistillerLightboxProps {
  lightboxId: string | null
  items: DriveFile[]
  ratings: Map<string, RatingRecord>
  /** The grid's selection, so the viewer can show it and change it. */
  selected: Set<string>
  actions: {
    toggleOne: (id: string) => void
    setLightboxId: (id: string | null) => void
    handleSetStars: (id: string, stars: RatingStars | null) => void
    handleSetFlag: (id: string, flag: RatingFlag) => void
    handleTrashBatch: (ids: string[]) => void
    onOpenEditor?: (file: EditorFile) => void
  }
}

export function DistillerLightbox({
  lightboxId, items, ratings, selected, actions
}: DistillerLightboxProps) {
  if (!lightboxId) return null

  const index = items.findIndex(f => f.id === lightboxId)
  const item = index >= 0 ? items[index] : null
  if (!item) return null

  const url = item.thumbnailLink ? item.thumbnailLink.replace('=s220', '=s2000') : null
  const isVideo = item.mimeType.startsWith('video/')

  // Wraps. Reaching the end used to withdraw the arrow, which reads as
  // the control breaking rather than the list ending, and it moves the
  // other arrow's target out from under the cursor mid-pass. Culling
  // goes in circles; the ends of the list are not walls.
  //
  // Still undefined for a single item, where an arrow would be a control
  // that visibly does nothing.
  const canCycle = items.length > 1
  const handleNext = canCycle
    ? () => actions.setLightboxId(items[(index + 1) % items.length].id)
    : undefined
  const handlePrev = canCycle
    ? () => actions.setLightboxId(items[(index - 1 + items.length) % items.length].id)
    : undefined

  const rating = ratings.get(item.id)
  const flag = (rating?.flag ?? null) as RatingFlag

  return (
    <Lightbox
      isOpen={!!lightboxId}
      onClose={() => actions.setLightboxId(null)}
      fileName={item.name}
      // The viewer can tick the photograph it is showing. The chip and
      // the Space binding have existed since this component was written
      // and no surface passed the props, so the control was unreachable
      // and the shortcut sheet's "Space. Select or deselect this one"
      // was a promise nothing could keep.
      isSelected={selected.has(item.id)}
      onToggleSelect={() => actions.toggleOne(item.id)}
      onNext={handleNext}
      onPrev={handlePrev}
      userStars={rating?.userStars ?? null}
      frameKey={item.id}
      flag={flag}
      onSetStars={(s: RatingStars) => actions.handleSetStars(item.id, s)}
      onSetFlag={(f: RatingFlag) => actions.handleSetFlag(item.id, f)}
      onTrash={() => {
        // Close first: the photograph is about to stop existing, and a
        // viewer left open on it would be showing a gap.
        actions.setLightboxId(null)
        actions.handleTrashBatch([item.id])
      }}
      onEdit={!isVideo && actions.onOpenEditor ? () => {
        actions.onOpenEditor?.({
          id: item.id,
          name: item.name,
          modifiedTime: item.modifiedTime || item.createdTime,
          thumbnailLink: item.thumbnailLink
        })
        actions.setLightboxId(null)
      } : undefined}
    >
      {isVideo ? (
        <DriveVideoPlayer fileId={item.id} />
      ) : (
        <AuthImage
          url={url || ''}
          // What the grid asked for, so the viewer can stand on it.
          lowUrl={item.thumbnailLink ? item.thumbnailLink.replace('=s220', '=s400') : undefined}
          className="max-w-full max-h-full object-contain"
        />
      )}
    </Lightbox>
  )
}
