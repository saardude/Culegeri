"""Score wax-cylinder recordings 0 (almost illegible) .. 1 (perfectly legible) with several systems.

Usage: python score.py sample.json wav_dir out.json [--only a,b,...]
Every system returns a dict with a normalised 'score' in [0,1] plus its raw outputs.
"""
import json, sys, os, math, warnings
import numpy as np, soundfile as sf, librosa, scipy.signal as ss

warnings.filterwarnings("ignore")
SR = 16000
clip = lambda x: float(min(1.0, max(0.0, x)))
lin = lambda x, lo, hi: clip((x - lo) / (hi - lo))


def load(path):
    y, sr = sf.read(path, dtype="float32")
    assert sr == SR
    return y


# ---------------------------------------------------------------- DNSMOS P.835
_dns = None
def dnsmos(y):
    global _dns
    from speechmos import dnsmos as D
    y = y / (np.max(np.abs(y)) + 1e-9) * 0.9
    r = D.run(y, sr=SR)
    return {"score": lin(r["ovrl_mos"], 1, 5), "ovrl": r["ovrl_mos"], "sig": r["sig_mos"], "bak": r["bak_mos"], "p808": r["p808_mos"]}


# ---------------------------------------------------------------- NISQA (torchmetrics)
_nisqa = None
def nisqa(y):
    global _nisqa
    import torch
    from torchmetrics.functional.audio.nisqa import non_intrusive_speech_quality_assessment as N
    if not getattr(torch.load, "_patched", False):  # torchmetrics' NISQA checkpoint predates weights_only=True
        _orig = torch.load
        torch.load = lambda *a, **k: _orig(*a, **{**k, "weights_only": False})
        torch.load._patched = True
    seg = 20 * SR  # NISQA caps the input length; average 20 s windows
    wins = [y[i:i + seg] for i in range(0, len(y), seg) if len(y[i:i + seg]) >= 3 * SR] or [y]
    v = np.mean([N(torch.from_numpy(w), SR).tolist() for w in wins], axis=0).tolist()  # mos, noi, dis, col, loud
    return {"score": lin(v[0], 1, 5), "mos": v[0], "noi": v[1], "dis": v[2], "col": v[3], "loud": v[4]}


# ---------------------------------------------------------------- TorchAudio SQUIM (objective)
_squim = None
def squim(y):
    global _squim
    import torch, torchaudio
    if _squim is None:
        _squim = torchaudio.pipelines.SQUIM_OBJECTIVE.get_model().eval()
    x = torch.from_numpy(y)[None]
    stoi, pesq, sisdr = [], [], []
    seg = 10 * SR  # model is trained on short clips; average 10 s windows
    with torch.no_grad():
        for i in range(0, max(1, len(y) - SR), seg):
            w = x[:, i:i + seg]
            if w.shape[1] < 2 * SR: continue
            a, b, c = _squim(w)
            stoi.append(a.item()); pesq.append(b.item()); sisdr.append(c.item())
    s, p, d = map(lambda v: float(np.mean(v)), (stoi, pesq, sisdr))
    return {"score": clip(s), "stoi": s, "pesq": p, "sisdr": d}


# ---------------------------------------------------------------- Whisper ASR confidence
_wh = None
def whisper(y, lang="hu"):
    global _wh
    from faster_whisper import WhisperModel
    if _wh is None:
        _wh = WhisperModel("small", device="cpu", compute_type="int8")
    segs, _ = _wh.transcribe(y, language=lang, beam_size=5, vad_filter=False, condition_on_previous_text=False)
    segs = list(segs)
    if not segs:
        return {"score": 0.0, "lang": lang, "text": "", "logprob": None, "nospeech": 1.0}
    dur = np.array([s.end - s.start for s in segs]) + 1e-3
    lpm = float(np.average([s.avg_logprob for s in segs], weights=dur))
    nsp = float(np.average([s.no_speech_prob for s in segs], weights=dur))
    text = " ".join(s.text.strip() for s in segs)
    # exp(avg logprob) is the mean per-token probability; down-weight by the speech probability
    return {"score": clip(math.exp(lpm) * (1 - nsp)), "lang": lang, "logprob": lpm, "nospeech": nsp, "text": text[:200]}


# ---------------------------------------------------------------- librosa signal features
def librosa_sig(y):
    hop, nfft = 256, 1024
    rms = librosa.feature.rms(y=y, frame_length=nfft, hop_length=hop)[0]
    db = 20 * np.log10(rms + 1e-9)
    snr = float(np.percentile(db, 95) - np.percentile(db, 10))          # dynamic range ~ signal over noise floor
    active = db > np.percentile(db, 50)

    S = np.abs(librosa.stft(y, n_fft=nfft, hop_length=hop)) ** 2
    fr = librosa.fft_frequencies(sr=SR, n_fft=nfft)
    lt = 10 * np.log10(S[:, active].mean(1) + 1e-20); lt -= lt.max()
    bw = float(fr[np.where(lt > -40)[0].max()])                           # effective bandwidth (Hz, -40 dB)
    band = (fr >= 200) & (fr <= 4000)
    flat = float(np.median(librosa.feature.spectral_flatness(S=S[band], power=1.0)[0][active]))  # noisiness in voice band

    H, P = librosa.decompose.hpss(S, margin=2.0)
    harm = float(H[:, active].sum() / (S[:, active].sum() + 1e-9))       # share of tonal energy

    # clicks/crackle: impulses in the high-passed residual, per second
    b, a = ss.butter(4, 3000, "high", fs=SR)
    hp = ss.filtfilt(b, a, y)
    mad = np.median(np.abs(hp)) + 1e-9
    peaks, _ = ss.find_peaks(np.abs(hp), height=12 * mad, distance=int(0.003 * SR))
    clicks = len(peaks) / (len(y) / SR)

    # melody trackability: pYIN voiced probability over louder frames
    f0, vflag, vprob = librosa.pyin(y, fmin=70, fmax=1000, sr=SR, frame_length=2048, hop_length=512)
    act2 = librosa.util.fix_length(active[::2], size=len(vprob))
    voiced = float(np.mean(vprob[act2])) if act2.any() else 0.0

    parts = {
        "snr": lin(snr, 15, 45),
        "bandwidth": lin(bw, 1500, 6000),
        "tonal": lin(harm, 0.35, 0.85),
        "noise": 1 - lin(flat, 0.01, 0.3),
        "clicks": 1 - lin(clicks, 2, 60),
        "melody": lin(voiced, 0.15, 0.7),
    }
    w = {"snr": .25, "bandwidth": .10, "tonal": .15, "noise": .15, "clicks": .10, "melody": .25}
    score = sum(parts[k] * w[k] for k in w)
    return {"score": clip(score), "snr_db": snr, "bw_hz": bw, "flatness": flat, "harmonic": harm,
            "clicks_s": clicks, "voiced": voiced, "parts": parts}


LANG = {"Hungarian": "hu", "Romanian": "ro", "Slovak": "sk"}
SYSTEMS = {"dnsmos": dnsmos, "nisqa": nisqa, "squim": squim, "whisper": whisper, "librosa": librosa_sig}

if __name__ == "__main__":
    sample, wavdir, out = sys.argv[1:4]
    only = sys.argv[5].split(",") if len(sys.argv) > 5 else list(SYSTEMS)
    res = json.load(open(out)) if os.path.exists(out) else {}
    for p in json.load(open(sample)):
        y = load(os.path.join(wavdir, p["cyl"] + ".wav"))
        r = res.setdefault(p["cyl"], {})
        for name in only:
            if r.get(name, {}).get("score") is not None:
                continue  # already scored in an earlier run
            try:
                r[name] = SYSTEMS[name](y, LANG.get(p.get("lang"), "hu")) if name == "whisper" else SYSTEMS[name](y)
            except Exception as e:
                r[name] = {"score": None, "error": repr(e)[:300]}
            print(p["cyl"], name, r[name].get("score"), flush=True)
        json.dump(res, open(out, "w"), ensure_ascii=False, indent=1, default=float)
