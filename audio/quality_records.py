"""Record-level legibility from the per-track scores in data/recording-quality.json.

Some cylinders carry a short numbered clip beside the song (MH_1250a and MH_1250a0, KF_252a and
KF_252a2). Listening and Whisper agree the clip is spoken or a fragment, not the song, and speech
measures rate speech clearer than singing, so a record that took its best track was often scored on
the clip. A clip is a track whose ID ends in a number after the side letter and that lasts 20 s or
less; longer numbered tracks (a second take, a side split into a1 and a2) count as songs.

A record's score is its best non-clip track. A record with clips only is scored on its best clip and
flagged "clip-only".

  python audio/quality_records.py     # rewrite clips and records in data/recording-quality.json

Track lengths come from the full run's audit (durationS) when run_legibility.py writes the file, and
otherwise from audio/clip-lengths.json (numbered tracks and their main tracks, measured from the
mirror's Content-Length at 128 kbit/s on 3 October 2026).
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
CLIP_MAX_S = 20.0
NUMBERED = re.compile(r"^(?:MH|KF)_.*[a-z]\d+$")


def find_clips(tracks, lengths):
    """Numbered tracks of 20 s or less. A numbered track with no known length is not a clip."""
    return sorted((k for k in tracks if NUMBERED.match(k) and (lengths.get(k) or 1e9) <= CLIP_MAX_S), key=str.lower)


def record_scores(tracks, clips, songs):
    from run_legibility import build_tracks
    clip_set = {c.lower() for c in clips}
    score = {k.lower(): (k, v) for k, v in tracks.items()}
    by_record = {}
    for t in build_tracks(songs):
        if t["cyl"].lower() not in score:
            continue
        for rec in [t["record"], *t["otherRecords"]]:
            by_record.setdefault(rec, set()).add(t["cyl"].lower())
    out = {}
    for rec in sorted(by_record):
        cyls = by_record[rec]
        main = [score[c] for c in cyls if c not in clip_set]
        pool = main or [score[c] for c in cyls]
        cyl, legib = max(pool, key=lambda kv: (kv[1], kv[0]))
        out[rec] = {"legib": legib, "track": cyl, **({} if main else {"flag": "clip-only"})}
    return out


def annotate(doc, songs, lengths):
    """Add clips and records to a recording-quality document, in place."""
    clips = find_clips(doc["tracks"], lengths)
    doc["clipMaxSeconds"] = CLIP_MAX_S
    doc["clips"] = clips
    doc["records"] = record_scores(doc["tracks"], clips, songs)
    return doc


def main():
    import sys
    sys.path.insert(0, HERE)
    path = os.path.join(REPO, "data", "recording-quality.json")
    doc = json.load(open(path, encoding="utf-8"))
    songs = json.load(open(os.path.join(REPO, "data", "songs.json"), encoding="utf-8"))
    lengths = json.load(open(os.path.join(HERE, "clip-lengths.json"), encoding="utf-8"))
    annotate(doc, songs, lengths)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    flagged = sum(1 for r in doc["records"].values() if r.get("flag"))
    print(f"{len(doc['clips'])} clips; {len(doc['records'])} records, {flagged} flagged clip-only")


if __name__ == "__main__":
    main()
