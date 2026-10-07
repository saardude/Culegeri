// ResultsPanel (FRONTEND-SPEC 7): ResultsHeader (count, sort, export, chips), SongList, Pagination.
import { Link } from 'react-router'
import { useCatalogReady } from '../app/catalog'
import { useDerived, useQuery } from '../app/query'
import { melodiesOf, t } from '../i18n/en'
import { SORT_KEYS, type SortKey } from '../state/query'
import { ActiveFilterChips } from './ActiveFilterChips'
import { ExportButton } from './ExportButton'
import { Pagination } from './Pagination'
import { SongList } from './SongRow'
import { EmptyState, Skeleton } from './States'

export function SortSelect() {
  const { query, setQuery } = useQuery()
  return (
    <div className="sort">
      <label htmlFor="sort-select" className="visually-hidden">
        {t('sort.label')}
      </label>
      <select
        id="sort-select"
        className="select"
        value={query.sort}
        onChange={(e) => {
          const sort = e.target.value as SortKey
          // clearest first is the useful order for legibility
          setQuery(sort === 'legibility' && query.sort !== 'legibility' ? { sort, dir: 'desc' } : { sort })
        }}
      >
        {SORT_KEYS.filter((k) => k !== 'legibility' || query.cylinder).map((k) => (
          <option key={k} value={k}>
            {t(`sort.${k}`)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn--sm"
        aria-pressed={query.dir === 'desc'}
        aria-label={t('sort.toggleDir')}
        title={query.dir === 'desc' ? t('sort.desc') : t('sort.asc')}
        onClick={() => setQuery({ dir: query.dir === 'desc' ? 'asc' : 'desc' })}
      >
        {query.dir === 'desc' ? '↓' : '↑'}
      </button>
    </div>
  )
}

export function ResultsPanel({ onHoverPlace, hideCountyLink }: { onHoverPlace?: (placeId: string | null) => void; hideCountyLink?: boolean }) {
  const catalog = useCatalogReady()
  const derived = useDerived()
  const { query, setQuery, reset, search } = useQuery()

  if (!catalog || !derived) {
    return (
      <div className="results__body" aria-busy="true">
        <div className="results__header">
          <div className="results__count">{t('loadingCollection')}</div>
        </div>
        <Skeleton rows={8} />
      </div>
    )
  }

  const n = derived.filteredSongs.length
  const chips = derived.activeChips
  const qActive = query.q.trim().length >= 2
  return (
    <>
      <div className="results__header">
        <div className="results__count" aria-live="polite" aria-atomic="true">
          {derived.searching ? t('state.loading') : melodiesOf(n, derived.total)}
        </div>
        <div className="results__controls">
          <SortSelect />
          <ExportButton songs={derived.sortedSongs} query={query} small />
          {query.county && !hideCountyLink && (
            <Link className="btn btn--sm" to={{ pathname: `/county/${query.county}`, search }}>
              {t('nav.openCounty')}
            </Link>
          )}
        </div>
        <div className="results__chips">
          <ActiveFilterChips chips={chips} />
        </div>
      </div>
      {n === 0 && !derived.searching ? (
        <EmptyState
          title={qActive ? t('state.emptySearchTitle', { q: query.q.trim() }) : t('state.emptyTitle')}
          body={qActive ? t('search.hint') : t('state.emptyBody')}
          actions={
            <>
              {qActive && (
                <button type="button" className="btn" onClick={() => setQuery({ q: '' })}>
                  {t('state.clearSearch')}
                </button>
              )}
              <button type="button" className="btn btn--primary" onClick={reset}>
                {t('facet.clearAll')}
              </button>
            </>
          }
        />
      ) : (
        <>
          <SongList songs={derived.pagedSongs} index={catalog.index} search={search} onHover={onHoverPlace} />
          <Pagination page={derived.page} pageCount={derived.pageCount} onPage={(page) => setQuery({ page })} />
        </>
      )}
    </>
  )
}
