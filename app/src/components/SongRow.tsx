// SongRow / SongList (FRONTEND-SPEC 7). The row is an <li> holding the title link and the
// SourceLink as siblings so both stay separately focusable (section 15).
import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import type { CatalogIndex } from '../data/catalogIndex'
import { formatLegibility, legibilityBand } from '../data/legibility'
import { t } from '../i18n/en'
import { placeText } from '../state/placeName'
import type { Song } from '../types/song'
import { GenreSwatch } from './Genre'
import { SourceLink } from './SourceLink'

/** "Beiuș (Belényes) / Bihor" from the place node when resolved, else from the record's own names. */
export function songPlaceLine(song: Song, index: CatalogIndex | undefined): string {
  const loc = song.location
  const node = loc.placeId && index ? index.placeById.get(loc.placeId) : undefined
  const parts: string[] = []
  if (node && node.type === 'village') {
    if (node.name !== 'unresolved') parts.push(placeText(node, node.id))
    if (node.county) parts.push(node.county)
    else if (node.countyHistorical) parts.push(node.countyHistorical)
  } else {
    const village = loc.village ?? loc.villageHistorical
    if (village) parts.push(loc.village && loc.villageHistorical && loc.village !== loc.villageHistorical ? `${loc.village} (${loc.villageHistorical})` : village)
    const county = loc.county ?? loc.countyHistorical
    if (county) parts.push(loc.county && loc.countyHistorical && loc.county !== loc.countyHistorical ? `${loc.county} (${loc.countyHistorical})` : county)
  }
  if (!parts.length && loc.raw) parts.push(loc.raw)
  return parts.join(' / ')
}

export function songDisplayTitle(song: Song): { text: string; untitled: boolean } {
  const text = song.title?.trim() || song.incipit?.trim()
  return text ? { text, untitled: false } : { text: t('results.noTitle'), untitled: true }
}

export function SongRow({
  song,
  index,
  search,
  selected,
  tabIndex,
  onHover,
  onFocus,
  onKeyDown,
}: {
  song: Song
  index?: CatalogIndex
  search: string
  selected?: boolean
  tabIndex?: number
  onHover?: (placeId: string | null) => void
  onFocus?: () => void
  onKeyDown?: (e: KeyboardEvent<HTMLAnchorElement>) => void
}) {
  const title = songDisplayTitle(song)
  const place = songPlaceLine(song, index)
  const year = song.collected.year ?? t('facet.noDate')
  return (
    <li
      className={`song-row${selected ? ' is-selected' : ''}`}
      data-song-id={song.id}
      onMouseEnter={() => onHover?.(song.location.placeId ?? null)}
      onMouseLeave={() => onHover?.(null)}
    >
      <Link
        className="song-row__main"
        to={{ pathname: `/song/${song.id}`, search }}
        tabIndex={tabIndex}
        onFocus={() => {
          onFocus?.()
          onHover?.(song.location.placeId ?? null)
        }}
        onBlur={() => onHover?.(null)}
        onKeyDown={onKeyDown}
      >
        <span className={`song-row__title${title.untitled ? ' song-row__title--untitled' : ''}`}>
          <GenreSwatch genre={song.genre} size={8} />
          <span>{title.text}</span>
        </span>
        <span className="song-row__meta">
          {place && <span>{place}, </span>}
          <span>{year}</span>
        </span>
      </Link>
      <div className="song-row__side">
        {song.legibility && <LegibilityMeter score={song.legibility.score} />}
        <SourceLink song={song} size="row" />
        <span className="song-row__icons">
          {song.media.audio.length > 0 && (
            <span title={t('results.hasAudio')}>
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M3 6v4h3l4 3V3L6 6H3z" fill="currentColor" />
                <path d="M12 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              <span className="visually-hidden">{t('results.hasAudio')}</span>
            </span>
          )}
          {song.media.notation.length > 0 && (
            <span title={t('results.hasNotation')}>
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M2 4h12M2 7h12M2 10h12M2 13h12" stroke="currentColor" strokeWidth="1" />
                <circle cx="6" cy="10" r="1.6" fill="currentColor" />
                <path d="M7.5 10V4.5l3 1" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              <span className="visually-hidden">{t('results.hasNotation')}</span>
            </span>
          )}
        </span>
      </div>
    </li>
  )
}

export const VIRTUAL_THRESHOLD = 500

export function SongList({
  songs,
  index,
  search,
  selectedId,
  onHover,
}: {
  songs: Song[]
  index?: CatalogIndex
  search: string
  selectedId?: string
  onHover?: (placeId: string | null) => void
}) {
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLOListElement>(null)

  const move = useCallback((from: number, delta: number) => {
    const list = listRef.current
    if (!list) return
    const links = list.querySelectorAll<HTMLAnchorElement>('a.song-row__main')
    const next = Math.min(links.length - 1, Math.max(0, from + delta))
    links[next]?.focus()
  }, [])

  const virtual = songs.length > VIRTUAL_THRESHOLD
  return (
    <ol
      ref={listRef}
      id="results"
      className={`song-list${virtual ? ' song-list--virtual' : ''}`}
      aria-label={t('results.label')}
      tabIndex={-1}
    >
      {songs.map((song, i) => (
        <SongRow
          key={song.id}
          song={song}
          index={index}
          search={search}
          selected={song.id === selectedId}
          tabIndex={i === Math.min(active, songs.length - 1) ? 0 : -1}
          onHover={onHover}
          onFocus={() => setActive(i)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              move(i, 1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              move(i, -1)
            } else if (e.key === 'Home') {
              e.preventDefault()
              move(i, -i)
            } else if (e.key === 'End') {
              e.preventDefault()
              move(i, songs.length)
            }
          }}
        />
      ))}
    </ol>
  )
}

/** Five-step meter and the score, for records with a wax-cylinder recording. */
export function LegibilityMeter({ score }: { score: number }) {
  const label = t('results.legibility', { score: formatLegibility(score), band: t(`legibility.band.${legibilityBand(score)}`) })
  const on = Math.max(1, Math.ceil(score * 5 - 1e-9))
  return (
    <span className="legib-meter" title={label}>
      <span className="legib-meter__bars" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={i <= on ? 'is-on' : undefined} />
        ))}
      </span>
      <span className="legib-meter__score mono" aria-hidden="true">
        {formatLegibility(score)}
      </span>
      <span className="visually-hidden">{label}</span>
    </span>
  )
}
