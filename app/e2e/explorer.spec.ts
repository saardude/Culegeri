// Explorer journeys: E2E-01 to E2E-04 and E2E-13 (QA-PLAN section 4).
import { countyDot, expect, gotoApp, query, readCount, searchBox, test, waitForCatalog, waitForMapIdle } from './fixtures'

test.describe('Explorer', () => {
  test('E2E-01 land, pick county on map, results narrow, sort by style, open song, back keeps filters', async ({ page, data }, testInfo) => {
    test.skip(testInfo.project.name === 'phone-chromium', 'desktop journey; the phone journey is E2E-09')
    await gotoApp(page, '/')
    // 1. count equals the Romania scope; one bubble per mapped county
    const c0 = await readCount(page)
    expect(c0.n).toBe(data.scoped.length)
    expect(c0.m).toBe(data.scoped.length)
    await expect(page.locator('.map-view .dot--county')).toHaveCount(data.countyPointCount)

    // 2. click Arad
    const arad = countyDot(page, 'Arad')
    const label = (await arad.getAttribute('aria-label')) ?? ''
    const bubbleCount = Number(/: ([\d,]+) melodies/.exec(label)?.[1].replace(/,/g, ''))
    await arad.click()
    await expect.poll(() => query(page).get('county')).toBe(data.countyId('Arad'))
    await expect(page.getByRole('button', { name: /Remove filter: Arad/ })).toBeVisible()
    const c1 = await readCount(page)
    expect(c1.n).toBe(bubbleCount)
    expect(c1.n).toBe(data.under(data.countyId('Arad')).length)
    expect(c1.n).toBeLessThan(c0.n)

    // 3. sort by style
    await page.getByLabel('Sort by').selectOption('style')
    await expect.poll(() => query(page).get('sort')).toBe('style')
    // known styles sort first (roBase collation), unknown last: the first row has a style
    if (data.under(data.countyId('Arad')).some((s) => s.style !== null)) {
      await expect
        .poll(async () => {
          const id = await page.locator('.song-row').first().getAttribute('data-song-id')
          return data.songs.find((s) => s.id === id)?.style ?? null
        })
        .not.toBeNull()
    }

    // 4. scroll the results, then open a row that is visible at that scroll position
    //    (clicking a row scrolled out of view would scroll the list back to it)
    const results = page.locator('.results')
    await results.evaluate((el) => el.scrollTo(0, 300))
    await expect.poll(() => results.evaluate((el) => el.scrollTop)).toBe(300)
    const scrollBefore = 300
    const rowIndex = 8
    const rowId = await page.locator('.song-row').nth(rowIndex).getAttribute('data-song-id')
    const row = data.songs.find((s) => s.id === rowId)
    await page.locator('.song-row a.song-row__main').nth(rowIndex).click()
    await expect(page).toHaveURL(new RegExp(`/song/${rowId}\\?.*county=`))
    await expect(page.locator('h1')).toContainText(row?.title?.trim() || row?.incipit?.trim() || 'Untitled')

    // 5. back keeps county chip, sort, count and scroll position
    await page.goBack()
    await waitForCatalog(page)
    await expect(page.getByRole('button', { name: /Remove filter: Arad/ })).toBeVisible()
    await expect(page.getByLabel('Sort by')).toHaveValue('style')
    expect((await readCount(page)).n).toBe(c1.n)
    await expect.poll(() => results.evaluate((el) => el.scrollTop)).toBeGreaterThan(scrollBefore - 50)
  })

  test('E2E-02 URL paste restores state', async ({ page, data }) => {
    const bihor = data.countyId('Bihor')
    await gotoApp(page, `/?county=${bihor}&genre=colinda,joc&from=1909&to=1912&sort=year&dir=desc`)
    const expected = data.under(bihor).filter((s) => (s.genre === 'colinda' || s.genre === 'joc') && s.collected.year !== null && s.collected.year >= 1909 && s.collected.year <= 1912)
    expect((await readCount(page)).n).toBe(expected.length)
    // chips
    for (const name of [/Remove filter: Bihor/, /Remove filter: colind/, /Remove filter: joc/, /Remove filter: 1909-1912/]) {
      await expect(page.getByRole('button', { name })).toBeVisible()
    }
    await expect(page.getByLabel('Sort by')).toHaveValue('year')
    await expect(page.getByRole('button', { name: 'Toggle sort direction' })).toHaveAttribute('aria-pressed', 'true')
    // the status bar shows the canonical string
    await expect(page.locator('.statusbar__query')).toHaveText(`?county=${bihor}&genre=colinda,joc&from=1909&to=1912&sort=year&dir=desc`)
    // the filter rail (desktop) or sheet (phone) reflects every value
    const isPhone = (await page.locator('.explorer--phone').count()) > 0
    if (isPhone) await page.getByRole('button', { name: /^Filters/ }).click()
    const rail = isPhone ? page.getByRole('dialog', { name: 'Filters' }) : page.getByRole('complementary', { name: 'Filters' })
    await expect(rail.locator(`[role="treeitem"][data-id="${bihor}"]`)).toHaveAttribute('aria-selected', 'true')
    await expect(rail.getByRole('checkbox', { name: /colind/ })).toBeChecked()
    await expect(rail.getByRole('checkbox', { name: /^joc/ })).toBeChecked()
    await expect(rail.getByRole('spinbutton', { name: 'From' })).toHaveValue('1909')
    await expect(rail.getByRole('spinbutton', { name: 'To' })).toHaveValue('1912')
  })

  test('E2E-03 clear all', async ({ page, data }) => {
    const bihor = data.countyId('Bihor')
    await gotoApp(page, `/?county=${bihor}&genre=colinda,joc&from=1909&to=1912&sort=year&dir=desc`)
    await page.locator('.results__chips').getByRole('button', { name: 'Clear all filters' }).click()
    // AC-11 / resetQuery: every filter goes; sort and dir are deliberately kept (QA E2E-03 says "/").
    await expect.poll(() => query(page).get('county')).toBeNull()
    for (const k of ['genre', 'from', 'to', 'q', 'village', 'region', 'perf', 'instr']) expect(query(page).get(k)).toBeNull()
    expect((await readCount(page)).n).toBe(data.scoped.length)
    await expect(page.locator('.results__chips .chip')).toHaveCount(0)
  })

  test('E2E-04 search, with diacritics, and the empty state', async ({ page, data }) => {
    await gotoApp(page, '/')
    const box = searchBox(page)
    await box.fill('sculati')
    await expect.poll(() => query(page).get('q')).toBe('sculati')
    await expect(page.locator('.song-row').first()).toBeVisible()
    const titles = await page.locator('.song-row__title').allTextContents()
    expect(titles.some((t) => /scula/i.test(t))).toBe(true)
    // diacritics: "Sculați" finds the same records (diacritic-insensitive, FRONTEND-SPEC 4)
    await box.fill('Sculați')
    await expect.poll(async () => (await readCount(page)).n).toBeGreaterThan(0)
    const withDiacritics = (await readCount(page)).n
    await box.fill('sculati')
    await expect.poll(async () => (await readCount(page)).n).toBe(withDiacritics)
    expect(data.songs.some((s) => /scula/i.test(`${s.title ?? ''} ${s.incipit ?? ''}`))).toBe(true)
    // nonsense -> empty state with "Clear search"
    await box.fill('zzzzqqqq')
    await expect(page.getByText(/No melodies match "zzzzqqqq"/)).toBeVisible()
    await expect(page.locator('.results__header').getByRole('button', { name: /export/i })).toBeDisabled()
    await page.locator('.empty-state').getByRole('button', { name: 'Clear search' }).click()
    await expect.poll(async () => (await readCount(page)).n).toBe(data.scoped.length)
    await expect(box).toHaveValue('')
  })

  test('E2E-13 map interactions: hover card, click narrows, clear, village dots, list fallback', async ({ page, data }, testInfo) => {
    test.skip(testInfo.project.name === 'phone-chromium', 'touch map interactions are covered by E2E-09')
    await gotoApp(page, '/')
    const bihor = countyDot(page, 'Bihor')
    await bihor.hover()
    const card = page.locator('#map-hover-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText('Bihor')
    await expect(card).toContainText(/\d+ melodies in \d+ villages/)
    await bihor.click()
    await waitForMapIdle(page)
    const bihorId = data.countyId('Bihor')
    await expect.poll(() => query(page).get('county')).toBe(bihorId)
    // village mode: dots for the villages of Bihor
    await expect(page.locator('.map-view .dot--village').first()).toBeVisible()
    const villageDots = page.locator('.map-view .dot--village')
    expect(await villageDots.count()).toBeGreaterThan(1)
    await villageDots.first().click()
    await expect.poll(() => query(page).get('village')).toMatch(new RegExp(`^${bihorId}/`))
    // the deepest place is the only place chip
    await expect(page.locator('.results__chips .chip')).toHaveCount(1)
    await expect(page.locator('.results__chips .chip')).not.toHaveAttribute('aria-label', /Remove filter: Bihor \(/)
    // clearing with the chip's x goes back to the county
    await page.getByRole('button', { name: /Remove filter: / }).first().click()
    await expect.poll(() => query(page).get('village')).toBeNull()
    await page.getByRole('button', { name: /Remove filter: Bihor/ }).click()
    await expect.poll(() => query(page).get('county')).toBeNull()
    // borders then / now / compare on the explorer map (UX pass): Compare -> both, then -> an era year
    const borders = page.getByRole('radiogroup', { name: 'Borders' })
    await expect(borders).toBeVisible()
    await borders.getByRole('radio', { name: /^Compare/ }).click()
    await expect.poll(() => query(page).get('borders')).toBe('both')
    await borders.getByRole('radio', { name: /^Borders then/ }).click()
    await expect.poll(() => query(page).get('borders')).toMatch(/^(1910|1914|1920)$/)
    await borders.getByRole('radio', { name: /^Borders now/ }).click()
    await expect.poll(() => query(page).get('borders')).toBeNull()
    // Reset view clears a selection
    await countyDot(page, 'Arad').click()
    await expect.poll(() => query(page).get('county')).toBe(data.countyId('Arad'))
    await page.getByRole('button', { name: 'Reset view' }).click()
    await expect.poll(() => query(page).get('county')).toBeNull()
    await waitForMapIdle(page)
    // keyboard fallback list
    const summary = page.getByText(/List counties \(\d+\)/)
    await expect(summary).toBeVisible()
    await summary.click()
    const item = page.locator('.map-list__item').first()
    await expect(item).toBeVisible()
    await item.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => query(page).get('county')).not.toBeNull()
  })

  test('E2E-14 wax-cylinder filter: only cylinders, legibility range, legibility sort, chip removal', async ({ page, data }, testInfo) => {
    test.skip(testInfo.project.name === 'phone-chromium', 'desktop filter rail')
    const cylinders = data.songs.filter((s) => s.legibility)
    test.skip(cylinders.length === 0, 'this build has no legibility data')
    await gotoApp(page, '/')

    // a controlled checkbox: it turns checked once the URL (the state) has changed, so click and wait
    const only = page.getByLabel('Wax cylinder recordings only')
    await only.click()
    await expect.poll(() => query(page).get('rec')).toBe('cylinder')
    await expect(only).toBeChecked()
    expect((await readCount(page)).n).toBe(cylinders.length)

    // eight 0.05 steps on the lower slider: legibility 0.40 to 1.00
    const from = page.locator('#legib-from-slider')
    await from.focus()
    for (let i = 0; i < 8; i++) await from.press('ArrowRight')
    await expect.poll(() => query(page).get('legib')).toBe('0.4-1')
    await expect.poll(async () => (await readCount(page)).n).toBe(cylinders.filter((s) => (s.legibility?.score ?? 0) >= 0.4).length)
    await expect(page.getByRole('button', { name: /Remove filter: Wax cylinder, legibility 0\.40 to 1\.00/ })).toBeVisible()

    // the legibility sort is offered only with the cylinder filter, and starts clearest first
    await page.getByLabel('Sort by').selectOption('legibility')
    await expect.poll(() => query(page).get('dir')).toBe('desc')
    const best = Math.max(...cylinders.map((s) => s.legibility?.score ?? 0))
    const firstId = await page.locator('.song-row').first().getAttribute('data-song-id')
    expect(data.songs.find((s) => s.id === firstId)?.legibility?.score).toBe(best)
    await expect(page.locator('.song-row').first().locator('.legib-meter')).toBeVisible()

    // removing the chip clears the range and the legibility sort
    await page.getByRole('button', { name: /Remove filter: Wax cylinder/ }).click()
    await expect.poll(() => page.url()).not.toContain('rec=')
    expect(query(page).get('legib')).toBeNull()
    expect(query(page).get('sort')).toBeNull()
    await expect(page.getByLabel('Sort by').locator('option[value="legibility"]')).toHaveCount(0)
  })
})
