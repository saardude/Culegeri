// FilterRail (FRONTEND-SPEC 7): place tree, collector, recording, genre, style, performance, instrument, year, Clear all.
// Also used inside the FilterSheet under 1024 px. All controls are disabled while loading (AC-31).
import { useEffect, useRef, type ReactNode } from 'react'
import { useCatalogReady } from '../../app/catalog'
import { useDerived, useQuery } from '../../app/query'
import { instrumentLabel, melodies, performanceLabel, styleLabel, t } from '../../i18n/en'
import { hasActiveFilters, PERFORMANCE_IDS, type GenreId, type Performance } from '../../state/query'
import { CheckboxFacet } from './CheckboxFacet'
import { CollectorFacet } from './CollectorFacet'
import { ChipFacet } from './ChipFacet'
import { FacetGroup } from './FacetGroup'
import { PlaceTree } from './PlaceTree'
import { RecordingFacet } from './RecordingFacet'
import { YearRange } from './YearRange'

export function FilterRailContent() {
  const catalog = useCatalogReady()
  const derived = useDerived()
  const { query, setQuery, reset } = useQuery()

  if (!catalog || !derived) {
    return (
      <fieldset disabled style={{ border: 0, padding: 0, margin: 0 }} aria-busy="true">
        <FacetGroup id="place" title={t('facet.place')} activeCount={0}>
          <p className="muted">{t('loadingCollection')}</p>
        </FacetGroup>
        <FacetGroup id="genre" title={t('facet.genre')} activeCount={0}>
          <p className="muted">&nbsp;</p>
        </FacetGroup>
      </fieldset>
    )
  }
  const { index } = catalog
  const yearActive = (query.yearFrom !== undefined ? 1 : 0) + (query.yearTo !== undefined ? 1 : 0)
  const recordingActive = query.cylinder ? 1 : 0
  return (
    <>
      <PlaceFacet />
      <FacetGroup id="collector" title={t('facet.collector')} activeCount={query.collector.length} onClear={() => setQuery({ collector: [] })}>
        <CollectorFacet values={index.collectors} counts={derived.facetCounts.collector} selected={query.collector} onChange={(collector) => setQuery({ collector })} />
      </FacetGroup>
      {catalog.cylinderCount > 0 && (
        <FacetGroup id="recording" title={t('facet.recording')} activeCount={recordingActive} onClear={() => setQuery({ cylinder: undefined })}>
          <RecordingFacet
            cylinder={Boolean(query.cylinder)}
            from={query.legibFrom}
            to={query.legibTo}
            count={derived.cylinderCount}
            histogram={derived.legibHistogram}
            onCylinder={(on) => setQuery({ cylinder: on || undefined })}
            onRange={({ from, to }) => setQuery({ legibFrom: from, legibTo: to })}
          />
        </FacetGroup>
      )}
      <FacetGroup id="genre" title={t('facet.genre')} activeCount={query.genre.length} onClear={() => setQuery({ genre: [] })}>
        <CheckboxFacet counts={derived.facetCounts.genre} selected={query.genre} onChange={(genre) => setQuery({ genre: genre as GenreId[] })} />
      </FacetGroup>
      <FacetGroup id="style" title={t('facet.style')} activeCount={query.style.length} onClear={() => setQuery({ style: [] })}>
        <ChipFacet label={t('facet.style')} values={index.styles} counts={derived.facetCounts.style} selected={query.style} onChange={(style) => setQuery({ style })} labelOf={styleLabel} />
      </FacetGroup>
      <FacetGroup id="performance" title={t('facet.performance')} activeCount={query.performance ? 1 : 0} onClear={() => setQuery({ performance: undefined })}>
        <ChipFacet
          label={t('facet.performance')}
          values={PERFORMANCE_IDS}
          counts={derived.facetCounts.performance}
          selected={query.performance ? [query.performance] : []}
          single
          onChange={(v) => setQuery({ performance: v[0] as Performance | undefined })}
          labelOf={performanceLabel}
        />
      </FacetGroup>
      <FacetGroup id="instrument" title={t('facet.instrument')} activeCount={query.instrument.length} onClear={() => setQuery({ instrument: [] })}>
        <ChipFacet
          label={t('facet.instrument')}
          values={index.instruments}
          counts={derived.facetCounts.instrument}
          selected={query.instrument}
          hideZero
          onChange={(instrument) => setQuery({ instrument })}
          labelOf={instrumentLabel}
        />
      </FacetGroup>
      <FacetGroup id="year" title={t('facet.year')} activeCount={yearActive} onClear={() => setQuery({ yearFrom: undefined, yearTo: undefined })}>
        {index.yearMin !== undefined && index.yearMax !== undefined ? (
          <YearRange
            min={index.yearMin}
            max={index.yearMax}
            from={query.yearFrom}
            to={query.yearTo}
            histogram={derived.yearHistogram}
            onChange={({ from, to }) => setQuery({ yearFrom: from, yearTo: to })}
          />
        ) : (
          <p className="muted">{t('facet.noDate')}</p>
        )}
      </FacetGroup>
      <div className="rail__clear">
        <button type="button" className="btn" onClick={reset} disabled={!hasActiveFilters(query)}>
          {t('facet.clearAll')}
        </button>
      </div>
    </>
  )
}

/** The Place group (country switch + tree) alone; also the phone "Places" tab. */
export function PlaceFacet({ onSelect }: { onSelect?: () => void }) {
  const catalog = useCatalogReady()
  const derived = useDerived()
  const { query, setQuery } = useQuery()
  if (!catalog || !derived) {
    return (
      <FacetGroup id="place" title={t('facet.place')} activeCount={0}>
        <p className="muted">{t('loadingCollection')}</p>
      </FacetGroup>
    )
  }
  return (
    <FacetGroup
      id="place"
      title={t('facet.place')}
      activeCount={query.village || query.county || query.region || query.country ? 1 : 0}
      onClear={() => setQuery({ country: undefined })}
    >
      <PlaceTree
        tree={derived.placeTree}
        query={query}
        countryOptions={catalog.index.countries}
        onSelect={(level, id) => {
          setQuery({ [level]: id })
          if (id) onSelect?.()
        }}
        onCountry={(id) => setQuery({ country: id === 'all' ? undefined : id })}
      />
    </FacetGroup>
  )
}

export function FilterRail() {
  return (
    <aside className="rail rail--desktop" aria-label={t('facet.filters')}>
      <div className="rail__header">
        <h2>{t('facet.filters')}</h2>
      </div>
      <FilterRailContent />
    </aside>
  )
}

/** Bottom sheet with the same content for narrow viewports (FRONTEND-SPEC 10). */
export function FilterSheet({ open, onClose, resultCount, children }: { open: boolean; onClose: () => void; resultCount: number; children?: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { reset } = useQuery()
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>('select, input, button')?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      opener?.focus()
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__panel" role="dialog" aria-modal="true" aria-label={t('facet.filters')} ref={panelRef} onClick={(e) => e.stopPropagation()}>
        <div className="rail__header">
          <h2>{t('facet.filters')}</h2>
          <button type="button" className="btn btn--sm" onClick={onClose} aria-label={t('phone.closeSheet')}>
            &times;
          </button>
        </div>
        {children ?? <FilterRailContent />}
        <div className="sheet__footer">
          <button type="button" className="btn" onClick={reset}>
            {t('facet.clearAll')}
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {resultCount === 1 ? t('phone.showResultsOne') : t('phone.showResults', { n: resultCount })}
          </button>
        </div>
        <span className="visually-hidden" aria-live="polite">
          {melodies(resultCount)}
        </span>
      </div>
    </div>
  )
}
