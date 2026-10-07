// CatalogProvider / useCatalog (FRONTEND-SPEC 3.2): loads the content-hashed JSON files once,
// hydrates the slim records, builds the indexes and the search service, exposes status + retry.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { buildIndex, type CatalogIndex } from '../data/catalogIndex'
import { hydrateSongs } from '../data/hydrate'
import { attachLegibility, type LegibilityFile } from '../data/legibility'
import type { SearchService } from '../data/search'
import { createSearchService } from '../data/searchClient'
import { manifest } from './manifest'
import type { Facets } from '../types/facets'
import type { Place } from '../types/place'
import type { Song } from '../types/song'

export interface JourneySummary {
  id: string
  label?: string | null
  dateStart?: string | null
  dateEnd?: string | null
  songIds?: string[]
  stops?: unknown[]
}

export interface CatalogReady {
  status: 'ready'
  songs: Song[]
  places: Place[]
  facets: Facets
  index: CatalogIndex
  search: SearchService
  journeys: JourneySummary[]
  /** Records located in present-day Romania (place id under `ro`, or country RO when unresolved). */
  romaniaCount: number
  /** Records with a scored wax-cylinder recording (`song.legibility` set). */
  cylinderCount: number
}

export type CatalogState = { status: 'loading' } | { status: 'error'; error: Error } | CatalogReady

interface CatalogContextValue {
  state: CatalogState
  retry: () => void
}

const CatalogContext = createContext<CatalogContextValue | null>(null)

async function fetchJson<T>(url: string | undefined, name: string): Promise<T> {
  if (!url) throw new Error(`data file "${name}" is not in the manifest`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} for ${url}`)
  return (await res.json()) as T
}

async function loadCatalog(): Promise<Omit<CatalogReady, 'status' | 'search'>> {
  const [rawSongs, places, facets, journeysFile, legibilityFile] = await Promise.all([
    fetchJson<unknown>(manifest.songs, 'songs'),
    fetchJson<Place[]>(manifest.places, 'places'),
    fetchJson<Facets>(manifest.facets, 'facets'),
    manifest.journeys ? fetchJson<{ journeys?: JourneySummary[] } | JourneySummary[]>(manifest.journeys, 'journeys').catch(() => null) : Promise.resolve(null),
    // optional: without it the explorer simply has no cylinder filter
    manifest.legibility ? fetchJson<LegibilityFile>(manifest.legibility, 'legibility').catch(() => null) : Promise.resolve(null),
  ])
  const songs = hydrateSongs(rawSongs, places)
  const cylinderCount = attachLegibility(songs, legibilityFile)
  const index = buildIndex(songs, places)
  const journeys = Array.isArray(journeysFile) ? journeysFile : (journeysFile?.journeys ?? [])
  let romaniaCount = 0
  for (const s of songs) {
    const id = s.location.placeId
    if (id ? id === 'ro' || id.startsWith('ro/') : s.location.country === 'RO') romaniaCount++
  }
  return { songs, places, facets, index, journeys, romaniaCount, cylinderCount }
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CatalogState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const searchRef = useRef<SearchService | null>(null)

  useEffect(() => {
    let cancelled = false
    loadCatalog()
      .then((loaded) => {
        if (cancelled) return
        searchRef.current?.dispose()
        const search = createSearchService(loaded.songs)
        searchRef.current = search
        setState({ status: 'ready', search, ...loaded })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const error = err instanceof Error ? err : new Error(String(err))
        console.error('catalog: load failed', { message: error.message, attempt })
        setState({ status: 'error', error })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  useEffect(() => () => searchRef.current?.dispose(), [])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])
  const value = useMemo(() => ({ state, retry }), [state, retry])
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

export function useCatalog(): CatalogContextValue {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog must be used inside CatalogProvider')
  return ctx
}

/** The ready catalogue or null while loading / on error. */
export function useCatalogReady(): CatalogReady | null {
  const { state } = useCatalog()
  return state.status === 'ready' ? state : null
}
