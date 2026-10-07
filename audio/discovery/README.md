# Cylinder legibility: discovery run (1 October 2026)

Test of reference-free audio-quality systems on 20 wax-cylinder recordings, to choose a
0 (almost illegible) to 1 (perfectly legible) score for a "wax cylinder only" filter.
Nothing here is wired into the app or the data build yet; the full run over all cylinder
tracks has not been done.

- `sample.json`: the 20 records (stratified by collector and decade; MH/KF cylinder series only).
- `score.py`: DNSMOS P.835 (speechmos), NISQA (torchmetrics, CC BY-NC-SA weights),
  TorchAudio SQUIM (STOI), Whisper small (faster-whisper) and a librosa signal score.
- `validate.py`: wear test, one recording degraded in five steps (noise, low-pass, crackle).
- `scores.json`, `validate.json`: raw outputs. `report-data.json`: the table behind the report,
  including the proposed blend `legib = 0.7 × librosa + 0.3 × lin(DNSMOS OVRL, 1.0, 2.4)`.

Findings: NISQA floors at 0 on every cylinder; SQUIM barely moves (0.40 to 0.70, 0.59 to 0.45
under wear); Whisper drops to 0 by the second wear step and was dropped for speed; ViSQOL is
full-reference (no clean copy of a cylinder exists) and the genderrecognition.com checker is a
closed paid API, so neither was run. The blend spreads 0.27 to 0.82 on the sample and falls at
every wear step (0.82 to 0.11).

Run (Python 3.11): `pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu`,
then `pip install onnxruntime librosa soundfile scipy speechmos torchmetrics faster-whisper`;
convert each MP3 to 16 kHz mono WAV named by cylinder, then
`python score.py sample.json wav scores.json --only dnsmos,librosa`.

## Version 2: clarity of the target (60%) + noise (40%)

Version 1 mostly measured noise, so a quiet cylinder with a dull voice ranked first and a noisy
cylinder with a clear voice last. Version 2 separates the target first (torchaudio
`HDEMUCS_HIGH_MUSDB_PLUS`) and scores the separated voice or instrument:

- `features_v2.py` (stage 1, slow): words (Whisper small vs the catalogue first line, wav2vec2
  XLSR-53 phoneme confidence), CREPE pitch confidence, harmonic richness (overtones above 1 kHz read
  at multiples of f0, so hiss cannot count), Praat harmonics-to-noise, onset clarity. The catalogue
  decides sung vs instrumental; first 60 s of each recording.
- `score_v2.py` (stage 2, instant): `legib = 0.6 × clarity + 0.4 × noise`; noise reuses the v1
  librosa noise features and DNSMOS background (BAK). Mapping ranges are fixed a priori.
- `features_v2.json`, `v2.json`: raw features and scores for the 20.

Result: Spearman 0.40 between v1 and v2 rankings; MH_1381b moves from 20th to 4th, MH_0432e from
2nd to 7th. About 70–90 s per recording on 4 CPU cores; a GPU run is planned for the full corpus.
Install additionally: `pip install torchcrepe praat-parselmouth transformers rapidfuzz`.

## Version 3: calibrated to the owner's ratings (2 October 2026)

`owner-ratings.json` holds the owner's ratings of the 20 cylinders: clarity of the voice or
instrument and noise (1 = little noise), each 0–1, combined 0.6 / 0.4. Weights inside each half
were fitted with non-negative weights summing to 1 and checked leave-one-out; `score_v3.py` has the
result:

- clarity = 0.50 SQUIM intelligibility + 0.25 words vs first line + 0.25 rhythm (separated voice)
- noise = 0.80 DNSMOS background + 0.20 low hiss

Rank agreement with the owner's combined ratings: v3 0.86, v2 0.42, v1 0.38. Clarity half 0.80,
noise half 0.86. First lines are borrowed by cylinder number when a record has none (fmbc entries
name Bartok's piece; the bsys record of the same cylinder has the sung line): 70 of the 111 cylinder
records without a first line recover one, the other 41 get half credit for words. This moved
MH_1046b from 1st to 7th (Whisper hears no words in it). Pitch
confidence and HNR ran against the ratings; the click counter and frequency range were inverted.
`unseparated-test.json`: words and rhythm measured without separation drop the combined
agreement to 0.74, so separation stays. No instrumental recording was in the sample.

## Record scores leave out spoken clips (3 October 2026)

319 tracks have a numbered twin (MH_1250a and MH_1250a0). Most are short clips (median 7.9 s) that
the owner and Whisper both hear as spoken announcements or fragments, not the song; speech measures
score them higher, so a record that took its best track was often scored on the clip.
`audio/quality_records.py` marks a track as a clip when its ID ends in a number after the side letter
and it lasts 20 s or less (316 tracks; lengths in `audio/clip-lengths.json`). A record's score is its
best non-clip track; the 2 records with clips only are scored on the clip and flagged "clip-only".
This changed 241 record scores (mean drop 0.18). `data/recording-quality.json` now holds `tracks`
(every track), `clips` and `records` (`{"legib", "track", "flag"?}` per record).
