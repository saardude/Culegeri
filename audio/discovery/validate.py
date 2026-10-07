"""Sanity check: degrade one recording in graded steps; a usable scorer must fall monotonically.

Usage: python validate.py wav/CYL.wav out.json
"""
import json, sys
import numpy as np, scipy.signal as ss
from score import SYSTEMS, load, SR

rng = np.random.default_rng(0)
y = load(sys.argv[1])[: 30 * SR]
y = y / np.max(np.abs(y)) * 0.8
p = np.mean(y ** 2)


def noise(y, snr):
    return y + rng.normal(0, np.sqrt(p / 10 ** (snr / 10)), len(y)).astype("float32")


def lowpass(y, fc):
    b, a = ss.butter(6, fc, fs=SR)
    return ss.lfilter(b, a, y).astype("float32")


def crackle(y, per_s):
    z = y.copy()
    idx = rng.integers(0, len(y), int(per_s * len(y) / SR))
    z[idx] += rng.choice([-1, 1], len(idx)) * rng.uniform(0.3, 0.9, len(idx))
    return z


# compound "cylinder wear" ladder: each step adds noise, narrows the band and adds crackle
LADDER = [
    ("original", y),
    ("wear 1", crackle(lowpass(noise(y, 25), 5000), 10)),
    ("wear 2", crackle(lowpass(noise(y, 15), 3000), 40)),
    ("wear 3", crackle(lowpass(noise(y, 8), 2000), 120)),
    ("wear 4", crackle(lowpass(noise(y, 3), 1200), 300)),
    ("wear 5", crackle(lowpass(noise(y, -3), 800), 600)),
]

out = {}
for label, z in LADDER:
    z = np.clip(z, -1, 1).astype("float32")
    out[label] = {}
    for name, f in SYSTEMS.items():
        try:
            out[label][name] = round(f(z) ["score"], 3) if name != "whisper" else round(f(z, "hu")["score"], 3)
        except Exception as e:
            out[label][name] = None
        print(label, name, out[label][name], flush=True)
json.dump(out, open(sys.argv[2], "w"), indent=1)
