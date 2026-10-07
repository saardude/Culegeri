# About and sources

Built by Thomas Saar (BMus) in his honours year at the University of Melbourne. Culegeri (Romanian: gatherings, the word for folk-song collecting) is an academic, non-commercial study aid. It indexes Béla Bartók's ethnographic field collection, with a focus on localities in present-day Romania, and links every record back to the database or printed page that holds it. This project collects no data about its readers. Contact: tsaar@student.unimelb.edu.au.

The material is spread across three online databases and a five-volume printed edition, under Hungarian, Romanian and English place names. Culegeri puts it on one map, with the borders of the day, so that a melody, its village and its trip can be read together.

![Figure 1. The Explorer with Bihor County selected: filter rail, map and results list.](/about/figure-1.jpg)

## What Culegeri holds

### The databases

The record data comes from three databases of the HUN-REN BTK Institute for Musicology (Zenetudományi Intézet) in Budapest, home of the Bartók Archives. *Folk Music in Bartók's Compositions* documents the 261 folk melodies Bartók used in his own works, with place and date of collection, informant and, where one exists, the phonograph recording (HUN-REN BTK ZTI 2020–2025). *The Bartók System* is Bartók's classification of his Hungarian folk-song collection, 13,817 record pages online; the Romanian, Slovak and other collections are named in it but not published there (HUN-REN BTK ZTI n.d.). *Béla Bartók, the Ethnomusicologist* holds 2,332 records arranged by collecting trip, with an index of 101 trips from 1904 to 1918 (HUN-REN BTK ZTI 2021a).

### The printed edition

The databases hold no records for Bartók's Romanian melodies as such. For those the viewer uses the printed edition, *Rumanian Folk Music*, edited by Benjamin Suchoff in five volumes, 1967 to 1975 (Bartók 1967–75). Digitised copies of volumes IV (carols and Christmas songs) and V (Maramureș County) were consulted; only facts and incipits are indexed, and every entry links to the page consulted. Volumes I to III are not indexed. Volume V prints no dates under its melodies because all come from one trip, 15 to 27 March 1913 (Bartók 1967–75, 5:xv).

### Counts

As of the crawl of 28 September 2026 Culegeri indexes 14,910 melodies: 4,015 resolve to a locality in present-day Romania, 3,332 of them with coordinates, and 830 come from *Rumanian Folk Music* IV and V. 5,012 records have a recording on the source site and 12,906 a year. The journey layer holds 178 trips, 44 with a sourced or documented itinerary. Every record links to its original catalogue entry, by reference code where the source prints one, otherwise by its position in the Bartók System or by site and record number.

![Figure 2. A song record: notation, audio, the "Collected on" block and the link to the source entry.](/about/figure-2.jpg)

## How the data was built, and its limits

### Records

Every record was parsed from its full catalogue page, not from a listing row, so the fields shown are the fields the source prints. The sites were fetched once, at one request per second, and kept in a cache.

### Genre

None of the three databases prints a genre label. Genre is known only for the 830 printed-edition entries, where the volumes' own classes give it. For the other 14,080 records the genre facet is empty.

### OCR

The printed-edition entries were read by optical character recognition and aligned with the volumes' own indexes and cross-references. OCR loses diacritics and confuses similar glyphs, so a village, a performer's name or a month from that pass can be wrong. Each entry keeps the raw line it was read from and links to the page.

### Place names

The sources give the historical Hungarian name and county of 1910 ("Belényes, Bihar"); the modern reader needs the Romanian name and present county ("Beiuș, Bihor"). The viewer holds both, keyed on the historical form, and derives the present country from the modern county. Coordinates come from the sources where they print them, otherwise from a gazetteer checked against Wikidata, whose structured data is in the public domain (Wikidata n.d.). Of 1,165 villages checked there, 673 matched an existing settlement, 86 a renamed one, one an abandoned one; 405 are marked "unknown", never guessed. 183 place strings, covering 2,606 records, remain unresolved, nearly all in the Hungarian and Slovak parts of the Bartók System.

![Figure 3. A county page: villages with counts and genre bars, and the melodies table.](/about/figure-3.jpg)

### Journeys

The Institute's trip index is the primary source: each of its 101 entries becomes a trip with its records attached. Over that sits a curated layer of 63 trips, 1904 to 1918, built from the day-by-day chronology of Bartók's life compiled by his son, from Imre Kelemen's 1978 account of the Romanian trips, and from the source lines and prefaces of *Rumanian Folk Music* (Bartók 2021; Kelemen 1978, 399–413). Records outside the index are grouped by date, with a gap of more than ten days starting a new trip. Each trip is labelled "sourced itinerary", "documented itinerary", "dates only" or "index only". Departures default to Budapest and are labelled "assumed". Where the sources disagree on a date, the trip keeps both readings.

![Figure 4. The Journeys page: the trip list and a sourced itinerary drawn on the 1910 county map.](/about/figure-4.jpg)

### Context

The context strip beside the journey map lists dated events: border changes, Bartók's publications of Romanian material, his statements on folk music and nationalism, and their reception. Each entry summarises a cited source; where the Institute's *Béla Bartók Writings* database holds the text, its bibliographic data are taken from there (HUN-REN BTK ZTI 2021b). The 1937 essay on folk-song research and nationalism and the 1942 essay "Race Purity in Music" are cited by their first printings (Bartók 1937, 166–68; Bartók 1942, 153–55). The strip presents documents; it takes no position.

### Legibility

Records with a wax-cylinder recording carry a legibility score from 0 (almost illegible) to 1 (perfectly legible), so the explorer can be limited to cylinder recordings and filtered or sorted by how well they can be heard. Gramophone discs of 1936 to 1938 and modern recordings of Bartók's compositions are not scored. The score is an automatic estimate. Sixty per cent of it measures how clearly the voice or instrument comes through: the voice is first separated from the surface noise (Défossez 2021), then judged on its estimated intelligibility (Kumar et al. 2023), on whether a speech recogniser finds the catalogue's first line in it (Radford et al. 2023), and on how distinctly its notes begin. Forty per cent measures the noise itself: a background-noise rating (Reddy, Gopal, and Cutler 2022) and hiss. The weights were fitted to the author's ratings of twenty cylinders, with which the score agrees in rank order at 0.86 (Spearman). Some cylinders carry a short spoken clip beside the song; clips are scored but not counted in the record's score. No instrumental cylinder was among the twenty, so their scores are the least certain. The scripts, the ratings and every track's score are in the repository under `audio/` and `data/recording-quality.json`.

### Use of an AI model

Claude (Fable 5.1), a large language model, was used to build this project: to write the scraping and data-building code, to resolve place names, to assemble the journey itineraries from the cited sources, to run the optical music recognition experiment, and to build and calibrate the legibility score. Its output was checked against the sources and the catalogue. It was useful for speed over a large catalogue, for consistent citations across many records, and for pipelines that can be re-run with the same result. It did not write the melodies' metadata; that is the Institute's and the printed edition's, and every record still links to its original entry.

## Sources

### Databases

*Folk Music in Bartók's Compositions*, edited by Márton Kerékfy and Viola Biró, with an introduction abridged from Vera Lampert's source catalogue (Lampert 2008b); *The Bartók System*; *Béla Bartók, the Ethnomusicologist*, edited by István Pávai and Pál Richter; and *Béla Bartók Writings*, edited by Viola Biró. All four are publications of the HUN-REN BTK Institute for Musicology, Budapest. Records, notation images and recordings remain the Institute's; this viewer is an independent interface and is not affiliated with it.

### Printed edition and itinerary scholarship

Béla Bartók, *Rumanian Folk Music*, ed. Benjamin Suchoff, 5 vols. (The Hague: Martinus Nijhoff; Bartók 1967–75). For the itineraries: the chronology of Bartók's life by his son (Bartók 2021; first edition Bartók 1981); Kelemen's 1978 article (Kelemen 1978); and the prefaces and source lines of *Rumanian Folk Music* IV and V. Lampert's study of Bartók's transcription methods informed how the record fields are read (Lampert 2008a, 383–405).

### Borders, villages, tiles

County boundaries of the Kingdom of Hungary in 1910 are from GISta Hungarorum (OTKA K 111766), CC BY-NC, accurate to 0.5 to 1 km at settlement level (GIStory n.d.). State borders for 1914 and 1920 are from the historical-basemaps project of Andrés Ourednik and contributors, GPL-3.0, which calls itself work in progress; 1914 stands in for 1910 and 1920 for the post-war state (Ourednik n.d.). Present-day countries and Romanian counties are Natural Earth 1:10m, public domain (Natural Earth n.d.). Trips to 1913 get the 1910 counties, 1914 to 1918 the 1914 outline, anything later the 1920 outline. Village names, coordinates, administrative units and status are from Wikidata, CC0. Map tiles: base map data © OpenStreetMap contributors, Open Database License; tiles in the Positron style © CARTO (OpenStreetMap n.d.; CARTO n.d.).

![Figure 5. The Explorer's borders control in compare mode: 1910 counties left of the divider, present-day counties right.](/about/figure-5.jpg)

## Use cases

### A melody, its village, its trip

A record's rail gives Where, Who and when, Music and Source. "Where" links to the village and the county, and the date to the trip, where one is known. The trip page draws the route on the border layer for that year, with a then-and-now toggle: a melody recorded in Bihar in January 1912 sits inside Bihar County of the Kingdom of Hungary; one click shows the same point in Bihor County, Romania.

### Neighbouring villages

The county page lists every village with its melody count and a genre bar, and its melodies table sorts by title, style, location, year or source number. For the Maramureș volume, where every melody is classed, the distribution of hore, dance melodies and colinde across the twelve villages is visible at once.

### Informants and collectors

Performer names are indexed as printed, and the county page has a "by performer" tab. A melody published in both the Bartók System and the Ethnomusicologist site is one merged record with both catalogue links.

### Checking a date

Kelemen re-dates the Borz songs from April to February 1914 on the evidence of cylinder numbers; the printed edition prints "IV. 1914" (Kelemen 1978, 411–13n16; Bartók 1967–75, vol. 4). The trip entry keeps the conflict, and the year filter and the sort by source number show which records fall on either side.

![Figure 6. A stop in the Maramureș trip of March 1913, with the name then and now and the village status badge.](/about/figure-6.jpg)

### Shareable filters and export

Every filter, sort and place selection is written into the address bar, so a link to "colinde from Hunedoara, 1913 to 1914, sorted by source number" opens the same list for everyone. The results panel, the county page and each trip page have an "Export JSON" button that writes the current records, with their source links and raw fields, to a file.

![Figure 7. The results panel with active filter chips, the query string in the status bar and the Export JSON button.](/about/figure-7.jpg)

### Encoding the notation

The notation images are scans of Bartók's master sheets and of typeset pages. A project note (docs/MEI-OMR-RESEARCH.md) tests whether optical music recognition can turn them into Music Encoding Initiative files, the XML standard for scholarly music encoding (Music Encoding Initiative n.d.). Typeset and digitally engraved score images could be read with high confidence; handwritten scores need additional model training before they are usable. None of it is in the site yet.

## Beyond Bartók

The model is small: a record, a place, a journey and a source, with a gazetteer of historical and modern names, cited itineraries and border layers by year. Other collections fit it.

### Béla Vikár

Vikár was the first European to use the phonograph in ethnographic fieldwork; his recordings from 1896 open the Museum of Ethnography's cylinder collection in Budapest, which Bartók, Kodály and their students grew to 4,500 cylinders (Museum of Ethnography n.d.). His localities are the villages and counties of 1910 that the gazetteer already holds.

### Zoltán Kodály

Kodály's manuscript melody collection, compiled between 1905 and 1958, is part of the Institute's Folk Music Collection, online through Hungaricana with copies of the Museum of Ethnography's phonograph and gramophone recordings (Hungaricana n.d.).

### Percy Grainger

Grainger's Edison cylinders of English, Danish, Rarotongan and Māori singers, made from 1906, are held at the Grainger Museum of the University of Melbourne; the folk-song manuscripts are catalogued at the Radford, Alec, Jong Wook Kim, Tao Xu, Greg Brockman, Christine McLeavey, and Ilya Sutskever. 2023. "Robust Speech Recognition via Large-Scale Weak Supervision." In *Proceedings of the 40th International Conference on Machine Learning*. https://arxiv.org/abs/2212.04356.

Reddy, Chandan K. A., Vishak Gopal, and Ross Cutler. 2022. "DNSMOS P.835: A Non-Intrusive Perceptual Objective Speech Quality Metric to Evaluate Noise Suppressors." In *ICASSP 2022: IEEE International Conference on Acoustics, Speech and Signal Processing*. https://arxiv.org/abs/2110.01763.

Vaughan Williams Memorial Library in London (Grainger Museum n.d.; VWML n.d.). Each recording carries a date and a place, which is all the model needs.

### Fieldwork today

The same model applies to an ethnomusicologist's own recordings: dated, geolocated files with consent and rights metadata on each record; the record, place, journey and source structure; and an itinerary published with its sources from the start rather than reconstructed a century later. Any collection needs a stable link and a dated locality per record, and a licence that allows the facts to be indexed. Two cautions apply to any such collection. Place names are political: most villages in this dataset have a Hungarian name from the 1910 catalogue cards and a Romanian name from after 1920, and some were renamed again for political reasons, as Cuhea became Bogdan Vodă in 1968. Culegeri shows both (or all available names) and keeps the borders of the day beside today's. Rights in recordings belong to the archives and the communities recorded. A viewer of this kind should therefore index and link, not copy.

## Licensing and access

The site is for academic, non-commercial use and is publicly readable. Management functions (corrections to place resolution, annotations, flagging OCR errors) are planned for a later phase and will be gated to scholars. The CC BY-NC and GPL-3.0 border datasets are acceptable on that basis and their attribution is shown. The printed volumes remain in copyright, and the viewer reproduces neither notation nor song texts from them. The viewer's own code and derived JSON have no licence yet; until one is chosen, all rights are reserved.

## Report an error

Write to tsaar@student.unimelb.edu.au with the record's link and what the source says instead.

---

## References

Bartók, Béla. 1937. "Népdalkutatás és nacionalizmus." *Tükör* 5 (3): 166–68. Entry in *Béla Bartók Writings*, https://bartok-irasai.zti.hu/en/irasok/nepdalkutatas-es-nacionalizmus-2/.

Bartók, Béla. 1942. "Race Purity in Music." *Modern Music* 19 (3): 153–55. Entry in *Béla Bartók Writings*, https://bartok-irasai.zti.hu/en/irasok/race-purity-in-music-2/.

Bartók, Béla. 1967–75. *Rumanian Folk Music*. Edited by Benjamin Suchoff. 5 vols. Bartók Archives Studies in Musicology. The Hague: Martinus Nijhoff. Vol. 4, *Carols and Christmas Songs (Colinde)*, 1975, https://doi.org/10.1007/978-94-010-1683-4; vol. 5, *Maramureș County*, 1975, https://doi.org/10.1007/978-94-010-1686-5.

Bartók, Béla, ifj. 1981. *Apám életének krónikája*. Nagy muzsikusok életének krónikája 16. Budapest: Zeneműkiadó.

Bartók, Béla, ifj. 2021. *Bartók Béla életének krónikája*. Edited by Vásárhelyi Gábor. Budapest: Magyarságkutató Intézet. Digital copy at Magyar Elektronikus Könyvtár, accessed September 28, 2026, https://mek.oszk.hu/22000/22043/.

CARTO. n.d. "Attributions." Accessed September 28, 2026. https://carto.com/attributions.

Défossez, Alexandre. 2021. "Hybrid Spectrogram and Waveform Source Separation." In *Proceedings of the ISMIR 2021 Workshop on Music Source Separation*. https://arxiv.org/abs/2111.03600.

GIStory. n.d. "GISta Hungarorum (OTKA K 111766)." Accessed September 28, 2026. https://www.gistory.hu/g/en/gistory/otka.

Grainger Museum, University of Melbourne. n.d. Home page. Accessed September 28, 2026. https://grainger.unimelb.edu.au/.

Hungaricana. n.d. "The Folk Music Collection of the HAS–RCH Institute for Musicology." Accessed September 28, 2026. https://www.hungaricana.hu/en/databases/zti/.

HUN-REN BTK Institute for Musicology (HUN-REN BTK ZTI). n.d. "The Bartók System." Accessed September 28, 2026. https://systems.zti.hu/br/en. History page: https://systems.zti.hu/br/en/history.

HUN-REN BTK Institute for Musicology (HUN-REN BTK ZTI). 2020–2025. "Folk Music in Bartók's Compositions." Edited by Márton Kerékfy and Viola Biró. Accessed September 28, 2026. https://bartok-nepzene.zti.hu/en/. Credits: https://bartok-nepzene.zti.hu/en/credits/.

HUN-REN BTK Institute for Musicology (HUN-REN BTK ZTI). 2021a. "Béla Bartók, the Ethnomusicologist." Edited by István Pávai and Pál Richter. Accessed September 28, 2026. https://bartok-gyujtesek.zti.hu/en. Trip index: https://bartok-gyujtesek.zti.hu/en/browse.

HUN-REN BTK Institute for Musicology (HUN-REN BTK ZTI). 2021b. "Béla Bartók Writings." Edited by Viola Biró. Accessed September 28, 2026. https://bartok-irasai.zti.hu/en/.

Kelemen, Imre. 1978. "Bartók román népzenegyűjtő útjai." *Acta Academiae Paedagogicae Agriensis*, n.s., 14: 399–415. http://publikacio.uni-eszterhazy.hu/689/.

Kumar, Anurag, Ke Tan, Zhaoheng Ni, Pranay Manocha, Xiaohui Zhang, Ethan Henderson, and Buye Xu. 2023. "TorchAudio-Squim: Reference-less Speech Quality and Intelligibility Measures in TorchAudio." In *ICASSP 2023: IEEE International Conference on Acoustics, Speech and Signal Processing*. https://arxiv.org/abs/2304.01448.

Lampert, Vera. 2008a. "Bartók and the Berlin School of Ethnomusicology." *Studia Musicologica* 49 (3–4): 383–405. https://doi.org/10.1556/smus.49.2008.3-4.9.

Lampert, Vera. 2008b. *Folk Music in Bartók's Compositions: A Source Catalog; Arab, Hungarian, Romanian, Ruthenian, Serbian, and Slovak Melodies*. Budapest: Hungarian Heritage House.

Museum of Ethnography, Budapest. n.d. "Folk Music Collection (Audio Materials and Transcription of Melodies)." Accessed September 28, 2026. http://www.neprajz.hu/en/gyujtemenyek/ethnological-archives/audio-archive/audio_archive.html.

Music Encoding Initiative. n.d. "About." Accessed September 28, 2026. https://music-encoding.org/about/.

Natural Earth. n.d. "Terms of Use." Accessed September 28, 2026. https://www.naturalearthdata.com/about/terms-of-use/.

OpenStreetMap. n.d. "Copyright and License." Accessed September 28, 2026. https://www.openstreetmap.org/copyright.

Ourednik, Andrés, and contributors. n.d. "Historical Boundaries of World Countries and Cultural Regions." GitHub repository aourednik/historical-basemaps. Accessed September 28, 2026. https://github.com/aourednik/historical-basemaps.

Vaughan Williams Memorial Library (VWML), English Folk Dance and Song Society. n.d. "Percy Grainger Folk Song Collection." Archives catalogue PG. Accessed September 28, 2026. https://archives.vwml.org/records/PG.

Wikidata. n.d. "Wikidata:Licensing." Accessed September 28, 2026. https://www.wikidata.org/wiki/Wikidata:Licensing.
