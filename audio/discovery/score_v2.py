"""Legibility v2, stage 2: one score = 0.6 x target clarity + 0.4 x noise.

Usage: python score_v2.py features_v2.json scores.json out.json
Mapping ranges are fixed a priori (not fitted to the sample); weights inside each half are
priors until calibrated against human ratings.
"""
import json, sys

lin = lambda x, lo, hi: min(1.0, max(0.0, (x - lo) / (hi - lo)))
W_CLARITY, W_NOISE = 0.6, 0.4


def wavg(pairs):
    pairs = [(v, w) for v, w in pairs if v is not None]
    return sum(v * w for v, w in pairs) / sum(w for _, w in pairs)


def clarity(f, stoi):
    c = {
        "pitch": lin(f["pitch"], 0.3, 0.9),         # CREPE pitch confidence on the separated target
        "richness": lin(f["richness"], -15, 10),    # overtones above 1 kHz, read at the partials (not hiss)
        "hnr": lin(f["hnr"], 0, 25),                # Praat harmonics-to-noise of the target
        "rhythm": lin(f["rhythm"], 2, 10),          # onset clarity of the target
    }
    if f["vocal"]:
        inc = (f.get("incipit") or {}).get("match")
        c["words"] = wavg([
            (lin(inc, 0.3, 1.0) if inc is not None else None, 0.40),  # Whisper vs catalogue first line
            (lin(f["phoneme"]["conf"], 0.3, 0.8), 0.35),               # wav2vec2 phoneme confidence
            (lin(stoi, 0.4, 0.75), 0.25),                              # SQUIM intelligibility estimate
        ])
        w = {"words": 0.35, "pitch": 0.30, "richness": 0.20, "hnr": 0.10, "rhythm": 0.05}
    else:
        w = {"pitch": 0.45, "richness": 0.25, "hnr": 0.15, "rhythm": 0.15}
    return sum(c[k] * w[k] for k in w), c


def noise(old):
    p = old["librosa"]["parts"]
    n = {"snr": p["snr"], "hiss": p["noise"], "clicks": p["clicks"], "bandwidth": p["bandwidth"],
         "background": lin(old["dnsmos"]["bak"], 1.0, 3.5)}
    w = {"snr": 0.25, "hiss": 0.20, "clicks": 0.20, "bandwidth": 0.15, "background": 0.20}
    return sum(n[k] * w[k] for k in w), n


if __name__ == "__main__":
    F, OLD = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
    out = {}
    for cyl, f in F.items():
        cs, cp = clarity(f, OLD[cyl]["squim"]["stoi"])
        ns, npart = noise(OLD[cyl])
        out[cyl] = {"legib": round(W_CLARITY * cs + W_NOISE * ns, 3), "clarity": round(cs, 3), "noise": round(ns, 3),
                    "vocal": f["vocal"], "clarity_parts": {k: round(v, 2) for k, v in cp.items()},
                    "noise_parts": {k: round(v, 2) for k, v in npart.items()},
                    "heard": (f.get("incipit") or {}).get("text"), "first_line": f.get("first_line")}
    json.dump(out, open(sys.argv[3], "w"), ensure_ascii=False, indent=1)
