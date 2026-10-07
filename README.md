# Culegeri

**Bartók's field collection in Romania, by village, trip and source.**
Live site: https://culegeri.vercel.app

Built by Thomas Saar (BMus) in his honours year at the University of Melbourne.
Culegeri (Romanian: gatherings, the word for folk-song collecting) is an academic,
non-commercial study aid. It indexes Béla Bartók's ethnographic field collection, with a
focus on localities in present-day Romania, and links every record back to the database or
printed page that holds it. The project collects no data about its readers.
Contact: tsaar@student.unimelb.edu.au.

The material is spread across three online databases and a five-volume printed edition,
under Hungarian, Romanian and English place names. Culegeri puts it on one map, with the
borders of the day, so that a melody, its village and its trip can be read together.

## What it holds

- **Records** from three databases of the HUN-REN BTK Institute for Musicology, Budapest:
  *Folk Music in Bartók's Compositions*, *The Bartók System* and *Béla Bartók, the
  Ethnomusicologist*. Every record was parsed from its full catalogue page and keeps a link
  to its original entry.
- **The printed edition.** The databases hold no records for Bartók's Romanian melodies as
  such. For those the viewer uses *Rumanian Folk Music*, ed. Benjamin Suchoff, 5 vols.
  (The Hague: Nijhoff, 1967 to 1975). Digitised copies of volumes IV and V were read by OCR;
  only facts and incipits are indexed, and every entry links to the page consulted.
- **Counts** as of the crawl of 28 September 2026: 14,910 melodies, of which 4,015 resolve
  to a locality in present-day Romania and 830 come from *Rumanian Folk Music* IV and V;
  178 journeys, 44 with a sourced or documented itinerary.
- **Places** under both their historical Hungarian and present Romanian names, with
  coordinates from the sources or from a gazetteer checked against Wikidata.
- **Journeys** built from the Institute's trip index and a curated layer of 63 trips
  (1904 to 1918) drawn from the day-by-day chronology of Bartók's life, Imre Kelemen's 1978
  account of the Romanian trips, and the printed edition. What is documented and what is
  inferred are marked separately, and conflicts between sources are kept as notes.
- **Borders** of 1910, 1914, 1920 and today, so a trip can be read against the state of
  the time.
- **Legibility** of the wax-cylinder recordings: 4,884 records with a playable cylinder carry an
  automatic score from 0 (almost illegible) to 1 (perfectly legible), 60% clarity of the voice
  or instrument and 40% noise, calibrated against the author's own ratings. The explorer can be
  limited to cylinder recordings and filtered or sorted by it. Method and scripts in `audio/`,
  scores in `data/recording-quality.json`.

The full account of sources, limits and use cases is on the site's
[About and sources](https://culegeri.vercel.app/about) page, which also lists the
references in Chicago author-date form.

## Use of an AI model

Claude (Fable 5.1), a large language model, was used to build this project: to write the
scraping and data-building code, to resolve place names, to assemble the journey
itineraries from the cited sources, and to run the optical music recognition experiment.
Its output was checked against the sources and the catalogue. It did not write the
melodies' metadata; every record still links to its original entry.

## A second collection: Australia

`australia/` holds a sister project on the same model: an index of Mark Gregory's *Australian
Folk Songs* (folkstream.com, 1994 to date), about 1,100 songs and poems rediscovered in digitised
Australian newspapers, mapped by the town where each paper was published. It has its own
scraper, data, gazetteer, tests and app, and is served under
https://culegeri.vercel.app/australia. See [australia/README.md](australia/README.md) and
[australia/docs/STATUS.md](australia/docs/STATUS.md).

## Repository layout

```
australia/ the Australia collection (scraper, data, geo, qa, app, docs); served at /australia
scripts/   build-site.mjs builds both apps into app/dist for Vercel
app/       the web app (Vite + React + TypeScript); app/src/content/about.md is the About page
data/      built catalogue: songs.json, places.json, facets.json, journeys.json, villages.json,
           journeys-curated.json, context-events.json, geo/ border layers, schema/, gazetteer.json
scraper/   Node crawler and normaliser for the three databases (fixtures and tests included)
print/     OCR pipeline for the printed edition (Rumanian Folk Music IV and V)
geo/       journeys derivation, border-layer build, Wikidata enrichment, itinerary research scripts
omr/       optical music recognition experiment (image to MEI) with sample results
qa/        data-quality gates run on every build
docs/      brief, plan, specs, source bibliographies, deploy runbook, research notes
```

Start with `docs/CONTEXT.md` and `docs/PLAN.md`; the data build is described in
`data/BUILD.md`, the itinerary sources in `docs/JOURNEY-SOURCES.md`, the printed-edition
pipeline in `docs/PRINT-SOURCES.md`, and the MEI experiment in `docs/MEI-OMR-RESEARCH.md`.

## Running it

Node 22 (see `.nvmrc`) and npm 10. Each of `scraper/`, `app/`, `geo/` and `print/` has its
own `package.json`; nothing is installed globally.

```
# the app, against the committed data
cd app && npm ci && npm run dev

# tests
cd app && npm run lint && npm run typecheck && npm test && npm run test:e2e

# rebuild the catalogue from the cached pages (network needed for a fresh crawl)
cd scraper && npm ci && node src/cli.js crawl all && node src/cli.js parse all \
  && node src/cli.js gazetteer && node src/cli.js build && node src/cli.js validate
node geo/derive-journeys.mjs && node geo/enrich-wikidata.mjs
node qa/checks/data-gates.mjs --file data/songs.json --journeys data/journeys.json --villages data/villages.json
```

The crawler runs at one request per second and caches every page; the outputs are
deterministic, so re-runs give clean diffs. Deployment to Vercel is described in
`docs/DEPLOY.md`; `vercel.json` builds both collections with `scripts/build-site.mjs`.

## Sources and attribution

Record data: HUN-REN BTK Institute for Musicology, Budapest (Bartók Archives). Records,
notation images and recordings remain the property of the Institute; this project is an
independent interface and is not affiliated with it. Printed edition: Béla Bartók,
*Rumanian Folk Music*, ed. Benjamin Suchoff (Nijhoff, 1967 to 1975). Historical county
boundaries (1910): GISta Hungarorum, OTKA K 111766, CC BY-NC. Historical state borders:
historical-basemaps by André Ourednik and contributors, GPL-3.0, approximate. Present-day
boundaries: Natural Earth, public domain. Village data: Wikidata, CC0. Map tiles:
© OpenStreetMap contributors, © CARTO.

## Licence

Academic use only. See [LICENSE](LICENSE). The code and the derived data files in this
repository may be used, copied and adapted for non-commercial research and teaching with
attribution; commercial use is not permitted. The underlying records, images and
recordings are not covered by this licence and remain subject to the terms of their
holders, listed above.

## Reporting an error

Write to tsaar@student.unimelb.edu.au with the record's link and what the source says
instead.
