// The shared Query object, its defaults and invariants (FRONTEND-SPEC section 3).
import type { Song } from '../types/song'
import { roBase } from './normalize'

export type GenreId = NonNullable<Song['genre']>
export type Performance = Song['performance']
export type SortKey = 'title' | 'style' | 'location' | 'year' | 'source' | 'legibility'
export type SortDir = 'asc' | 'desc'
export type BordersMode = '1910' | '1914' | '1920' | 'now' | 'both'

export interface Query {
  q: string
  country?: string
  region?: string
  county?: string
  village?: string
  genre: GenreId[]
  style: string[]
  performance?: Performance
  instrument: string[]
  collector: string[]        // normalised names; `none` selects records with no collector
  yearFrom?: number
  yearTo?: number
  /** Only records with a wax-cylinder recording (they are the records with a legibility score). */
  cylinder?: boolean
  /** Legibility range, 0 to 1 in hundredths; either bound implies `cylinder`. */
  legibFrom?: number
  legibTo?: number
  sort: SortKey
  dir: SortDir
  page: number
  unmapped?: boolean
  trip?: string
  stop?: number
  date?: string
  borders?: BordersMode
}

// No country by default: the map, the counts and the tree cover every country in the data
// (owner decision 2026-09-28, overriding D3). `country` is written only when the user picks one.
export const DEFAULT_QUERY: Query = {
  q: '',
  genre: [],
  style: [],
  instrument: [],
  collector: [],
  sort: 'title',
  dir: 'asc',
  page: 1,
}

export const PAGE_SIZE = 50

/** Fixed genre order used by facets, bars, chips and the URL (UI-COPY 3.1 order for bars). */
export const GENRE_ORDER: GenreId[] = ['bocet', 'colinda', 'doina', 'joc', 'nunta', 'cantec', 'other']
export const GENRE_IDS = new Set<string>(GENRE_ORDER)
export const PERFORMANCE_IDS: Performance[] = ['vocal', 'instrumental', 'mixed', 'unknown']
export const SORT_KEYS: SortKey[] = ['title', 'style', 'location', 'year', 'source', 'legibility']
export const BORDER_MODES: BordersMode[] = ['1910', '1914', '1920', 'now', 'both']

export type PlaceLevel = 'country' | 'region' | 'county' | 'village'
export const PLACE_LEVELS: PlaceLevel[] = ['country', 'region', 'county', 'village']

export function isGenreId(v: string): v is GenreId {
  return GENRE_IDS.has(v)
}
export function isPerformance(v: string): v is Performance {
  return (PERFORMANCE_IDS as string[]).includes(v)
}
export function isSortKey(v: string): v is SortKey {
  return (SORT_KEYS as string[]).includes(v)
}
export function isBordersMode(v: string): v is BordersMode {
  return (BORDER_MODES as string[]).includes(v)
}

/** Ancestors of a place id path, shallowest first, excluding the id itself. */
export function ancestorIds(id: string): string[] {
  const parts = id.split('/')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

export function placeLevelOf(id: string): PlaceLevel | undefined {
  return PLACE_LEVELS[id.split('/').length - 1]
}

/** The deepest place id set on a query (village > county > region > country), ignoring `country = all`. */
export function deepestPlace(q: Pick<Query, 'country' | 'region' | 'county' | 'village'>): string | undefined {
  if (q.village) return q.village
  if (q.county) return q.county
  if (q.region) return q.region
  if (q.country && q.country !== 'all') return q.country
  return undefined
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))].sort((a, b) => roBase.compare(a, b))
}

function sortedGenres(values: string[]): GenreId[] {
  const set = new Set(values.filter(isGenreId))
  return GENRE_ORDER.filter((g) => set.has(g))
}

/** Levels reset when a page-affecting field changes. */
const PAGE_NEUTRAL = new Set<keyof Query>(['page', 'sort', 'dir', 'borders', 'stop'])

/**
 * Apply a patch to a query while enforcing every invariant of FRONTEND-SPEC section 3.
 * Callers never fix up ancestors, ordering or page themselves.
 */
export function applyPatch(base: Query, patch: Partial<Query>): Query {
  const next: Query = { ...base }
  const keys = Object.keys(patch) as (keyof Query)[]

  // Place levels: apply deepest-first so a village patch fills its ancestors and clears nothing above.
  const placePatch: Partial<Query> = {}
  for (const level of ['village', 'county', 'region', 'country'] as const) {
    if (level in patch) placePatch[level] = patch[level]
  }
  if ('village' in placePatch) setPlace(next, 'village', placePatch.village)
  else if ('county' in placePatch) setPlace(next, 'county', placePatch.county)
  else if ('region' in placePatch) setPlace(next, 'region', placePatch.region)
  else if ('country' in placePatch) setPlace(next, 'country', placePatch.country)

  for (const k of keys) {
    switch (k) {
      case 'village':
      case 'county':
      case 'region':
      case 'country':
        break
      case 'q':
        next.q = patch.q ?? ''
        break
      case 'genre':
        next.genre = sortedGenres(patch.genre ?? [])
        break
      case 'style':
        next.style = sortedUnique(patch.style ?? [])
        break
      case 'instrument':
        next.instrument = sortedUnique(patch.instrument ?? [])
        break
      case 'collector':
        next.collector = sortedUnique(patch.collector ?? [])
        break
      case 'performance':
        next.performance = patch.performance
        break
      case 'yearFrom':
        next.yearFrom = intOrUndefined(patch.yearFrom)
        break
      case 'yearTo':
        next.yearTo = intOrUndefined(patch.yearTo)
        break
      case 'cylinder':
        next.cylinder = patch.cylinder ? true : undefined
        break
      case 'legibFrom':
        next.legibFrom = legibOrUndefined(patch.legibFrom, 'from')
        break
      case 'legibTo':
        next.legibTo = legibOrUndefined(patch.legibTo, 'to')
        break
      case 'sort':
        next.sort = patch.sort && isSortKey(patch.sort) ? patch.sort : 'title'
        break
      case 'dir':
        next.dir = patch.dir === 'desc' ? 'desc' : 'asc'
        break
      case 'page':
        next.page = Math.max(1, Math.floor(patch.page ?? 1))
        break
      case 'unmapped':
        next.unmapped = patch.unmapped ? true : undefined
        break
      case 'trip':
        next.trip = patch.trip || undefined
        if (next.trip !== base.trip) {
          next.stop = undefined
          if (next.trip) next.date = undefined
        }
        break
      case 'stop':
        next.stop = intOrUndefined(patch.stop)
        break
      case 'date':
        next.date = patch.date || undefined
        break
      case 'borders':
        next.borders = patch.borders && isBordersMode(patch.borders) ? patch.borders : undefined
        break
    }
  }
  if (!next.trip) next.stop = undefined
  if (next.yearFrom !== undefined && next.yearTo !== undefined && next.yearFrom > next.yearTo) {
    const t = next.yearFrom
    next.yearFrom = next.yearTo
    next.yearTo = t
  }
  if (next.legibFrom !== undefined && next.legibTo !== undefined && next.legibFrom > next.legibTo) {
    const t = next.legibFrom
    next.legibFrom = next.legibTo
    next.legibTo = t
  }
  // Only cylinder records have a score: clearing the cylinder filter clears the range, a range turns it on,
  // and the legibility sort needs it.
  if ('cylinder' in patch && !next.cylinder) next.legibFrom = next.legibTo = undefined
  if (next.legibFrom !== undefined || next.legibTo !== undefined) next.cylinder = true
  if (next.sort === 'legibility' && !next.cylinder) {
    next.sort = 'title'
    next.dir = 'asc' // legibility is sorted clearest first; titles go back to A-Z
  }
  if (next.country === 'all') next.country = undefined
  if (keys.some((k) => !PAGE_NEUTRAL.has(k))) next.page = 1
  return dropUndefined(next)
}

function setPlace(q: Query, level: PlaceLevel, id: string | undefined): void {
  if (level === 'country') {
    q.country = id && id.length > 0 && id !== 'all' ? id : undefined
    q.region = q.county = q.village = undefined
    return
  }
  const below: PlaceLevel[] = PLACE_LEVELS.slice(PLACE_LEVELS.indexOf(level) + 1)
  for (const l of below) q[l] = undefined
  if (!id) {
    q[level] = undefined
    return
  }
  const parts = id.split('/')
  const depth = PLACE_LEVELS.indexOf(level) + 1
  if (parts.length !== depth) {
    // an id at another depth: apply at its own level instead
    const own = placeLevelOf(id)
    if (own && own !== level) {
      setPlace(q, own, id)
      return
    }
  }
  q[level] = id
  const anc = ancestorIds(id)
  q.country = anc[0] ?? parts[0]
  q.region = level === 'region' ? id : anc[1]
  q.county = level === 'county' ? id : level === 'village' ? anc[2] : undefined
  if (level === 'region') q.county = undefined
}

/** Hundredths in [0, 1]; the open end of the scale (0 for from, 1 for to) means "no bound". */
function legibOrUndefined(v: number | undefined, end: 'from' | 'to'): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  const x = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100
  if (end === 'from' && x <= 0) return undefined
  if (end === 'to' && x >= 1) return undefined
  return x
}

function intOrUndefined(v: number | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined
}

function dropUndefined(q: Query): Query {
  const out = {} as Record<string, unknown>
  for (const [k, v] of Object.entries(q)) if (v !== undefined) out[k] = v
  return out as unknown as Query
}

/** Clear everything except sort, dir, borders (and trip when asked), per AC-11. */
export function resetQuery(q: Query, keepTrip = false): Query {
  return dropUndefined({
    ...DEFAULT_QUERY,
    sort: q.sort,
    dir: q.dir,
    borders: q.borders,
    trip: keepTrip ? q.trip : undefined,
  })
}

/** True when nothing but sort/dir/page/borders differs from the default. */
export function hasActiveFilters(q: Query): boolean {
  return Boolean(
    q.q.trim() ||
      q.country ||
      q.region ||
      q.county ||
      q.village ||
      q.genre.length ||
      q.style.length ||
      q.performance ||
      q.instrument.length ||
      q.collector.length ||
      q.yearFrom !== undefined ||
      q.yearTo !== undefined ||
      q.cylinder ||
      q.unmapped ||
      q.trip ||
      q.date,
  )
}

export function queriesEqual(a: Query, b: Query): boolean {
  return JSON.stringify(dropUndefined(a)) === JSON.stringify(dropUndefined(b))
}
