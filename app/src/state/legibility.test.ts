import { describe, expect, it } from 'vitest'
import { attachLegibility, cylinderOf, legibilityBand, type LegibilityFile } from '../data/legibility'
import { fixtureIndex, fixtureSongs } from '../test/fixture'
import type { Song } from '../types/song'
import { applyPatch, DEFAULT_QUERY, hasActiveFilters, resetQuery, type Query } from './query'
import { derive } from './selectors'
import { sortSongs } from './sort'
import { decodeQuery, encodeQuery } from './urlCodec'

/** Fixture copy where the first six records carry a cylinder track and a score. */
function scoredSongs(): Song[] {
  const songs: Song[] = fixtureSongs.map((s) => ({ ...s, media: { ...s.media, audio: [...s.media.audio] } }))
  const scores = [0.12, 0.35, 0.41, 0.58, 0.66, 1]
  const file: LegibilityFile = { records: {}, tracks: {}, clips: ['MH_0006a0'] }
  scores.forEach((score, i) => {
    const cyl = `MH_000${i + 1}a`
    songs[i].media.audio = [{ url: `https://example.invalid/media/audio/MH/${cyl}.mp3`, type: 'audio/mpeg', caption: null }]
    file.records[songs[i].id] = i === 5 ? [score, 'MH_0006a0', 1] : [score, cyl]
    file.tracks[cyl] = score
  })
  songs[5].media.audio = [{ url: 'https://example.invalid/media/audio/MH/MH_0006a0.mp3', type: 'audio/mpeg', caption: null }]
  file.tracks['MH_0006a0'] = 1
  attachLegibility(songs, file)
  return songs
}

const songs = scoredSongs()
const index = fixtureIndex(songs)
const run = (patch: Partial<Query>) => derive({ query: applyPatch(DEFAULT_QUERY, patch), index, searchIds: null })

describe('legibility data', () => {
  it('reads cylinder IDs from recording URLs', () => {
    expect(cylinderOf('https://bartok-gyujtesek.zti.hu/media/audio/MH/MH_1250a0.mp3')).toBe('MH_1250a0')
    expect(cylinderOf('https://bartok-nepzene.zti.hu/media/audio/source/002_MH_0925a.mp3')).toBe('MH_0925a')
    expect(cylinderOf('https://systems.zti.hu/media/audio/MH/MH_0045_iia.mp3')).toBe('MH_0045_iia')
    expect(cylinderOf('https://bartok-nepzene.zti.hu/media/audio/composition/166_Bartok.mp3')).toBeNull()
    expect(cylinderOf('https://systems.zti.hu/media/audio/Gr/Gr_060ad.mp3')).toBeNull()
  })

  it('attaches record and track scores and the clip flags', () => {
    expect(songs.filter((s) => s.legibility)).toHaveLength(6)
    expect(songs[0].legibility).toEqual({ score: 0.12, track: 'MH_0001a', clipOnly: false, tracks: { mh_0001a: { score: 0.12, clip: false } } })
    expect(songs[5].legibility?.clipOnly).toBe(true)
    expect(songs[5].legibility?.tracks.mh_0006a0).toEqual({ score: 1, clip: true })
    expect(songs[6].legibility).toBeUndefined()
  })

  it('names five bands', () => {
    expect([0, 0.19, 0.2, 0.4, 0.59, 0.6, 0.8, 1].map(legibilityBand)).toEqual(['barely', 'barely', 'hard', 'fair', 'fair', 'clear', 'veryClear', 'veryClear'])
  })
})

describe('recording query invariants', () => {
  it('a legibility range turns the cylinder filter on and rounds to hundredths', () => {
    const q = applyPatch(DEFAULT_QUERY, { legibFrom: 0.404 })
    expect(q.cylinder).toBe(true)
    expect(q.legibFrom).toBe(0.4)
  })
  it('clearing the cylinder filter clears the range and the legibility sort', () => {
    const on = applyPatch(DEFAULT_QUERY, { legibFrom: 0.4, legibTo: 0.8, sort: 'legibility', dir: 'desc' })
    expect(on.sort).toBe('legibility')
    const off = applyPatch(on, { cylinder: undefined })
    expect(off.cylinder).toBeUndefined()
    expect(off.legibFrom).toBeUndefined()
    expect(off.legibTo).toBeUndefined()
    expect(off.sort).toBe('title')
    expect(off.dir).toBe('asc')
  })
  it('the open ends of the scale mean no bound, and bounds swap when reversed', () => {
    expect(applyPatch(DEFAULT_QUERY, { cylinder: true, legibFrom: 0, legibTo: 1 })).toEqual(applyPatch(DEFAULT_QUERY, { cylinder: true }))
    const q = applyPatch(DEFAULT_QUERY, { legibFrom: 0.7, legibTo: 0.3 })
    expect([q.legibFrom, q.legibTo]).toEqual([0.3, 0.7])
  })
  it('the legibility sort needs the cylinder filter', () => {
    expect(applyPatch(DEFAULT_QUERY, { sort: 'legibility' }).sort).toBe('title')
  })
  it('counts as an active filter and clears with Clear all', () => {
    const q = applyPatch(DEFAULT_QUERY, { cylinder: true })
    expect(hasActiveFilters(q)).toBe(true)
    expect(resetQuery(q).cylinder).toBeUndefined()
  })
})

describe('recording URL params', () => {
  const roundTrip = ['rec=cylinder', 'rec=cylinder&legib=0.4-1', 'rec=cylinder&legib=0-0.35', 'rec=cylinder&legib=0.25-0.75&sort=legibility&dir=desc']
  for (const s of roundTrip) {
    it(`round-trips ${s}`, () => {
      const { query, warnings } = decodeQuery(s)
      expect(warnings).toEqual([])
      expect(encodeQuery(query)).toBe(s)
    })
  }
  it('a range without rec still means cylinder records', () => {
    expect(encodeQuery(decodeQuery('legib=0.5-1').query)).toBe('rec=cylinder&legib=0.5-1')
  })
  it('drops malformed values with a warning', () => {
    expect(decodeQuery('rec=disc').warnings).toEqual(['unknown rec "disc" dropped'])
    expect(decodeQuery('legib=abc').warnings).toEqual(['malformed legib "abc" ignored'])
    expect(decodeQuery('legib=0.2-3').warnings).toEqual(['malformed legib "0.2-3" ignored'])
    expect(decodeQuery('sort=legibility').query.sort).toBe('title')
  })
})

describe('recording filter', () => {
  it('shows only scored records, inside the range', () => {
    expect(run({ cylinder: true }).filteredSongs.map((s) => s.id).sort()).toEqual(songs.slice(0, 6).map((s) => s.id).sort())
    expect(run({ legibFrom: 0.4, legibTo: 0.66 }).filteredSongs.map((s) => s.legibility?.score).sort()).toEqual([0.41, 0.58, 0.66])
  })
  it('counts cylinder records and bins them ignoring its own range', () => {
    const d = run({ legibFrom: 0.5 })
    expect(d.cylinderCount).toBe(6)
    expect(d.legibHistogram).toHaveLength(20)
    expect(d.legibHistogram.reduce((n, b) => n + b.count, 0)).toBe(6)
    expect(d.legibHistogram[19].count).toBe(1) // a score of exactly 1 lands in the last bin
    expect(d.legibHistogram[2].count).toBe(1) // 0.12
  })
  it('the count follows the other filters', () => {
    const first = songs[0]
    const d = run({ q: '', genre: first.genre ? [first.genre] : [] })
    expect(d.cylinderCount).toBe(songs.slice(0, 6).filter((s) => !first.genre || s.genre === first.genre).length)
  })
  it('makes a chip that names the range', () => {
    expect(run({ cylinder: true }).activeChips.find((c) => c.key === 'recording')?.label).toBe('Wax cylinder')
    expect(run({ legibFrom: 0.4 }).activeChips.find((c) => c.key === 'recording')?.label).toBe('Wax cylinder, legibility 0.40 to 1.00')
  })
  it('sorts by legibility with unscored records last in both directions', () => {
    const asc = sortSongs(songs, 'legibility', 'asc').slice(0, 7).map((s) => s.legibility?.score)
    const desc = sortSongs(songs, 'legibility', 'desc').slice(0, 7).map((s) => s.legibility?.score)
    expect(asc).toEqual([0.12, 0.35, 0.41, 0.58, 0.66, 1, undefined])
    expect(desc).toEqual([1, 0.66, 0.58, 0.41, 0.35, 0.12, undefined])
  })
})
