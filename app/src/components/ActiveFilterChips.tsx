// ActiveFilterChips (FRONTEND-SPEC 6): one <button> per active value, "Clear all filters" last.
// Removing a chip moves focus to the next chip or to "Clear all".
import { useRef } from 'react'
import { useQuery } from '../app/query'
import { genreLabel, instrumentLabel, performanceLabel, styleLabel, t } from '../i18n/en'
import type { Query } from '../state/query'
import type { Chip } from '../state/selectors'

function removalPatch(chip: Chip, query: Query): Partial<Query> {
  switch (chip.key) {
    case 'country':
      return { country: undefined }
    case 'place': {
      const depth = chip.value.split('/').length
      if (depth >= 4) return { village: undefined }
      if (depth === 3) return { county: undefined }
      if (depth === 2) return { region: undefined }
      return { country: undefined }
    }
    case 'genre':
      return { genre: query.genre.filter((g) => g !== chip.value) }
    case 'style':
      return { style: query.style.filter((s) => s !== chip.value) }
    case 'performance':
      return { performance: undefined }
    case 'instrument':
      return { instrument: query.instrument.filter((i) => i !== chip.value) }
    case 'collector':
      return { collector: query.collector.filter((c) => c !== chip.value) }
    case 'year':
      return { yearFrom: undefined, yearTo: undefined }
    case 'recording':
      return { cylinder: undefined }
    case 'q':
      return { q: '' }
    case 'unmapped':
      return { unmapped: undefined }
    case 'journey':
      return { trip: undefined }
    default:
      return {}
  }
}

function chipLabel(chip: Chip): string {
  switch (chip.key) {
    case 'genre':
      return genreLabel(chip.value)
    case 'style':
      return styleLabel(chip.value)
    case 'performance':
      return performanceLabel(chip.value)
    case 'instrument':
      return instrumentLabel(chip.value)
    default:
      return chip.label
  }
}

export function ActiveFilterChips({ chips }: { chips: Chip[]; hideCountry?: boolean }) {
  const { query, setQuery, reset } = useQuery()
  const ref = useRef<HTMLDivElement>(null)
  // A country is a real filter now (no country by default), so every chip is shown.
  const visible = chips
  if (!visible.length) return null
  const remove = (chip: Chip, i: number) => {
    setQuery(removalPatch(chip, query))
    window.requestAnimationFrame(() => {
      const buttons = ref.current?.querySelectorAll<HTMLButtonElement>('button')
      if (!buttons?.length) return
      ;(buttons[Math.min(i, buttons.length - 1)] ?? buttons[buttons.length - 1]).focus()
    })
  }
  return (
    <div className="chips" ref={ref} aria-label="Active filters">
      {visible.map((chip, i) => {
        const label = chipLabel(chip)
        return (
          <button key={`${chip.key}:${chip.value}`} type="button" className="chip" aria-label={t('facet.removeChip', { label })} onClick={() => remove(chip, i)}>
            <span>{label}</span>
            <span className="chip__x" aria-hidden="true">
              &times;
            </span>
          </button>
        )
      })}
      <button type="button" className="btn btn--link" onClick={reset}>
        {t('facet.clearAll')}
      </button>
    </div>
  )
}
