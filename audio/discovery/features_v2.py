"""Legibility v2, stage 1: separate the target (voice or instrument) from the noise, then measure
the target's clarity. Raw measurements only; stage 2 (score_v2.py) maps and weights them.

Usage: python features_v2.py sample.json mp3_dir features_v2.json
Analyses the first 60 s of each recording.
"""
import json, os, sys, re, subprocess, unicodedata, warnings
import numpy as np, torch, torchaudio, librosa, parselmouth, torchcrepe
from rapidfuzz import fuzz

warnings.filterwarnings("ignore")
torch.set_num_threads(4)
SR_SEP, SR = 44100, 16000
MAX_S = 60
LANG = {"Hungarian": "hu", "Romanian": "ro", "Slovak": "sk"}

_sep = _w2v = _wh = None


def load_stereo(path):
    raw = subprocess.check_output(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path, "-t", str(MAX_S),
                                   "-ac", "2", "-ar", str(SR_SEP), "-f", "f32le", "-"])
    return torch.from_numpy(np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.copy())


def separate(mix):
    """Hybrid Demucs (torchaudio HDEMUCS_HIGH_MUSDB_PLUS): drums, bass, other, vocals."""
    global _sep
    if _sep is None:
        _sep = torchaudio.pipelines.HDEMUCS_HIGH_MUSDB_PLUS.get_model().eval()
    ref = mix.mean(0)
    x = (mix - ref.mean()) / (ref.std() + 1e-8)
    seg, ov = 10 * SR_SEP, SR_SEP  # 10 s chunks with 1 s linear cross-fade
    out = torch.zeros(4, 2, x.shape[1])
    wsum = torch.zeros(x.shape[1])
    with torch.no_grad():
        for s in range(0, x.shape[1], seg - ov):
            e = min(s + seg, x.shape[1])
            if e - s < SR_SEP // 2:
                break
            y = _sep(x[None, :, s:e])[0]
            w = torch.ones(e - s)
            f = min(ov, e - s)
            if s > 0: w[:f] = torch.linspace(0, 1, f)
            if e < x.shape[1]: w[-f:] = torch.minimum(w[-f:], torch.linspace(1, 0, f))
            out[:, :, s:e] += y * w
            wsum[s:e] += w
            if e == x.shape[1]:
                break
    out = out / wsum.clamp(min=1e-6) * ref.std() + ref.mean()
    names = _sep.sources
    return {n: out[i].mean(0).numpy() for i, n in enumerate(names)}


def to16(y):
    return librosa.resample(y, orig_sr=SR_SEP, target_sr=SR).astype(np.float32)


def active_mask(y, hop):
    rms = librosa.feature.rms(y=y, frame_length=2 * hop, hop_length=hop)[0]
    return rms, rms > np.percentile(rms, 50)


def pitch_clarity(y):
    """CREPE periodicity (pitch confidence) over the louder half of the target."""
    hop = 320  # 20 ms
    x = torch.from_numpy(y)[None]
    f0, per = torchcrepe.predict(x, SR, hop, 60, 1200, model="full", batch_size=512, device="cpu", return_periodicity=True)
    per = torchcrepe.filter.median(per, 3)[0].numpy()
    _, act = active_mask(y, hop)
    n = min(len(per), len(act))
    return float(np.mean(per[:n][act[:n]])), f0[0].numpy(), per


def hnr(y):
    """Praat harmonics-to-noise ratio (dB), mean over voiced frames."""
    h = parselmouth.Sound(y.astype(np.float64), SR).to_harmonicity_cc(time_step=0.01, minimum_pitch=75)
    v = h.values[0]
    v = v[v > -100]
    return float(np.mean(v)) if len(v) else -10.0


def harmonic_richness(y, f0, per):
    """Overtone energy above 1 kHz vs below, read only at multiples of the tracked pitch (dB).
    Hiss sits between the partials, so it cannot raise this; a muffled voice lowers it."""
    hop, nfft = 320, 2048
    S = np.abs(librosa.stft(y, n_fft=nfft, hop_length=hop)) ** 2
    fr = librosa.fft_frequencies(sr=SR, n_fft=nfft)
    hi = lo = 0.0
    for t in range(min(S.shape[1], len(f0))):
        if per[t] < 0.5:
            continue
        for k in range(1, 60):
            fk = k * f0[t]
            if fk > 4000:
                break
            band = (fr >= fk * 0.97) & (fr <= fk * 1.03)
            if not band.any():
                continue
            pk = S[band, t].max()
            if fk >= 1000: hi += pk
            else: lo += pk
    return float(10 * np.log10((hi + 1e-12) / (lo + 1e-12)))


def presence(y):
    """Energy 1-4 kHz relative to 100-1000 Hz in dB, louder frames only (low = muffled)."""
    S = np.abs(librosa.stft(y, n_fft=1024, hop_length=256)) ** 2
    fr = librosa.fft_frequencies(sr=SR, n_fft=1024)
    _, act = active_mask(y, 256)
    n = min(S.shape[1], len(act))
    S = S[:, :n][:, act[:n]]
    hi = S[(fr >= 1000) & (fr <= 4000)].sum()
    lo = S[(fr >= 100) & (fr < 1000)].sum()
    return float(10 * np.log10((hi + 1e-12) / (lo + 1e-12)))


def rhythm(y):
    """Onset clarity: how far onset peaks stand above the onset-strength floor."""
    o = librosa.onset.onset_strength(y=y, sr=SR, hop_length=256)
    return float(np.percentile(o, 95) / (np.median(o) + 1e-6))


def phoneme_conf(y):
    """wav2vec2 XLSR-53 phoneme CTC: mean top-phoneme probability over non-blank frames."""
    global _w2v
    from transformers import AutoModelForCTC, Wav2Vec2FeatureExtractor
    if _w2v is None:
        name = "facebook/wav2vec2-xlsr-53-espeak-cv-ft"
        _w2v = (Wav2Vec2FeatureExtractor.from_pretrained(name), AutoModelForCTC.from_pretrained(name).eval())
    fe, m = _w2v
    x = fe(y[: 30 * SR], sampling_rate=SR, return_tensors="pt").input_values
    with torch.no_grad():
        p = m(x).logits[0].softmax(-1)
    top, idx = p.max(-1)
    blank = m.config.pad_token_id
    nb = idx != blank
    return {"conf": float(top[nb].mean()) if nb.any() else 0.0, "rate": float(nb.float().mean())}


def norm(s):
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z ]+", " ", s).split()


def incipit_match(y, incipit, lang):
    """Whisper transcript of the first 30 s vs the catalogue incipit (partial fuzzy match, 0-1)."""
    global _wh
    from faster_whisper import WhisperModel
    if _wh is None:
        _wh = WhisperModel("small", device="cpu", compute_type="int8", cpu_threads=4)
    segs, _ = _wh.transcribe(y[: 30 * SR], language=lang, beam_size=5, condition_on_previous_text=False)
    text = " ".join(s.text.strip() for s in segs)
    if not incipit:
        return {"match": None, "text": text}
    a, b = " ".join(norm(incipit)), " ".join(norm(text))
    return {"match": fuzz.partial_ratio(a, b) / 100 if b else 0.0, "text": text[:160]}


if __name__ == "__main__":
    sample, mp3dir, out = sys.argv[1:4]
    songs = {s["id"]: s for s in json.load(open("/home/user/Culegeri/data/songs.json"))}
    own_first = lambda s: s.get("incipit") or (re.search(r"\[([^\]]+)\]", s.get("title") or "") or [None, None])[1]
    # the same cylinder is often catalogued twice (fmbc names Bartok's piece, bsys has the sung first line)
    by_cyl = {}
    for o in songs.values():
        refs = [a["url"] for a in o["media"]["audio"]] + [o["rawFields"].get("Sound recording") or ""]
        for u in refs:
            m = re.search(r"((?:MH|KF)_[0-9A-Za-z]+)", u)
            if m and own_first(o):
                by_cyl.setdefault(m.group(1).lower(), own_first(o))
    res = json.load(open(out)) if os.path.exists(out) else {}
    for p in json.load(open(sample)):
        if p["cyl"] in res:
            continue
        mix = load_stereo(os.path.join(mp3dir, p["cyl"] + ".mp3"))
        st = separate(mix)
        e = {k: float(np.mean(v ** 2)) for k, v in st.items()}
        tonal = e["vocals"] + e["other"] + e["bass"]  # drums mostly collects cylinder clicks
        vshare = e["vocals"] / (tonal + 1e-12)
        s = songs[p["id"]]
        first = own_first(s) or by_cyl.get(p["cyl"].lower())
        # the catalogue decides voice vs instrument; the separator only when the catalogue is silent
        sung = s["performance"] in ("vocal", "mixed") or (s["performance"] != "instrumental" and bool(first))
        vocal = sung or (s["performance"] != "instrumental" and vshare >= 0.5)
        if vocal:  # a buried voice the separator was unsure of can land in "other": analyse both
            tgt = to16(st["vocals"] if vshare >= 0.5 else st["vocals"] + st["other"])
        else:
            tgt = to16(st["other"] + st["bass"])
        lang = LANG.get(s["performer"].get("ethnicity") or "", "hu")
        pc, f0, per = pitch_clarity(tgt)
        r = {
            "pitch": pc, "richness": harmonic_richness(tgt, f0, per), "first_line": first,
            "vocal_share": vshare, "vocal": bool(vocal), "stem_energy": e,
            "hnr": hnr(tgt), "presence": presence(tgt), "rhythm": rhythm(tgt),
        }
        if vocal:
            r["phoneme"] = phoneme_conf(tgt)
            r["incipit"] = incipit_match(tgt, first, lang)
        res[p["cyl"]] = r
        json.dump(res, open(out, "w"), ensure_ascii=False, indent=1, default=float)
        print(p["cyl"], {k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items() if k not in ("stem_energy", "incipit", "phoneme")},
              r.get("phoneme"), (r.get("incipit") or {}).get("match"), flush=True)
