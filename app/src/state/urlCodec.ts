// Hand-written URL codec (FRONTEND-SPEC 3.1). Place ids keep their slashes, list params use raw
// commas, `%2C` inside a value is a literal comma, `+` and `%20` both decode to a space.
import {
  applyPatch,
  DEFAULT_QUERY,
  deepestPlace,
  isBordersMode,
  isGenreId,
  isPerformance,
  isSortKey,
  placeLevelOf,
  type GenreId,
  type Query,
} from './query'

export interface DecodeOptions {
  /** Validates place ids; unknown ids are dropped with a warning. */
  placeExists?: (id: string) => boolean
  /** Known style / instrument vocabularies; unknown values are dropped with a warning when given. */
  styles?: ReadonlySet<string>
  instruments?: ReadonlySet<string>
  /** Known collector names; `none` (unknown collector) is always accepted. */
  collectors?: ReadonlySet<string>
}

export interface DecodeResult {
  query: Query
  warnings: string[]
}

const PARAM_ORDER = [
  'q',
  'country',
  'region',
  'county',
  'village',
  'genre',
  'style',
  'perf',
  'instr',
  'collector',
  'from',
  'to',
  'rec',
  'legib',
  'sort',
  'dir',
  'page',
  'unmapped',
  'trip',
  'stop',
  'date',
  'borders',
] as const
const KNOWN = new Set<string>(PARAM_ORDER)

function enc(v: string): string {
  return encodeURIComponent(v).replace(/%2F/gi, '/')
}
function encQ(v: string): string {
  return enc(v).replace(/%20/g, '+')
}
function dec(v: string): string {
  try {
    return decodeURIComponent(v.replace(/\+/g, ' '))
  } catch {
    return v
  }
}

/** Encode a query to its canonical string (without the leading `?`; empty for the default query). */
export function encodeQuery(q: Query, bordersDefault?: string): string {
  const parts: string[] = []
  const put = (k: string, v: string) => parts.push(`${k}=${v}`)
  if (q.q.trim()) put('q', encQ(q.q.trim()))
  const deepest = deepestPlace(q)
  if (deepest) {
    const level = placeLevelOf(deepest)
    if (level) put(level, enc(deepest))
  }
  if (q.genre.length) put('genre', q.genre.map(enc).join(','))
  if (q.style.length) put('style', q.style.map(enc).join(','))
  if (q.performance) put('perf', enc(q.performance))
  if (q.instrument.length) put('instr', q.instrument.map(enc).join(','))
  if (q.collector.length) put('collector', q.collector.map(enc).join(','))
  if (q.yearFrom !== undefined) put('from', String(q.yearFrom))
  if (q.yearTo !== undefined) put('to', String(q.yearTo))
  if (q.cylinder) put('rec', 'cylinder')
  if (q.legibFrom !== undefined || q.legibTo !== undefined) put('legib', `${legibText(q.legibFrom ?? 0)}-${legibText(q.legibTo ?? 1)}`)
  if (q.sort !== 'title') put('sort', q.sort)
  if (q.dir !== 'asc') put('dir', q.dir)
  if (q.page > 1) put('page', String(q.page))
  if (q.unmapped) put('unmapped', '1')
  if (q.trip) put('trip', enc(q.trip))
  if (q.trip && q.stop !== undefined) put('stop', String(q.stop))
  if (q.date) put('date', enc(q.date))
  if (q.borders && q.borders !== (bordersDefault ?? (q.trip || q.date ? undefined : 'now'))) put('borders', q.borders)
  return parts.join('&')
}

/** Shortest decimal for a hundredths value: 0.4, 0.45, 1. */
function legibText(v: number): string {
  return String(Math.round(v * 100) / 100)
}

/** Split a raw search string into [key, rawValue] pairs without decoding the values. */
function pairs(search: string): [string, string][] {
  const s = search.startsWith('?') ? search.slice(1) : search
  if (!s) return []
  return s
    .split('&')
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf('=')
      return i < 0 ? [dec(p), ''] : [dec(p.slice(0, i)), p.slice(i + 1)]
    })
}

/** Decode a search string tolerantly. Nothing throws; every dropped item is named in `warnings`. */
export function decodeQuery(search: string, opts: DecodeOptions = {}): DecodeResult {
  const warnings: string[] = []
  const raw = new Map<string, string>()
  for (const [k, v] of pairs(search)) {
    if (!KNOWN.has(k)) {
      warnings.push(`unknown param "${k}" ignored`)
      continue
    }
    raw.set(k, v) // repeated single-value params: the last occurrence wins
  }
  const list = (k: string): string[] => {
    const v = raw.get(k)
    if (v === undefined) return []
    return v
      .split(',')
      .map(dec)
      .map((x) => x.trim())
      .filter(Boolean)
  }
  const single = (k: string): string | undefined => {
    const v = raw.get(k)
    return v === undefined ? undefined : dec(v)
  }
  const int = (k: string): number | undefined => {
    const v = single(k)
    if (v === undefined) return undefined
    if (!/^-?\d+$/.test(v.trim())) {
      warnings.push(`non-integer ${k}="${v}" ignored`)
      return undefined
    }
    return parseInt(v, 10)
  }

  const patch: Partial<Query> = {}
  const q = single('q')
  if (q !== undefined) patch.q = q

  // Place: the deepest wins; shallower params that disagree are ignored with a warning.
  const placeOk = (id: string) => (opts.placeExists ? opts.placeExists(id) : true)
  const candidates: [keyof Query, string | undefined][] = [
    ['village', single('village')],
    ['county', single('county')],
    ['region', single('region')],
    ['country', single('country')],
  ]
  let chosen: string | undefined
  for (const [level, id] of candidates) {
    if (!id) continue
    if (level === 'country' && id === 'all') {
      // legacy alias for "no country constraint" (the default)
      continue
    }
    const own = placeLevelOf(id)
    if (own !== level) {
      warnings.push(`${level}="${id}" is not a ${level} id, ignored`)
      continue
    }
    if (!placeOk(id)) {
      warnings.push(`unknown ${level} "${id}" dropped`)
      continue
    }
    if (!chosen) {
      chosen = id
      patch[level] = id as never
    } else if (!chosen.startsWith(id + '/')) {
      warnings.push(`${level}="${id}" disagrees with the deeper place "${chosen}", ignored`)
    }
  }

  const genres: GenreId[] = []
  for (const g of list('genre')) {
    if (isGenreId(g)) genres.push(g)
    else warnings.push(`unknown genre "${g}" dropped`)
  }
  if (raw.has('genre')) patch.genre = genres

  const styles: string[] = []
  for (const s of list('style')) {
    if (opts.styles && !opts.styles.has(s)) warnings.push(`unknown style "${s}" dropped`)
    else styles.push(s)
  }
  if (raw.has('style')) patch.style = styles

  const perf = single('perf')
  if (perf !== undefined) {
    if (isPerformance(perf)) patch.performance = perf
    else warnings.push(`unknown perf "${perf}" dropped`)
  }

  const instruments: string[] = []
  for (const i of list('instr')) {
    if (opts.instruments && !opts.instruments.has(i)) warnings.push(`unknown instrument "${i}" dropped`)
    else instruments.push(i)
  }
  if (raw.has('instr')) patch.instrument = instruments

  const collectors: string[] = []
  for (const c of list('collector')) {
    if (opts.collectors && c !== 'none' && !opts.collectors.has(c)) warnings.push(`unknown collector "${c}" dropped`)
    else collectors.push(c)
  }
  if (raw.has('collector')) patch.collector = collectors

  const from = int('from')
  if (from !== undefined) patch.yearFrom = from
  const to = int('to')
  if (to !== undefined) patch.yearTo = to

  const rec = single('rec')
  if (rec !== undefined) {
    if (rec === 'cylinder') patch.cylinder = true
    else warnings.push(`unknown rec "${rec}" dropped`)
  }
  const legib = single('legib')
  if (legib !== undefined) {
    const m = /^(\d*\.?\d+)?-(\d*\.?\d+)?$/.exec(legib.trim())
    const lo = m?.[1] !== undefined ? Number(m[1]) : undefined
    const hi = m?.[2] !== undefined ? Number(m[2]) : undefined
    if (!m || (lo !== undefined && lo > 1) || (hi !== undefined && hi > 1)) warnings.push(`malformed legib "${legib}" ignored`)
    else {
      if (lo !== undefined) patch.legibFrom = lo
      if (hi !== undefined) patch.legibTo = hi
    }
  }

  const sort = single('sort')
  if (sort !== undefined) {
    if (isSortKey(sort)) patch.sort = sort
    else warnings.push(`unknown sort "${sort}" dropped`)
  }
  const dir = single('dir')
  if (dir !== undefined) {
    if (dir === 'asc' || dir === 'desc') patch.dir = dir
    else warnings.push(`unknown dir "${dir}" dropped`)
  }
  const page = int('page')
  if (page !== undefined) {
    if (page >= 1) patch.page = page
    else warnings.push(`page=${page} out of range, ignored`)
  }
  const unmapped = single('unmapped')
  if (unmapped !== undefined) {
    if (unmapped === '1' || unmapped === 'true') patch.unmapped = true
    else warnings.push(`unmapped="${unmapped}" ignored`)
  }
  const trip = single('trip')
  if (trip) patch.trip = trip
  const stop = int('stop')
  if (stop !== undefined) {
    if (trip) patch.stop = stop
    else warnings.push('stop without trip ignored')
  }
  const date = single('date')
  if (date !== undefined) {
    if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date)) patch.date = date
    else warnings.push(`malformed date "${date}" ignored`)
  }
  const borders = single('borders')
  if (borders !== undefined) {
    if (isBordersMode(borders)) patch.borders = borders
    else warnings.push(`unknown borders "${borders}" dropped`)
  }

  // Build through applyPatch so every invariant holds, then restore page (applyPatch resets it).
  let query = applyPatch(DEFAULT_QUERY, patch)
  if (patch.page !== undefined) query = { ...query, page: patch.page }
  return { query, warnings }
}

/** `?...` for use in links; empty string when the query is the default. */
export function toSearch(q: Query, bordersDefault?: string): string {
  const s = encodeQuery(q, bordersDefault)
  return s ? `?${s}` : ''
}
