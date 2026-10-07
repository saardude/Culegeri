// Wax-cylinder legibility (audio/README in audio/discovery/): one score per cylinder record, 0 (almost
// illegible) to 1 (perfectly legible), 60% clarity of the voice or instrument and 40% noise. Records
// with a score are exactly the records with a playable wax-cylinder recording. The app copy is
// written by scripts/sync-data.mjs from data/recording-quality.json.
import type { Song } from '../types/song'

export interface TrackLegibility {
  score: number
  /** Short numbered clip (usually a spoken announcement); not counted in the record score. */
  clip: boolean
}

export interface Legibility {
  /** Record score: the best non-clip track (or the best clip, when the record has clips only). */
  score: number
  /** Cylinder ID of the track the score comes from, e.g. "MH_1250a". */
  track: string
  /** The record has short spoken clips only; the score comes from a clip. */
  clipOnly: boolean
  /** Scores of the record's cylinder tracks, keyed by lower-case cylinder ID. */
  tracks: Record<string, TrackLegibility>
}

/** The app data file (`legibility` in the manifest). Records: [score, track] or [score, track, 1] for clip-only. */
export interface LegibilityFile {
  method?: string
  scoredAt?: string
  records: Record<string, [number, string] | [number, string, 1]>
  tracks: Record<string, number>
  clips: string[]
}

const CYL_RE = /((?:MH|KF)_[0-9A-Za-z_]+)\.mp3$/i

/** Cylinder ID of a recording URL ("…/MH/MH_1250a.mp3" or "…/source/002_MH_0925a.mp3"), else null. */
export function cylinderOf(url: string): string | null {
  const file = url.slice(url.lastIndexOf('/') + 1)
  const m = CYL_RE.exec(file)
  return m ? m[1] : null
}

/** Attach `legibility` to every scored record, in place. Returns the number of records scored. */
export function attachLegibility(songs: Song[], file: LegibilityFile | null | undefined): number {
  if (!file?.records) return 0
  const clips = new Set((file.clips ?? []).map((c) => c.toLowerCase()))
  const trackScore = new Map(Object.entries(file.tracks ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  let n = 0
  for (const s of songs) {
    const r = file.records[s.id]
    if (!r) continue
    const tracks: Record<string, TrackLegibility> = {}
    for (const a of s.media.audio) {
      const cyl = cylinderOf(a.url)?.toLowerCase()
      const score = cyl ? trackScore.get(cyl) : undefined
      if (cyl && score !== undefined) tracks[cyl] = { score, clip: clips.has(cyl) }
    }
    s.legibility = { score: r[0], track: r[1], clipOnly: r[2] === 1, tracks }
    n++
  }
  return n
}

export type LegibilityBand = 'veryClear' | 'clear' | 'fair' | 'hard' | 'barely'

/** Five equal bands; the words live in i18n `legibility.band.*`. */
export function legibilityBand(score: number): LegibilityBand {
  if (score >= 0.8) return 'veryClear'
  if (score >= 0.6) return 'clear'
  if (score >= 0.4) return 'fair'
  if (score >= 0.2) return 'hard'
  return 'barely'
}

/** Two decimals, the precision of the source file. */
export function formatLegibility(score: number): string {
  return score.toFixed(2)
}
