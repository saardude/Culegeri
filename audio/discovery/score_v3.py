"""Legibility v3: v2's structure with weights fitted to the owner's ratings of 20 cylinders (2 Oct 2026).

legib = 0.6 x clarity + 0.4 x noise
  clarity = 0.50 intelligibility (SQUIM STOI, mix) + 0.25 words (Whisper vs catalogue first line,
            separated voice) + 0.25 rhythm (onset clarity, separated target)
  noise   = 0.80 DNSMOS background (BAK) + 0.20 low hiss (librosa voice-band flatness)

Dropped after calibration: CREPE pitch confidence and Praat HNR (ran against the ratings; they still
reward quiet recordings), overtones and phoneme confidence (no gain), the click counter and frequency
range (inverted: they rate the noisiest recordings as cleanest).
Rank agreement with the owner's combined ratings: 0.86 (v2 0.42, v1 0.38); clarity 0.80, noise 0.86.

First line: the record's own incipit, else the bracketed line in its title, else the first line of
another record of the same cylinder (fmbc entries borrow from bsys); else words get 0.5.

Usage: python score_v3.py features_v2.json scores.json out.json
"""
import json, sys

lin = lambda x, lo, hi: min(1.0, max(0.0, (x - lo) / (hi - lo)))
W_CLARITY, W_NOISE = 0.6, 0.4


def clarity(f, stoi):
    parts = {"intelligibility": lin(stoi, 0.4, 0.75), "rhythm": lin(f["rhythm"], 2, 10)}
    inc = (f.get("incipit") or {}).get("match")
    # no first line anywhere in the catalogue (41 cylinder records): neutral half credit for words
    parts["words"] = lin(inc, 0.3, 1.0) if inc is not None else 0.5
    w = {"intelligibility": 0.50, "words": 0.25, "rhythm": 0.25}
    return sum(parts[k] * w[k] for k in w), parts


def noise(old):
    parts = {"background": lin(old["dnsmos"]["bak"], 1.0, 3.5), "hiss": old["librosa"]["parts"]["noise"]}
    return 0.8 * parts["background"] + 0.2 * parts["hiss"], parts


if __name__ == "__main__":
    F, OLD = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
    out = {}
    for cyl, f in F.items():
        cs, cp = clarity(f, OLD[cyl]["squim"]["stoi"])
        ns, npart = noise(OLD[cyl])
        out[cyl] = {"legib": round(W_CLARITY * cs + W_NOISE * ns, 3), "clarity": round(cs, 3), "noise": round(ns, 3),
                    "clarity_parts": {k: round(v, 2) for k, v in cp.items()},
                    "noise_parts": {k: round(v, 2) for k, v in npart.items()}}
    json.dump(out, open(sys.argv[3], "w"), ensure_ascii=False, indent=1)
