// The five sort comparators (FRONTEND-SPEC section 5). Unknown keys stay last in both directions.
import type { Place } from '../types/place'
import type { Song } from '../types/song'
import { normalize, roBase, roFull } from './normalize'
import { GENRE_ORDER, type SortDir, type SortKey } from './query'

export const SITE_ORDER: Record<string, number> = { fmbc: 0, bsys: 1, gyuj: 2, rfm: 3 }

export type PlaceLookup = (id: string) => Place | undefined

/** Pre-folded title key (title, then incipit) computed once per record at load time. */
export function titleKey(s: Song): string {
  return normalize(s.title ?? s.incipit ?? '')
}

const keyCache = new WeakMap<Song, string>()
function tkey(s: Song): string {
  let k = keyCache.get(s)
  if (k === undefined) {
    k = titleKey(s)
    keyCache.set(s, k)
  }
  return k
}

/** Compare where null / empty sorts last regardless of direction; `cmp` only sees known values. */
function knownFirst<T>(a: T | null | undefined, b: T | null | undefined, dir: SortDir, cmp: (x: T, y: T) => number): number {
  const an = a === null || a === undefined || a === ''
  const bn = b === null || b === undefined || b === ''
  if (an && bn) return 0
  if (an) return 1
  if (bn) return -1
  const r = cmp(a as T, b as T)
  return dir === 'desc' ? -r : r
}

function byTitle(a: Song, b: Song, dir: SortDir): number {
  // 1. null or empty title last in both directions (AC-14); the incipit only orders those among themselves.
  const ha = a.title && a.title.trim() ? 0 : 1
  const hb = b.title && b.title.trim() ? 0 : 1
  if (ha !== hb) return ha - hb
  const ka = tkey(a)
  const kb = tkey(b)
  let r = knownFirst(ka, kb, dir, (x, y) => roBase.compare(x, y))
  if (r !== 0) return r
  if (ka && kb) {
    r = roFull.compare(a.title ?? a.incipit ?? '', b.title ?? b.incipit ?? '')
    if (r !== 0) return dir === 'desc' ? -r : r
  }
  return 0
}

function byId(a: Song, b: Song): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function placeName(p: Place | undefined): string | null {
  if (!p) return null
  if (p.name === 'unresolved' || p.name === 'unknown') return null
  return p.name || p.nameHistorical || null
}

const LEVEL_INDEX: Record<Place['type'], number> = { country: 0, region: 1, county: 2, village: 3 }

/** [country, region, county, village] names from the place nodes on the record's path (by node type, not depth). */
function levelNames(s: Song, lookup: PlaceLookup): (string | null)[] {
  const id = s.location.placeId
  const parts = id ? id.split('/') : []
  const names: (string | null)[] = [null, null, null, null]
  for (let i = 0; i < parts.length; i++) {
    const p = lookup(parts.slice(0, i + 1).join('/'))
    if (p) names[LEVEL_INDEX[p.type]] = placeName(p)
  }
  // Fall back to the record's own names when the place node is missing.
  if (!names[2] && s.location.county) names[2] = s.location.county
  if (!names[3] && s.location.village) names[3] = s.location.village
  if (!names[0] && s.location.country) names[0] = s.location.country
  if (!names[1] && s.location.region) names[1] = s.location.region
  return names
}

export function comparator(sort: SortKey, dir: SortDir, lookup: PlaceLookup = () => undefined): (a: Song, b: Song) => number {
  const title = (a: Song, b: Song) => byTitle(a, b, dir)
  switch (sort) {
    case 'title':
      return (a, b) => title(a, b) || byId(a, b)
    case 'style':
      return (a, b) =>
        knownFirst(normalize(a.style), normalize(b.style), dir, (x, y) => roBase.compare(x, y)) || title(a, b) || byId(a, b)
    case 'location':
      // AC-16 / QA 3.4 (the tested contract): modern county, then modern village, then title.
      // Country and region are only tie-breaks after that, so counties of every country
      // interleave alphabetically when the country switch is "all".
      return (a, b) => {
        const na = levelNames(a, lookup)
        const nb = levelNames(b, lookup)
        // Records with no county are last in both directions (AC-16).
        const ca = na[2] ? 0 : 1
        const cb = nb[2] ? 0 : 1
        if (ca !== cb) return ca - cb
        for (const i of [2, 3, 0, 1]) {
          const r = knownFirst(na[i], nb[i], dir, (x, y) => roBase.compare(x, y))
          if (r !== 0) return r
        }
        return title(a, b) || byId(a, b)
      }
    case 'year':
      return (a, b) => knownFirst(a.collected.year, b.collected.year, dir, (x, y) => x - y) || title(a, b) || byId(a, b)
    case 'legibility':
      // Unscored records (no wax cylinder) last in both directions; the filter normally hides them.
      return (a, b) => knownFirst(a.legibility?.score, b.legibility?.score, dir, (x, y) => x - y) || title(a, b) || byId(a, b)
    case 'source':
      return (a, b) => {
        const sa = SITE_ORDER[a.source.site] ?? 99
        const sb = SITE_ORDER[b.source.site] ?? 99
        if (sa !== sb) return dir === 'desc' ? sb - sa : sa - sb
        return (
          knownFirst(a.source.volume, b.source.volume, dir, (x, y) => roBase.compare(x, y)) ||
          knownFirst(a.source.number, b.source.number, dir, (x, y) => roBase.compare(x, y)) ||
          knownFirst(a.source.referenceCode, b.source.referenceCode, dir, (x, y) => roBase.compare(x, y)) ||
          byId(a, b)
        )
      }
  }
}

/** Sort a copy of the songs; stable, and identical across engines because every comparator ends with id. */
export function sortSongs(songs: Song[], sort: SortKey, dir: SortDir, lookup?: PlaceLookup): Song[] {
  return [...songs].sort(comparator(sort, dir, lookup))
}

/** Local keys used by the county page tables. */
export function compareGenre(a: Song, b: Song, dir: SortDir): number {
  const ia = a.genre ? GENRE_ORDER.indexOf(a.genre) : null
  const ib = b.genre ? GENRE_ORDER.indexOf(b.genre) : null
  return knownFirst(ia, ib, dir, (x, y) => x - y)
}
