// RecordingFacet: "Wax cylinder recordings only" and the legibility range (0 almost illegible, 1 perfectly
// legible) with a histogram of the cylinder records under the other filters. Moving a slider turns the
// cylinder filter on (applyPatch), because only cylinder records have a score. Sliders commit on change,
// like the year range.
import { Link } from 'react-router'
import { t } from '../../i18n/en'
import type { Bin } from '../../state/selectors'

interface Props {
  cylinder: boolean
  from?: number
  to?: number
  count: number
  histogram: Bin[]
  onCylinder: (on: boolean) => void
  onRange: (next: { from?: number; to?: number }) => void
}

const STEP = 0.05
const fixed = (v: number) => v.toFixed(2)

export function RecordingFacet({ cylinder, from, to, count, histogram, onCylinder, onRange }: Props) {
  const lo = from ?? 0
  const hi = to ?? 1
  const commit = (a: number, b: number) => {
    const [x, y] = a > b ? [b, a] : [a, b]
    onRange({ from: x <= 0 ? undefined : x, to: y >= 1 ? undefined : y })
  }
  const maxCount = Math.max(1, ...histogram.map((b) => b.count))
  const peak = histogram.reduce<Bin | null>((a, b) => (b.count > (a?.count ?? 0) ? b : a), null)
  const summary = peak ? t('facet.legibHist', { from: fixed(peak.from / 100), to: fixed(Math.min(100, peak.to + 1) / 100) }) : t('facet.legibHistNone')
  const barW = histogram.length ? 100 / histogram.length : 100

  return (
    <div className="recording-facet">
      <label className={`checkbox-facet__row${count === 0 && !cylinder ? ' is-zero' : ''}`}>
        <input type="checkbox" checked={cylinder} disabled={count === 0 && !cylinder} onChange={(e) => onCylinder(e.target.checked)} />
        <span className="checkbox-facet__label">{t('facet.cylinderOnly')}</span>
        <span className="checkbox-facet__count">{count === 0 ? t('facet.zero') : count.toLocaleString('en')}</span>
      </label>

      <div className="recording-facet__range">
        <div className="recording-facet__head">
          <span className="caps-label">{t('facet.legibility')}</span>
          <span className="recording-facet__values mono" aria-live="polite">
            {fixed(lo)} &ndash; {fixed(hi)}
          </span>
        </div>
        {histogram.length > 0 && (
          <svg className="year-range__hist" viewBox="0 0 100 20" preserveAspectRatio="none" role="img" aria-label={summary}>
            {histogram.map((b, i) => {
              const h = (b.count / maxCount) * 20
              const out = !cylinder || b.to / 100 < lo || b.from / 100 > hi
              return <rect key={b.from} className={out ? 'is-out' : undefined} x={i * barW + 0.3} y={20 - h} width={Math.max(0.4, barW - 0.6)} height={h} />
            })}
          </svg>
        )}
        <div className="year-range__sliders">
          <label className="visually-hidden" htmlFor="legib-from-slider">
            {t('facet.legibFrom')}
          </label>
          <input
            id="legib-from-slider"
            type="range"
            min={0}
            max={1}
            step={STEP}
            value={lo}
            aria-valuetext={fixed(lo)}
            onChange={(e) => commit(parseFloat(e.target.value), hi)}
          />
          <label className="visually-hidden" htmlFor="legib-to-slider">
            {t('facet.legibTo')}
          </label>
          <input
            id="legib-to-slider"
            type="range"
            min={0}
            max={1}
            step={STEP}
            value={hi}
            aria-valuetext={fixed(hi)}
            onChange={(e) => commit(lo, parseFloat(e.target.value))}
          />
        </div>
        <div className="recording-facet__scale mono muted" aria-hidden="true">
          <span>0</span>
          <span>1</span>
        </div>
        <p className="recording-facet__hint muted">
          {t('facet.legibHint')} <Link to="/about#legibility">{t('facet.legibAbout')}</Link>
        </p>
      </div>
    </div>
  )
}
