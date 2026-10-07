// AudioPlayer (FRONTEND-SPEC 9): one native <audio controls preload="none"> per media.audio[] item
// with the cylinder / reference label, a download link and the credit line.
import { useState } from 'react'
import { Link } from 'react-router'
import { cylinderOf, formatLegibility, legibilityBand } from '../../data/legibility'
import { t } from '../../i18n/en'
import type { MediaItem, Song } from '../../types/song'

function basename(url: string): string {
  try {
    const path = new URL(url, 'https://example.invalid').pathname
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)) || url
  } catch {
    return url
  }
}

/** Cylinder / reference label for a recording: caption, else the record's reference code, else the file name. */
export function audioLabel(item: MediaItem, song: Pick<Song, 'source'>): string {
  return item.caption?.trim() || song.source.referenceCode || basename(item.url)
}

/** Legibility of one recording, when it is a scored wax-cylinder track of this record. */
function LegibilityLine({ item, song }: { item: MediaItem; song: Pick<Song, 'legibility'> }) {
  const leg = song.legibility
  const cyl = cylinderOf(item.url)
  const track = leg && cyl ? leg.tracks[cyl.toLowerCase()] : undefined
  if (!leg || !track) return null
  const scoring = cyl?.toLowerCase() === leg.track.toLowerCase()
  const note = track.clip ? (scoring && leg.clipOnly ? t('song.legibilityClipOnly') : t('song.legibilityClip')) : t('song.legibilityNote')
  return (
    <p className="audio__legibility">
      <span className="mono">{cyl}</span>{' '}
      <span className="legib-badge">
        {t('song.legibility', { score: formatLegibility(track.score) })} &middot; {t(`legibility.band.${legibilityBand(track.score)}`)}
      </span>{' '}
      <span className="muted">
        {note} &middot; <Link to="/about#legibility">{t('song.legibilityHow')}</Link>
      </span>
    </p>
  )
}

export function AudioPlayer({
  item,
  song,
  title,
  index,
  total,
}: {
  item: MediaItem
  song: Pick<Song, 'source' | 'legibility'>
  title: string
  index: number
  total: number
}) {
  const [error, setError] = useState(false)
  const label = total > 1 ? `${t('song.audioLabel', { title })} (${t('song.audioOf', { i: index + 1, n: total })})` : t('song.audioLabel', { title })
  const ref = audioLabel(item, song)
  return (
    <figure className="audio">
      <figcaption className="audio__caption">
        <span className="mono">{ref}</span>
        {total > 1 && <span className="muted"> {t('song.audioOf', { i: index + 1, n: total })}</span>}
      </figcaption>
      <LegibilityLine item={item} song={song} />
      {error ? (
        <p className="audio__error" role="status">
          {t('song.audioError')}
        </p>
      ) : (
        <audio controls preload="none" aria-label={label} onError={() => setError(true)}>
          <source src={item.url} type={item.type ?? undefined} />
        </audio>
      )}
      <p className="audio__meta muted">
        <a href={item.url} download target="_blank" rel="noopener noreferrer">
          {t('song.audioDownload')}
        </a>
        <span> &middot; {t('song.audioCredit')}</span>
      </p>
    </figure>
  )
}

export function AudioList({ song, title }: { song: Song; title: string }) {
  const items = song.media.audio
  if (!items.length) return <p className="audio audio--none muted">{t('song.audioNone')}</p>
  return (
    <div className="audio-list">
      {items.map((item, i) => (
        <AudioPlayer key={item.url + i} item={item} song={song} title={title} index={i} total={items.length} />
      ))}
    </div>
  )
}
