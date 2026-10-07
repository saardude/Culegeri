// Derived state (FRONTEND-SPEC section 4): pure functions over the Query and the catalogue index.
import { t } from '../i18n/en'
import { isUnknownLeaf, UNKNOWN_LEAF, type CatalogIndex } from '../data/catalogIndex'
import { UNKNOWN_COLLECTOR } from '../data/collectors'
import type { Place } from '../types/place'
import type { Song } from '../types/song'
import { placeText } from './placeName'
import {
  deepestPlace,
  GENRE_ORDER,
  PAGE_SIZE,
  PERFORMANCE_IDS,
  placeLevelOf,
  type GenreId,
  type PlaceLevel,
  type Query,
} from './query'
import { sortSongs } from './sort'

export type FacetKey = 'place' | 'q' | 'genre' | 'style' | 'performance' | 'instrument' | 'collector' | 'year' | 'recording' | 'unmapped' | 'journey'
export const FACET_KEYS: FacetKey[] = ['place', 'q', 'genre', 'style', 'performance', 'instrument', 'collector', 'year', 'recording', 'unmapped', 'journey']

export type Predicate = (s: Song) => boolean
export type Counts = Map<string, number>

export interface PlaceNode {
  id: string
  place?: Place
  level: PlaceLevel
  label: string
  count: number
  children: PlaceNode[]
  synthetic?: 'village-unknown' | 'county-unknown'
  mapped: boolean
}

export interface MapPoint {
  placeId: string
  level: 'county' | 'village'
  place: Place
  lat: number
  lon: number
  count: number
  genreCounts: Partial<Record<GenreId, number>>
  dominantGenre: GenreId | null
  yearMin?: number
  yearMax?: number
  unknownYear: number
  audioCount: number
  notationCount: number
  villageCount?: number
  unmappedVillages?: number
  selected: boolean
  highlighted: boolean
}

export interface Chip {
  key: FacetKey | 'country'
  value: string
  label: string
}

export interface Bin {
  from: number
  to: number
  count: number
}

export interface Derived {
  predicates: Record<FacetKey, Predicate>
  filteredSongs: Song[]
  total: number
  sortedSongs: Song[]
  pagedSongs: Song[]
  page: number
  pageCount: number
  facetCounts: { genre: Counts; style: Counts; performance: Counts; instrument: Counts; collector: Counts }
  yearHistogram: Bin[]
  /** Records with a wax-cylinder recording under every filter except the recording filter. */
  cylinderCount: number
  /** Legibility of those records in 20 bins of 0.05 (`from` / `to` in hundredths: 0-4, 5-9, ... 95-100). */
  legibHistogram: Bin[]
  placeTree: PlaceNode[]
  mapLevel: 'county' | 'village'
  mapPoints: MapPoint[]
  unmappedCount: number
  activeChips: Chip[]
  searching: boolean
}

export interface DeriveInput {
  query: Query
  index: CatalogIndex
  /** Ids matching `query.q`; null when the query is too short (no constraint). */
  searchIds: string[] | null
  /** True while a search result for the current `q` is still pending. */
  searching?: boolean
  /** Songs of the selected trip when `query.trip` is set (journey mapper). */
  tripSongIds?: Set<string> | null
  /** Explicit map level; defaults to county unless a county or village is selected. */
  mapLevel?: 'county' | 'village'
  highlightPlaceId?: string
}

const TRUE: Predicate = () => true

/** Country-only predicate (used for "N of M"). */
export function countryPredicate(query: Query): Predicate {
  const c = query.country
  if (!c || c === 'all') return TRUE
  const prefix = c + '/'
  const iso = c.toUpperCase()
  return (s) => {
    const id = s.location.placeId
    if (id) return id === c || id.startsWith(prefix)
    return s.location.country === iso
  }
}

export function placePredicate(query: Query): Predicate {
  const deepest = deepestPlace(query)
  if (!deepest) return TRUE
  if (isUnknownLeaf(deepest)) {
    const parent = deepest.slice(0, -UNKNOWN_LEAF.length - 1)
    if (placeLevelOf(parent) === 'country') {
      const iso = parent.toUpperCase()
      return (s) => !s.location.placeId && s.location.country === iso
    }
    return (s) => s.location.placeId === parent
  }
  if (placeLevelOf(deepest) === 'country') return countryPredicate(query)
  const prefix = deepest + '/'
  return (s) => {
    const id = s.location.placeId
    return id !== null && id !== undefined && (id === deepest || id.startsWith(prefix))
  }
}

export function buildPredicates(input: DeriveInput): Record<FacetKey, Predicate> {
  const { query, searchIds, tripSongIds } = input
  const genre = new Set<string>(query.genre)
  const style = new Set(query.style)
  const instrument = new Set(query.instrument)
  const collector = new Set(query.collector)
  const wantUnknownCollector = collector.has(UNKNOWN_COLLECTOR)
  const search = searchIds ? new Set(searchIds) : null
  const from = query.yearFrom
  const to = query.yearTo
  const lo = query.legibFrom ?? 0
  const hi = query.legibTo ?? 1
  return {
    place: placePredicate(query),
    q: search ? (s) => search.has(s.id) : TRUE,
    genre: genre.size ? (s) => s.genre !== null && genre.has(s.genre) : TRUE,
    style: style.size ? (s) => s.style !== null && style.has(s.style) : TRUE,
    performance: query.performance ? (s) => s.performance === query.performance : TRUE,
    instrument: instrument.size ? (s) => s.instrument.some((i) => instrument.has(i)) : TRUE,
    collector: collector.size ? (s) => (wantUnknownCollector && s.collectors.length === 0) || s.collectors.some((c) => collector.has(c)) : TRUE,
    year:
      from === undefined && to === undefined
        ? TRUE
        : (s) => {
            const y = s.collected.year
            if (y === null) return false
            if (from !== undefined && y < from) return false
            if (to !== undefined && y > to) return false
            return true
          },
    recording: query.cylinder ? (s) => s.legibility !== undefined && s.legibility.score >= lo && s.legibility.score <= hi : TRUE,
    unmapped: query.unmapped ? (s) => s.location.lat === null || s.location.lng === null : TRUE,
    journey: query.trip && tripSongIds ? (s) => tripSongIds.has(s.id) : TRUE,
  }
}

/** Filter with every predicate except `except`. */
export function filterSongs(songs: Song[], predicates: Record<FacetKey, Predicate>, except?: FacetKey): Song[] {
  const active = FACET_KEYS.filter((k) => k !== except && predicates[k] !== TRUE).map((k) => predicates[k])
  if (!active.length) return songs
  return songs.filter((s) => active.every((p) => p(s)))
}

function inc(m: Counts, k: string, n = 1): void {
  m.set(k, (m.get(k) ?? 0) + n)
}

/** Deterministic tree from places.json plus synthetic leaves; counts are "all predicates except place". */
export function buildPlaceTree(index: CatalogIndex, exceptPlace: Song[], selectedCountry: string | undefined): PlaceNode[] {
  const counts: Counts = new Map()
  for (const s of exceptPlace) {
    const id = s.location.placeId
    if (id) {
      const parts = id.split('/')
      for (let i = 1; i <= parts.length; i++) inc(counts, parts.slice(0, i).join('/'))
    } else if (s.location.country) {
      const c = s.location.country.toLowerCase()
      inc(counts, c)
      inc(counts, `${c}/${UNKNOWN_LEAF}`)
    }
  }
  const build = (p: Place): PlaceNode => {
    const children = index.childrenOf(p.id).map(build)
    const level = p.type
    if (level === 'county' && index.songsAt(p.id).length > 0) {
      children.push({
        id: `${p.id}/${UNKNOWN_LEAF}`,
        level: 'village',
        label: t('facet.villageUnknown'),
        count: countExact(exceptPlace, p.id),
        children: [],
        synthetic: 'village-unknown',
        mapped: false,
      })
    }
    if (level === 'country' && counts.has(`${p.id}/${UNKNOWN_LEAF}`)) {
      children.push({
        id: `${p.id}/${UNKNOWN_LEAF}`,
        level: 'region',
        label: t('facet.countyUnknown'),
        count: counts.get(`${p.id}/${UNKNOWN_LEAF}`) ?? 0,
        children: [],
        synthetic: 'county-unknown',
        mapped: false,
      })
    }
    // unresolved regions sort last
    children.sort((a, b) => Number(isUnresolvedNode(a)) - Number(isUnresolvedNode(b)))
    return {
      id: p.id,
      place: p,
      level,
      label: placeText(p, p.id),
      count: counts.get(p.id) ?? 0,
      children,
      mapped: p.lat !== null && p.lng !== null,
    }
  }
  const roots = index.countries.map(build)
  // A country other than the selected one may have count 0 in the current filter; keep it (collapsed by the UI).
  return roots.filter((r) => r.count > 0 || r.id === selectedCountry || index.songsUnder(r.id).length > 0)
}

function isUnresolvedNode(n: PlaceNode): boolean {
  return Boolean(n.synthetic) || n.place?.name === 'unresolved'
}

function countExact(songs: Song[], id: string): number {
  let n = 0
  for (const s of songs) if (s.location.placeId === id) n++
  return n
}

/** Map level: county unless a county or village is selected (or explicitly asked). */
export function mapLevelFor(query: Query, explicit?: 'county' | 'village'): 'county' | 'village' {
  if (explicit) return explicit
  return query.county || query.village ? 'village' : 'county'
}

export function buildMapPoints(
  filtered: Song[],
  index: CatalogIndex,
  level: 'county' | 'village',
  selectedId: string | undefined,
  highlightId: string | undefined,
): { points: MapPoint[]; unmappedCount: number } {
  const groups = new Map<string, Song[]>()
  let unmapped = 0
  for (const s of filtered) {
    const key = groupKey(s, index, level)
    if (!key) {
      unmapped++
      continue
    }
    const list = groups.get(key)
    if (list) list.push(s)
    else groups.set(key, [s])
  }
  const points: MapPoint[] = []
  for (const [id, songs] of groups) {
    const place = index.placeById.get(id)
    if (!place || place.lat === null || place.lng === null) {
      unmapped += songs.length
      continue
    }
    const genreCounts: Partial<Record<GenreId, number>> = {}
    let yearMin: number | undefined
    let yearMax: number | undefined
    let unknownYear = 0
    let audio = 0
    let notation = 0
    const villages = new Set<string>()
    const villagesUnmapped = new Set<string>()
    for (const s of songs) {
      if (s.genre) genreCounts[s.genre] = (genreCounts[s.genre] ?? 0) + 1
      const y = s.collected.year
      if (y === null) unknownYear++
      else {
        if (yearMin === undefined || y < yearMin) yearMin = y
        if (yearMax === undefined || y > yearMax) yearMax = y
      }
      if (s.media.audio.length) audio++
      if (s.media.notation.length) notation++
      if (level === 'county' && s.location.placeId && s.location.placeId !== id) {
        villages.add(s.location.placeId)
        if (s.location.lat === null) villagesUnmapped.add(s.location.placeId)
      }
    }
    let dominant: GenreId | null = null
    for (const g of GENRE_ORDER) {
      const c = genreCounts[g] ?? 0
      if (c > 0 && (dominant === null || c > (genreCounts[dominant] ?? 0))) dominant = g
    }
    points.push({
      placeId: id,
      level,
      place,
      lat: place.lat,
      lon: place.lng,
      count: songs.length,
      genreCounts,
      dominantGenre: dominant,
      yearMin,
      yearMax,
      unknownYear,
      audioCount: audio,
      notationCount: notation,
      villageCount: level === 'county' ? villages.size : undefined,
      unmappedVillages: level === 'county' ? villagesUnmapped.size : undefined,
      selected: id === selectedId,
      highlighted: id === highlightId,
    })
  }
  // north to south for a sensible Tab order
  points.sort((a, b) => b.lat - a.lat || a.lon - b.lon || (a.placeId < b.placeId ? -1 : 1))
  return { points, unmappedCount: unmapped }
}

function groupKey(s: Song, index: CatalogIndex, level: 'county' | 'village'): string | null {
  const id = s.location.placeId
  if (!id) return null
  if (level === 'village') {
    const p = index.placeById.get(id)
    return p && p.type === 'village' ? id : null
  }
  const parts = id.split('/')
  if (parts.length < 3) return null
  const countyId = parts.slice(0, 3).join('/')
  const county = index.placeById.get(countyId)
  return county && county.type === 'county' ? countyId : null
}

export function buildChips(query: Query, index: CatalogIndex): Chip[] {
  const chips: Chip[] = []
  const deepest = deepestPlace(query)
  if (deepest) chips.push({ key: 'place', value: deepest, label: placeChipLabel(deepest, index) })
  for (const g of query.genre) chips.push({ key: 'genre', value: g, label: genreChip(g) })
  for (const s of query.style) chips.push({ key: 'style', value: s, label: s })
  if (query.performance) chips.push({ key: 'performance', value: query.performance, label: query.performance })
  for (const i of query.instrument) chips.push({ key: 'instrument', value: i, label: i })
  for (const c of query.collector) chips.push({ key: 'collector', value: c, label: c === UNKNOWN_COLLECTOR ? t('facet.unknownCollector') : c })
  if (query.yearFrom !== undefined || query.yearTo !== undefined) {
    const label =
      query.yearFrom !== undefined && query.yearTo !== undefined
        ? `${query.yearFrom}-${query.yearTo}`
        : query.yearFrom !== undefined
          ? `from ${query.yearFrom}`
          : `to ${query.yearTo}`
    chips.push({ key: 'year', value: 'year', label })
  }
  if (query.cylinder) {
    const range = query.legibFrom !== undefined || query.legibTo !== undefined
    const label = range
      ? t('facet.cylinderChipRange', { from: (query.legibFrom ?? 0).toFixed(2), to: (query.legibTo ?? 1).toFixed(2) })
      : t('facet.cylinderChip')
    chips.push({ key: 'recording', value: 'cylinder', label })
  }
  if (query.q.trim()) chips.push({ key: 'q', value: query.q.trim(), label: `"${query.q.trim()}"` })
  if (query.unmapped) chips.push({ key: 'unmapped', value: '1', label: t('facet.notMapped') })
  if (query.trip) chips.push({ key: 'journey', value: query.trip, label: query.trip })
  return chips
}

function genreChip(g: GenreId): string {
  return g
}

export function placeChipLabel(id: string, index: CatalogIndex): string {
  if (isUnknownLeaf(id)) {
    const parent = index.placeById.get(id.slice(0, -UNKNOWN_LEAF.length - 1))
    const leaf = parent?.type === 'county' ? t('facet.villageUnknown') : t('facet.countyUnknown')
    return parent ? `${leaf}, ${placeText(parent, parent.id)}` : leaf
  }
  const p = index.placeById.get(id)
  if (!p) return id
  if (p.type === 'village') {
    const county = p.parent ? index.placeById.get(p.parent) : undefined
    const countyName = county && county.type === 'county' ? county.name : null
    return countyName ? `${p.name}, ${countyName}` : p.name
  }
  return placeText(p, p.id)
}

/** The whole derived state in one pass. */
export function derive(input: DeriveInput): Derived {
  const { query, index } = input
  const predicates = buildPredicates(input)
  const songs = index.songs

  // Facet counting in one pass: how many predicates fail per song, and which.
  const genre: Counts = new Map(GENRE_ORDER.map((g) => [g, 0]))
  const style: Counts = new Map(index.styles.map((s) => [s, 0]))
  const performance: Counts = new Map(PERFORMANCE_IDS.map((p) => [p, 0]))
  const instrument: Counts = new Map(index.instruments.map((i) => [i, 0]))
  const collector: Counts = new Map([...index.collectors.map((c): [string, number] => [c, 0]), [UNKNOWN_COLLECTOR, 0]])
  const exceptPlace: Song[] = []
  const exceptYear: Song[] = []
  const exceptRecording: Song[] = []
  const filtered: Song[] = []
  const keys = FACET_KEYS.filter((k) => predicates[k] !== TRUE)
  for (const s of songs) {
    let fails = 0
    let failing: FacetKey | null = null
    for (const k of keys) {
      if (!predicates[k](s)) {
        fails++
        failing = k
        if (fails > 1) break
      }
    }
    if (fails === 0) {
      filtered.push(s)
      exceptPlace.push(s)
      exceptYear.push(s)
      exceptRecording.push(s)
      countFacet(s, 'genre', genre, style, performance, instrument, collector)
      countFacet(s, 'style', genre, style, performance, instrument, collector)
      countFacet(s, 'performance', genre, style, performance, instrument, collector)
      countFacet(s, 'instrument', genre, style, performance, instrument, collector)
      countFacet(s, 'collector', genre, style, performance, instrument, collector)
    } else if (fails === 1 && failing) {
      if (failing === 'place') exceptPlace.push(s)
      else if (failing === 'year') exceptYear.push(s)
      else if (failing === 'recording') exceptRecording.push(s)
      else if (failing === 'genre' || failing === 'style' || failing === 'performance' || failing === 'instrument' || failing === 'collector')
        countFacet(s, failing, genre, style, performance, instrument, collector)
    }
  }

  const total = songs.reduce((n, s) => n + (countryPredicate(query)(s) ? 1 : 0), 0)
  const sorted = sortSongs(filtered, query.sort, query.dir, (id) => index.placeById.get(id))
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, query.page), pageCount)
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const level = mapLevelFor(query, input.mapLevel)
  const selectedId = level === 'village' ? query.village : query.county
  const { points, unmappedCount } = buildMapPoints(filtered, index, level, selectedId, input.highlightPlaceId)

  return {
    predicates,
    filteredSongs: filtered,
    total,
    sortedSongs: sorted,
    pagedSongs: paged,
    page,
    pageCount,
    facetCounts: { genre, style, performance, instrument, collector },
    yearHistogram: histogram(exceptYear, index.yearMin, index.yearMax),
    cylinderCount: exceptRecording.reduce((n, s) => n + (s.legibility ? 1 : 0), 0),
    legibHistogram: legibilityHistogram(exceptRecording),
    placeTree: buildPlaceTree(index, exceptPlace, query.country),
    mapLevel: level,
    mapPoints: points,
    unmappedCount,
    activeChips: buildChips(query, index),
    searching: Boolean(input.searching),
  }
}

function countFacet(
  s: Song,
  facet: 'genre' | 'style' | 'performance' | 'instrument' | 'collector',
  genre: Counts,
  style: Counts,
  performance: Counts,
  instrument: Counts,
  collector: Counts,
): void {
  switch (facet) {
    case 'genre':
      if (s.genre) inc(genre, s.genre)
      else inc(genre, 'null')
      break
    case 'style':
      if (s.style) inc(style, s.style)
      break
    case 'performance':
      inc(performance, s.performance)
      break
    case 'instrument':
      for (const i of s.instrument) inc(instrument, i)
      break
    case 'collector':
      if (s.collectors.length) for (const c of s.collectors) inc(collector, c)
      else inc(collector, UNKNOWN_COLLECTOR)
      break
  }
}

/** Legibility in 20 bins of 0.05; a score of exactly 1 falls in the last bin. */
export function legibilityHistogram(songs: Song[]): Bin[] {
  const bins: Bin[] = Array.from({ length: 20 }, (_, i) => ({ from: i * 5, to: i === 19 ? 100 : i * 5 + 4, count: 0 }))
  for (const s of songs) {
    if (!s.legibility) continue
    bins[Math.min(19, Math.floor(Math.round(s.legibility.score * 100) / 5))].count++
  }
  return bins
}

export function histogram(songs: Song[], min: number | undefined, max: number | undefined): Bin[] {
  if (min === undefined || max === undefined) return []
  const start = Math.floor(min / 5) * 5
  const bins: Bin[] = []
  for (let y = start; y <= max; y += 5) bins.push({ from: y, to: y + 4, count: 0 })
  for (const s of songs) {
    const y = s.collected.year
    if (y === null) continue
    const i = Math.floor((y - start) / 5)
    if (bins[i]) bins[i].count++
  }
  return bins
}

/** Facet counts alone (QA 3.3), computed independently of `derive` for tests and the county page. */
export function facetCounts(input: DeriveInput): Derived['facetCounts'] {
  return derive(input).facetCounts
}
