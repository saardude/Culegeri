// App-side field on the schema record until data/schema/song.schema.json ships `collectors`
// (once gen-types emits the same `collectors: string[]`, this interface merge is a no-op).
import type { Legibility } from '../data/legibility'

declare module './song' {
  interface Song {
    /** Normalised collector names (Hungarian order); empty when unknown. See src/data/collectors.ts. */
    collectors: string[]
    /** Wax-cylinder legibility, set at load time for records with a cylinder recording (src/data/legibility.ts). */
    legibility?: Legibility
  }
}

export {}
