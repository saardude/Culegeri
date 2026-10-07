// Shared Playwright fixtures (QA-PLAN section 4, AC-35): every test fails on console.error /
// pageerror; external hosts (map tiles, zti.hu media) are stubbed so runs are hermetic; `data`
// exposes the built dataset for computing expected counts.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test as base, type Locator, type Page } from '@playwright/test'
import { buildIndex } from '../src/data/catalogIndex'
import { hydrateSongs } from '../src/data/hydrate'
import { attachLegibility, type LegibilityFile } from '../src/data/legibility'
import { DEFAULT_QUERY } from '../src/state/query'
import { buildMapPoints, countryPredicate } from '../src/state/selectors'
import type { Place } from '../src/types/place'
import type { Song } from '../src/types/song'

export { expect }

const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const TILE_HOSTS = /cartocdn\.com|openstreetmap\.org|tile\./i
/** Console errors that come from the sandbox, not the app (the proxy blocks external hosts). */
const IGNORED_CONSOLE = [/ERR_CERT_AUTHORITY_INVALID/, TILE_HOSTS, /ERR_TUNNEL_CONNECTION_FAILED/, /ERR_PROXY/, /net::ERR_/]

/** The app's own record shape: the built songs file is the slim format, hydrated exactly as the app does. */
export type SongLite = Song
export type PlaceLite = Place

export interface DataFixture {
  songs: SongLite[]
  places: PlaceLite[]
  placeById: Map<string, PlaceLite>
  /** Records under Romania. */
  ro: SongLite[]
  /** Records in the app's default scope (DEFAULT_QUERY.country, which is "all countries" since 884494c). */
  scoped: SongLite[]
  /** Number of county bubbles the map draws for the default scope (same code path as the app). */
  countyPointCount: number
  under(placeId: string): SongLite[]
  countyId(name: string): string
  song(pred: (s: SongLite) => boolean): SongLite
}

function loadData(): DataFixture {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', process.env.VITE_OUT_DIR ?? 'dist-e2e', 'data')
  const files = readdirSync(dir)
  const read = <T>(prefix: string): T => {
    const f = files.find((x) => x.startsWith(prefix + '.') && x.endsWith('.json'))
    if (!f) throw new Error(`${dir}/${prefix}.*.json not found; run VITE_OUT_DIR=dist-e2e npm run build`)
    return JSON.parse(readFileSync(join(dir, f), 'utf8')) as T
  }
  const places = read<Place[]>('places')
  const songs = hydrateSongs(read<unknown>('songs'), places)
  // optional, as in the app: wax-cylinder legibility scores
  if (files.some((x) => x.startsWith('legibility.'))) attachLegibility(songs, read<LegibilityFile>('legibility'))
  const placeById = new Map(places.map((p) => [p.id, p]))
  const ro = songs.filter((s) => (s.location.placeId ? s.location.placeId === 'ro' || s.location.placeId.startsWith('ro/') : s.location.country === 'RO'))
  const scoped = songs.filter(countryPredicate(DEFAULT_QUERY))
  const index = buildIndex(songs, places)
  const countyPointCount = buildMapPoints(scoped, index, 'county', undefined, undefined).points.length
  return {
    songs,
    places,
    placeById,
    ro,
    scoped,
    countyPointCount,
    under: (placeId) => songs.filter((s) => s.location.placeId === placeId || (s.location.placeId?.startsWith(placeId + '/') ?? false)),
    countyId: (name) => {
      const p = places.find((x) => x.type === 'county' && x.name === name)
      if (!p) throw new Error(`county ${name} not in places`)
      return p.id
    },
    song: (pred) => {
      const s = songs.find(pred)
      if (!s) throw new Error('no song matches the predicate')
      return s
    },
  }
}

export interface ConsoleLog {
  errors: string[]
  pageErrors: string[]
}

export const test = base.extend<{ consoleLog: ConsoleLog; allowConsoleErrors: boolean }, { data: DataFixture }>({
  data: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(loadData())
    },
    { scope: 'worker' },
  ],
  allowConsoleErrors: [false, { option: true }],
  consoleLog: [
    async ({ page, allowConsoleErrors }, use) => {
      const log: ConsoleLog = { errors: [], pageErrors: [] }
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return
        const text = `${msg.text()} @ ${msg.location().url}`
        if (IGNORED_CONSOLE.some((re) => re.test(text))) return
        log.errors.push(text)
      })
      page.on('pageerror', (err) => log.pageErrors.push(err.stack ? err.stack.split('\n').slice(0, 6).join(' <- ') : String(err)))
      await use(log)
      if (!allowConsoleErrors) {
        expect.soft(log.pageErrors, 'uncaught page errors').toEqual([])
        expect.soft(log.errors, 'console.error entries').toEqual([])
      }
    },
    { auto: true },
  ],
  page: async ({ page }, use) => {
    // Hermetic network: everything off localhost is answered locally (tiles -> blank PNG).
    await page.route(
      (url) => !LOCAL_HOSTS.has(url.hostname),
      (route) => {
        const url = route.request().url()
        if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url) || TILE_HOSTS.test(url) || route.request().resourceType() === 'image') {
          return route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG })
        }
        return route.fulfill({ status: 204, body: '' })
      },
    )
    await use(page)
  },
})

const COUNT_RE = /([\d,]+) of ([\d,]+) melodies/

/** Waits until the catalogue is loaded and the results header shows "N of M melodies". */
export async function waitForCatalog(page: Page): Promise<void> {
  await expect(countLocator(page)).toHaveText(COUNT_RE, { timeout: 60_000 })
}

/** The results header on desktop / the Songs tab, or the phone header on the Map and Places tabs. */
function countLocator(page: Page): Locator {
  return page.locator('.results__count, .phone-header__count').first()
}

/** Leaflet animates the initial fit; MapView ignores clicks within 300 ms of a zoom, so settle first. */
export async function waitForMapIdle(page: Page): Promise<void> {
  const map = page.locator('.map-view.leaflet-container').first()
  if ((await map.count()) === 0) return
  await expect(map).not.toHaveClass(/leaflet-zoom-anim/)
  await page.waitForTimeout(400)
}

/** Parses "1,204 of 13,212 melodies" from the results header. */
export async function readCount(page: Page): Promise<{ n: number; m: number }> {
  const el = countLocator(page)
  await expect(el).toHaveText(COUNT_RE)
  const m = COUNT_RE.exec((await el.textContent()) ?? '')
  if (!m) throw new Error('count not found')
  return { n: Number(m[1].replace(/,/g, '')), m: Number(m[2].replace(/,/g, '')) }
}

export async function gotoApp(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await waitForCatalog(page)
  await showSongsTab(page)
  await waitForMapIdle(page)
}

/** Phone: a deep link with a place opens on the Map tab (FRONTEND-SPEC 10); switch to the list. */
export async function showSongsTab(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: /^Songs/ })
  if ((await tab.count()) > 0 && (await tab.getAttribute('aria-selected')) !== 'true') {
    await tab.click()
    await expect(page.locator('.results__count')).toBeVisible()
  }
}

/** The first map dot whose box lies inside the visible map (markers outside the view are clipped). */
export async function visibleDot(page: Page, selector = '.map-view .dot'): Promise<Locator> {
  const map = page.locator('.map-view').first()
  const mb = await map.boundingBox()
  if (!mb) throw new Error('map not visible')
  const dots = page.locator(selector)
  const n = await dots.count()
  for (let i = 0; i < n; i++) {
    const b = await dots.nth(i).boundingBox()
    if (!b || b.x < mb.x + 8 || b.y < mb.y + 8 || b.x + b.width > mb.x + mb.width - 8 || b.y + b.height > mb.y + mb.height - 8) continue
    const onTop = await dots.nth(i).evaluate((el, [x, y]) => {
      const hit = document.elementFromPoint(x, y)
      return hit === el || el.contains(hit)
    }, [b.x + b.width / 2, b.y + b.height / 2])
    if (onTop) return dots.nth(i)
  }
  throw new Error('no dot inside the visible map')
}

/** Tests that break the catalogue on purpose expect exactly one structured console.error (AC-32). */
export function expectOnlyCatalogError(log: ConsoleLog): void {
  expect(log.errors).toEqual([expect.stringMatching(/^catalog: load failed/)])
  expect(log.pageErrors).toEqual([])
  log.errors.length = 0
}

export function countyDot(page: Page, name: string): Locator {
  // labels read "Arad: 31 melodies..." or "Bihor (Bihar): 436 melodies..."
  return page.locator(`.map-view .dot--county[aria-label^="${name}:"], .map-view .dot--county[aria-label^="${name} ("]`)
}

export function searchBox(page: Page): Locator {
  return page.getByRole('searchbox', { name: 'Search melodies' })
}

/** True when the route still renders the "being built" placeholder (StubPages). */
export async function isStub(page: Page): Promise<boolean> {
  return (await page.getByText('This screen is being built').count()) > 0
}

export function query(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams
}

export async function hasVisibleFocusRing(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return false
    const cs = getComputedStyle(el)
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
    const shadow = cs.boxShadow !== 'none'
    return outline || shadow
  })
}

/** Seeded PRNG so the 20-record sample (E2E-15) is stable. */
export function seededSample<T>(items: T[], n: number, seed = 42): T[] {
  let s = seed
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
  const pool = [...items]
  const out: T[] = []
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0])
  return out
}
