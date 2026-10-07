"""Legibility v3 over every wax-cylinder track: one score 0 (almost illegible) .. 1 (perfectly legible).

legib = 0.6 x clarity + 0.4 x noise, exactly as audio/discovery/score_v3.py (weights calibrated to the
owner's ratings on 2 Oct 2026). The measurements are the discovery code itself:
  full track, 16 kHz mono  -> score.squim (STOI, 10 s windows), score.dnsmos (BAK), voice-band flatness
  first 60 s, 44.1 kHz     -> features_v2.separate (HDemucs), features_v2.rhythm, features_v2.incipit_match
Everything else the discovery scripts measured (pYIN, CREPE, Praat, wav2vec2, NISQA, clicks, bandwidth)
is not in the v3 score and is not computed.

Pipeline: a downloader thread (1 request/s overall, scraper User-Agent, robots.txt, retries with
backoff) feeds a process pool (decode + DNSMOS + flatness on the CPU); the main thread runs Demucs,
SQUIM and Whisper on the GPU. One JSON line per track goes to audio/out/audit.jsonl; a restart skips
tracks already there. Failures go to audio/out/failures.jsonl and are retried on the next run.

Usage (from the repo root):
  python audio/run_legibility.py --check-gpu
  python audio/run_legibility.py --sample audio/discovery/sample.json --out audio/out/sample.jsonl --compare audio/discovery/v3.json
  python audio/run_legibility.py --limit 50
  python audio/run_legibility.py                       # full run, resumable
  python audio/run_legibility.py --write-quality       # audit.jsonl -> data/recording-quality.json
"""
import argparse, concurrent.futures as cf, datetime as dt, hashlib, json, os, queue, re, subprocess, sys, threading, time
import urllib.parse, urllib.robotparser

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DISCOVERY = os.path.join(HERE, "discovery")
sys.path.insert(0, DISCOVERY)

# Same identity as scraper/src/util.js USER_AGENT.
USER_AGENT = ("BartokRomaniaViewer/0.1 (+https://github.com/maltandbrew/Barton; research scraper of HUN-REN BTK ZTI "
              "Bartok databases; 1 req/s; contact tsaar@maltandbrew.com)")
UA_TOKEN = "BartokRomaniaViewer"
METHOD = "culegeri-legibility/3"
SR = 16000
# Cylinder ID = the MH_/KF_ file stem. Some stems carry a second underscore (MH_0093_ia, MH_0112_ig2), which
# the discovery regex (?:MH|KF)_[0-9A-Za-z]+ would cut short; none of the 20 calibration cylinders has one.
CYL_RE = re.compile(r"((?:MH|KF)_[0-9A-Za-z_]+)")
HOST_RANK = {"systems.zti.hu": 0, "bartok-gyujtesek.zti.hu": 1}
MIRROR = "bartok-gyujtesek.zti.hu"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------------------------------------------------------------------------------------- catalogue
def own_first(s):
    """features_v2: the record's incipit, else the bracketed line in its title. Returns (line, source)."""
    if s.get("incipit"):
        return s["incipit"], "incipit"
    m = re.search(r"\[([^\]]+)\]", s.get("title") or "")
    return (m.group(1), "title") if m else (None, None)


def cyl_of(url):
    m = CYL_RE.search(url.rsplit("/", 1)[-1])
    return m.group(1) if m else None


def build_tracks(songs):
    """Every MH/KF cylinder track (bsys MH/ and KF/ series, fmbc audio/source/), deduped by cylinder ID
    case-insensitively. Gramophone (Gr_) and fmbc composition/ recordings are not cylinders."""
    by = {}
    for o in songs:
        for a in o["media"]["audio"]:
            u = a["url"]
            path = urllib.parse.urlparse(u).path
            if "/composition/" in path:
                continue
            if o["id"].startswith("fmbc") and "/audio/source/" not in path:
                continue
            cyl = cyl_of(u)
            if not cyl:
                continue
            host = urllib.parse.urlparse(u).netloc
            by.setdefault(cyl.lower(), []).append((HOST_RANK.get(host, 2), u, o["id"], cyl))
    tracks = []
    for key in sorted(by):
        c = sorted(set(by[key]))
        urls = list(dict.fromkeys(u for _, u, _, _ in c))
        # mirror fallback: the gyujtesek mirror serves the same /media/audio/ paths as systems.zti.hu
        for u in list(urls):
            p = urllib.parse.urlparse(u)
            if p.netloc == "systems.zti.hu":
                alt = p._replace(netloc=MIRROR).geturl()
                if alt not in urls:
                    urls.append(alt)
        tracks.append({"cyl": c[0][3], "record": c[0][2], "urls": urls,
                       "otherRecords": sorted({r for _, _, r, _ in c} - {c[0][2]})})
    return tracks


def first_lines(songs):
    """features_v2's by_cyl map (first own first line per cylinder, in songs.json order), with the lender."""
    by_cyl = {}
    for o in songs:
        line, _ = own_first(o)
        if not line:
            continue
        refs = [a["url"] for a in o["media"]["audio"]] + [o["rawFields"].get("Sound recording") or ""]
        for u in refs:
            m = CYL_RE.search(u)
            if m:
                by_cyl.setdefault(m.group(1).lower(), (line, o["id"]))
    return by_cyl


# ---------------------------------------------------------------------------------------- download
class Downloader:
    """Polite fetcher in the scraper's conventions: <cache>/<host>/<sha1(url)>.mp3 plus a .json sidecar,
    robots.txt, at most one live request per second overall, 4 retries with exponential backoff
    (a full 60 s after 429/503)."""

    def __init__(self, cache_dir, min_interval=1.0, retries=4, timeout=60):
        import requests
        self.s = requests.Session()
        self.s.headers["User-Agent"] = USER_AGENT
        self.cache_dir, self.min_interval, self.retries, self.timeout = cache_dir, min_interval, retries, timeout
        self.last = 0.0
        self.robots = {}
        self.lock = threading.Lock()

    def paths(self, url):
        base = os.path.join(self.cache_dir, urllib.parse.urlparse(url).netloc, hashlib.sha1(url.encode()).hexdigest())
        return base + ".mp3", base + ".json"

    def throttle(self, extra=0.0):
        with self.lock:
            wait = max(self.min_interval, extra) - (time.monotonic() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()

    def get(self, url, stream=False):
        err = None
        for attempt in range(self.retries + 1):
            self.throttle()
            try:
                r = self.s.get(url, timeout=self.timeout, stream=stream)
                if r.status_code == 429 or 500 <= r.status_code < 600:
                    err = RuntimeError(f"HTTP {r.status_code}"); err.status = r.status_code
                    r.close()
                else:
                    if stream:
                        r.content  # read the body inside the retry loop, so a dropped transfer is retried
                    return r
            except Exception as e:  # connection errors, timeouts, truncated bodies
                err = e
            if attempt == self.retries:
                break
            slow = getattr(err, "status", None) in (429, 503)
            back = 60 if slow else min(60, 2 ** (attempt + 1)) + (hash(url) % 500) / 1000
            log(f"retry {attempt + 1}/{self.retries} {url} in {back:.0f}s ({err})")
            time.sleep(back)
        raise err

    def allowed(self, url):
        host = urllib.parse.urlparse(url).netloc
        if host not in self.robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = self.get(f"https://{host}/robots.txt")
                rp.parse(r.text.splitlines() if r.ok and "<html" not in r.text[:500].lower() else [])
            except Exception:
                rp.parse([])
            self.robots[host] = rp
        rp = self.robots[host]
        delay = rp.crawl_delay(UA_TOKEN)
        if delay and delay > self.min_interval:
            self.throttle(delay)
        return rp.can_fetch(UA_TOKEN, url)

    def fetch(self, urls):
        """First URL that yields audio. Returns (path, url, seconds)."""
        t0, errs = time.monotonic(), []
        for url in urls:
            mp3, meta = self.paths(url)
            if os.path.exists(mp3) and os.path.exists(meta):
                return mp3, url, 0.0
            try:
                if not self.allowed(url):
                    errs.append(f"{url}: blocked by robots.txt"); continue
                r = self.get(url, stream=True)
                body, ctype = r.content, r.headers.get("content-type", "")
                if not r.ok:
                    errs.append(f"{url}: HTTP {r.status_code}"); continue
                if "html" in ctype or len(body) < 1000 or not (body[:3] == b"ID3" or body[0] == 0xFF):
                    errs.append(f"{url}: not audio ({ctype}, {len(body)} bytes)"); continue
                os.makedirs(os.path.dirname(mp3), exist_ok=True)
                with open(mp3 + ".part", "wb") as f:
                    f.write(body)
                os.replace(mp3 + ".part", mp3)
                with open(meta, "w", encoding="utf-8") as f:
                    json.dump({"url": url, "finalUrl": r.url, "status": r.status_code, "contentType": ctype, "bytes": len(body),
                               "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}, f, indent=2)
                return mp3, url, time.monotonic() - t0
            except Exception as e:
                errs.append(f"{url}: {e!r}"[:300])
        raise RuntimeError("; ".join(errs) or "no URL")

    def drop(self, url):
        for p in self.paths(url):
            try:
                os.remove(p)
            except FileNotFoundError:
                pass


# ---------------------------------------------------------------------------------------- CPU stage
def _worker_init():
    """Each worker: DNSMOS sessions on 2 threads (onnxruntime would otherwise take every core per process)."""
    import onnxruntime as ort
    from speechmos import dnsmos as D
    here = os.path.dirname(os.path.abspath(D.__file__))
    so = ort.SessionOptions(); so.intra_op_num_threads = 2; so.inter_op_num_threads = 1
    m = D.DNSMOS.__new__(D.DNSMOS)
    m.primary_model_path = os.path.join(here, "dnsmos_models", "sig_bak_ovr.onnx")
    m.onnx_sess = ort.InferenceSession(m.primary_model_path, so)
    m.p808_onnx_sess = ort.InferenceSession(os.path.join(here, "dnsmos_models", "model_v8.onnx"), so)
    D.dnsmos = m


def decode16(path):
    """Whole track as 16 kHz mono PCM16, read as float32: what score.py read from its converted WAVs."""
    import numpy as np
    raw = subprocess.check_output(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(SR),
                                   "-f", "s16le", "-acodec", "pcm_s16le", "-"])
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def voice_band_flatness(y):
    """The 'noise' (low hiss) part of score.librosa_sig, lines 88-99 and 120 there; the rest of that
    function (pYIN, HPSS, clicks, bandwidth) is not in v3 and is skipped."""
    import numpy as np, librosa
    from score import lin
    hop, nfft = 256, 1024
    rms = librosa.feature.rms(y=y, frame_length=nfft, hop_length=hop)[0]
    db = 20 * np.log10(rms + 1e-9)
    active = db > np.percentile(db, 50)
    S = np.abs(librosa.stft(y, n_fft=nfft, hop_length=hop)) ** 2
    fr = librosa.fft_frequencies(sr=SR, n_fft=nfft)
    band = (fr >= 200) & (fr <= 4000)
    flat = float(np.median(librosa.feature.spectral_flatness(S=S[band], power=1.0)[0][active]))
    return flat, 1 - lin(flat, 0.01, 0.3)


def cpu_stage(path):
    import score
    t0 = time.perf_counter()
    y = decode16(path)
    t1 = time.perf_counter()
    bak = float(score.dnsmos(y)["bak"])
    t2 = time.perf_counter()
    flat, hiss = voice_band_flatness(y)
    t3 = time.perf_counter()
    return {"y": y, "bak": bak, "flatness": flat, "hiss": hiss,
            "t": {"decode": t1 - t0, "dnsmos": t2 - t1, "flatness": t3 - t2}}


# ---------------------------------------------------------------------------------------- GPU stage
def cuda_dll_dirs():
    """faster-whisper (CTranslate2) on Windows needs CUDA 12 cuBLAS and cuDNN 9 DLLs on the search path:
    take them from the nvidia-cublas-cu12 / nvidia-cudnn-cu12 wheels."""
    if os.name != "nt":
        return
    import site
    for sp in site.getsitepackages():
        for sub in ("cublas", "cudnn", "cuda_nvrtc"):
            d = os.path.join(sp, "nvidia", sub, "bin")
            if os.path.isdir(d):
                os.add_dll_directory(d)
                os.environ["PATH"] = d + os.pathsep + os.environ["PATH"]


class GPU:
    """Loads the discovery modules and puts their models on the GPU without changing their code:
    each module's lazily-created model global is pre-filled with a wrapper that moves tensors."""

    def __init__(self, whisper_compute="int8", tf32=False, threads=1):
        import types
        cuda_dll_dirs()
        for mod in ("parselmouth", "torchcrepe"):  # imported at the top of features_v2 for measures v3 dropped
            try:
                __import__(mod)
            except ImportError:
                sys.modules[mod] = types.ModuleType(mod)
        import torch, torchaudio
        import score, features_v2, score_v3
        from faster_whisper import WhisperModel
        assert torch.cuda.is_available(), "CUDA not available"
        torch.backends.cudnn.allow_tf32 = tf32
        torch.backends.cuda.matmul.allow_tf32 = tf32
        self.torch, self.score, self.f2, self.v3 = torch, score, features_v2, score_v3
        dev = torch.device("cuda")

        sep = torchaudio.pipelines.HDEMUCS_HIGH_MUSDB_PLUS.get_model().eval().to(dev)
        class Sep:
            sources = sep.sources
            def __call__(self, x):
                return sep(x.to(dev)).cpu()
        features_v2._sep = Sep()

        squim = torchaudio.pipelines.SQUIM_OBJECTIVE.get_model().eval().to(dev)
        score._squim = lambda w: squim(w.to(dev))

        # num_workers: one CTranslate2 replica per GPU thread, so concurrent transcribe() calls run in parallel
        features_v2._wh = WhisperModel("small", device="cuda", compute_type=whisper_compute, num_workers=threads)
        self.whisper_compute = whisper_compute

    def run(self, path, cpu, s, by_cyl, cyl):
        import numpy as np
        f2, torch = self.f2, self.torch
        T = {}
        t = time.perf_counter()
        mix = f2.load_stereo(path)
        st = f2.separate(mix)
        torch.cuda.synchronize(); T["separate"] = time.perf_counter() - t

        # features_v2.__main__, unchanged: stem shares, first line, sung vs instrumental, target
        e = {k: float(np.mean(v ** 2)) for k, v in st.items()}
        tonal = e["vocals"] + e["other"] + e["bass"]  # drums mostly collects cylinder clicks
        vshare = e["vocals"] / (tonal + 1e-12)
        line, src = own_first(s)
        lender = None
        if not line and cyl.lower() in by_cyl:
            (line, lender), src = by_cyl[cyl.lower()], "borrowed"
        sung = s["performance"] in ("vocal", "mixed") or (s["performance"] != "instrumental" and bool(line))
        vocal = sung or (s["performance"] != "instrumental" and vshare >= 0.5)
        if vocal:
            stem = "vocals" if vshare >= 0.5 else "vocals+other"
            tgt = f2.to16(st["vocals"] if vshare >= 0.5 else st["vocals"] + st["other"])
        else:
            stem = "other+bass"
            tgt = f2.to16(st["other"] + st["bass"])
        lang = f2.LANG.get(s["performer"].get("ethnicity") or "", "hu")

        t = time.perf_counter()
        rhythm = f2.rhythm(tgt)
        T["rhythm"] = time.perf_counter() - t
        inc = None
        if vocal:
            t = time.perf_counter()
            inc = f2.incipit_match(tgt, line, lang)
            T["whisper"] = time.perf_counter() - t

        t = time.perf_counter()
        sq = self.score.squim(cpu["y"])
        torch.cuda.synchronize(); T["squim"] = time.perf_counter() - t
        if not np.isfinite(sq["stoi"]):
            raise ValueError(f"no SQUIM window (track {len(cpu['y']) / SR:.1f} s)")

        # score_v3, unchanged
        f = {"rhythm": rhythm, "incipit": inc}
        old = {"dnsmos": {"bak": cpu["bak"]}, "librosa": {"parts": {"noise": cpu["hiss"]}}}
        cs, cp = self.v3.clarity(f, sq["stoi"])
        ns, npart = self.v3.noise(old)
        legib = self.v3.W_CLARITY * cs + self.v3.W_NOISE * ns
        return {
            "legib": round(legib, 3), "clarity": round(cs, 3), "noise": round(ns, 3),
            "parts": {**{k: round(v, 4) for k, v in cp.items()}, **{k: round(v, 4) for k, v in npart.items()}},
            "raw": {"stoi": sq["stoi"], "match": (inc or {}).get("match"), "rhythm": rhythm, "bak": cpu["bak"],
                    "flatness": cpu["flatness"]},
            "kind": "sung" if vocal else "instrumental", "performance": s["performance"],
            "kindFrom": "catalogue" if (sung or s["performance"] == "instrumental") else "separator",
            "vocalShare": round(vshare, 4), "target": stem, "lang": lang,
            "firstLine": line, "firstLineSource": src or "none", "firstLineFrom": lender,
            "whisperText": (inc or {}).get("text"), "durationS": round(len(cpu["y"]) / SR, 1), "t": T,
        }


# ---------------------------------------------------------------------------------------- run
def read_jsonl(path):
    out = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for ln in f:
                try:
                    out.append(json.loads(ln))
                except json.JSONDecodeError:
                    pass  # a line cut short by a crash
    return out


class Appender:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if os.path.exists(path) and os.path.getsize(path):
            with open(path, "rb") as f:
                f.seek(-1, 2)
                cut = f.read(1) != b"\n"
            if cut:
                with open(path, "ab") as f:
                    f.write(b"\n")
        self.f = open(path, "a", encoding="utf-8")

    def write(self, obj):
        self.f.write(json.dumps(obj, ensure_ascii=False, sort_keys=True) + "\n")
        self.f.flush()
        os.fsync(self.f.fileno())


def run(args):
    songs = json.load(open(os.path.join(REPO, "data", "songs.json"), encoding="utf-8"))
    rec = {o["id"]: o for o in songs}
    tracks = build_tracks(songs)
    by_cyl = first_lines(songs)
    log(f"{len(tracks)} cylinder tracks in the catalogue")
    if args.sample:
        want = {p["cyl"].lower(): p for p in json.load(open(args.sample, encoding="utf-8"))}
        tracks = [t for t in tracks if t["cyl"].lower() in want]
        for t in tracks:
            if t["record"] != want[t["cyl"].lower()]["id"]:
                log(f"note: {t['cyl']} scored from {t['record']}, sample.json used {want[t['cyl'].lower()]['id']}")
        assert len(tracks) == len(want), "sample cylinders missing from the track list"
    if args.limit:
        tracks = tracks[: args.limit]
    done = {r["cyl"].lower() for r in read_jsonl(args.out)}
    todo = [t for t in tracks if t["cyl"].lower() not in done]
    log(f"{len(tracks)} selected, {len(tracks) - len(todo)} already in {os.path.relpath(args.out, REPO)}, {len(todo)} to score")
    if not todo:
        return

    if os.name == "nt":  # keep the PC awake while this process runs (ES_CONTINUOUS | ES_SYSTEM_REQUIRED); no setting changes
        import ctypes
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)
    gpu = GPU(args.whisper_compute, args.tf32, args.gpu_threads)
    log(f"models on {gpu.torch.cuda.get_device_name(0)}; whisper {gpu.whisper_compute}; {args.gpu_threads} GPU threads")
    dl = Downloader(args.cache_dir)
    audit, fails = Appender(args.out), Appender(args.failures)
    stop = threading.Event()
    inflight = threading.Semaphore(args.workers + 2)  # bounds audio on disk and decoded arrays in memory
    results = queue.Queue()
    pool = cf.ProcessPoolExecutor(args.workers, initializer=_worker_init)

    def feeder():
        for t in todo:
            inflight.acquire()
            if stop.is_set():
                break
            try:
                path, url, secs = dl.fetch(t["urls"])
            except Exception as e:
                results.put(("fail", t, None, "download", e))
                continue
            t0 = time.perf_counter()
            fut = pool.submit(cpu_stage, path)
            fut.add_done_callback(lambda f, t=t, path=path, url=url, secs=secs, t0=t0:
                                  results.put(("cpu", t, (path, url, secs, t0), "cpu", f)))

    n = {"ok": 0, "fail": 0, "taken": 0}
    lock = threading.Lock()
    t_start = time.monotonic()

    def consumer():
        """GPU stage. Several of these overlap one track's Demucs/SQUIM with another's Whisper."""
        while not stop.is_set():
            with lock:  # the feeder posts exactly one result (scored or failed) per track
                if n["taken"] == len(todo):
                    return
                n["taken"] += 1
            kind, t, info, stage, payload = results.get()
            url = None
            try:
                if kind == "fail":
                    raise payload
                path, url, dl_s, t_cpu0 = info
                cpu = payload.result()
                t_cpu = time.perf_counter() - t_cpu0
                stage = "gpu"
                t0 = time.perf_counter()
                r = gpu.run(path, cpu, rec[t["record"]], by_cyl, t["cyl"])
                r["t"] = {"download": round(dl_s, 2), "cpuWall": round(t_cpu, 2),
                          **{k: round(v, 2) for k, v in {**cpu["t"], **r["t"]}.items()},
                          "gpuWall": round(time.perf_counter() - t0, 2)}
                with lock:
                    audit.write({"cyl": t["cyl"], "record": t["record"], "otherRecords": t["otherRecords"], "url": url,
                                 "method": METHOD, "device": f"cuda/{gpu.whisper_compute}",
                                 "scoredAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), **r})
                    n["ok"] += 1
                    k, el = n["ok"] + n["fail"], time.monotonic() - t_start
                log(f"{k}/{len(todo)} {t['cyl']} legib {r['legib']:.3f} ({r['kind']}, words "
                    f"{r['parts']['words']:.2f}) | {el / k:.2f} s/track, ETA {(len(todo) - k) * el / k / 3600:.1f} h")
            except Exception as e:
                with lock:
                    n["fail"] += 1
                    fails.write({"cyl": t["cyl"], "record": t["record"], "stage": stage, "error": repr(e)[:500],
                                 "at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")})
                log(f"FAILED {t['cyl']} at {stage}: {e!r}"[:300])
            finally:
                if url and not args.keep_audio:
                    dl.drop(url)
                inflight.release()

    threads = [threading.Thread(target=feeder, daemon=True)] + \
              [threading.Thread(target=consumer, daemon=True) for _ in range(args.gpu_threads)]
    for th in threads:
        th.start()
    try:
        for th in threads[1:]:
            while th.is_alive():
                th.join(0.5)  # short joins keep Ctrl-C responsive
    except KeyboardInterrupt:
        log("interrupted; tracks being scored now are dropped, finished ones are saved; rerun to resume")
        stop.set()
        for _ in range(args.workers + 2):
            inflight.release()
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    el = time.monotonic() - t_start
    done_n = n["ok"] + n["fail"]
    log(f"done: {n['ok']} scored, {n['fail']} failed in {el / 60:.1f} min ({el / max(1, done_n):.2f} s/track)")


# ---------------------------------------------------------------------------------------- reports
def compare(out_path, ref_path):
    """Regression check against the discovery run: legib and every part, plus the raw measurements."""
    ref = json.load(open(ref_path, encoding="utf-8"))
    f2 = json.load(open(os.path.join(DISCOVERY, "features_v2.json"), encoding="utf-8"))
    old = json.load(open(os.path.join(DISCOVERY, "scores.json"), encoding="utf-8"))
    got = {r["cyl"]: r for r in read_jsonl(out_path)}
    worst, rows = 0.0, []
    for cyl in sorted(ref):
        if cyl not in got:
            rows.append(f"{cyl:12s} MISSING"); worst = 9; continue
        g, r = got[cyl], ref[cyl]
        d = g["legib"] - r["legib"]
        worst = max(worst, abs(d))
        parts = {**r["clarity_parts"], **r["noise_parts"]}
        pd = " ".join(f"{k[:5]} {g['parts'][k] - v:+.2f}" for k, v in parts.items())
        raw = (f"stoi {g['raw']['stoi'] - old[cyl]['squim']['stoi']:+.4f} bak {g['raw']['bak'] - old[cyl]['dnsmos']['bak']:+.4f} "
               f"flat {g['raw']['flatness'] - old[cyl]['librosa']['flatness']:+.5f} rhy {g['raw']['rhythm'] - f2[cyl]['rhythm']:+.3f} "
               f"vsh {g['vocalShare'] - f2[cyl]['vocal_share']:+.3f}")
        rm = (f2[cyl].get("incipit") or {}).get("match")
        if rm is not None or g["raw"]["match"] is not None:
            raw += f" match {g['raw']['match']} vs {rm}"
        flag = "  <-- over 0.02" if abs(d) > 0.02 else ""
        rows.append(f"{cyl:12s} {r['legib']:.3f} -> {g['legib']:.3f} ({d:+.3f}) | {pd} | {raw}{flag}")
        if g["kind"] != ("sung" if f2[cyl]["vocal"] else "instrumental") or g["firstLine"] != f2[cyl]["first_line"]:
            rows.append(f"{'':12s} LOGIC: kind {g['kind']} vs vocal={f2[cyl]['vocal']}, first line {g['firstLine']!r} vs {f2[cyl]['first_line']!r}")
    print("\n".join(rows))
    print(f"max |legib difference| = {worst:.3f} -> {'PASS' if worst <= 0.02 else 'FAIL'} (tolerance 0.02)")
    return worst <= 0.02


def write_quality(out_path, dest):
    rows = {r["cyl"]: r for r in read_jsonl(out_path)}
    stamp = max(r["scoredAt"] for r in rows.values())[:10]
    tracks = {k: round(rows[k]["legib"], 2) for k in sorted(rows, key=str.lower)}
    doc = {"method": METHOD, "scoredAt": stamp, "tracks": tracks}
    # record scores leave out the short numbered clips (spoken announcements); see quality_records.py
    import quality_records
    lengths = json.load(open(os.path.join(HERE, "clip-lengths.json"), encoding="utf-8"))
    lengths.update({k: r["durationS"] for k, r in rows.items() if r.get("durationS") is not None})
    songs = json.load(open(os.path.join(REPO, "data", "songs.json"), encoding="utf-8"))
    quality_records.annotate(doc, songs, lengths)
    with open(dest, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    log(f"wrote {len(tracks)} tracks to {os.path.relpath(dest, REPO)}")
    report(rows, out_path)


def report(rows, out_path):
    """Coverage, score distribution and the open points (instrumental records, records without a first line)."""
    import collections
    import numpy as np
    songs = json.load(open(os.path.join(REPO, "data", "songs.json"), encoding="utf-8"))
    every = {t["cyl"].lower() for t in build_tracks(songs)}
    scored = {k.lower() for k in rows}
    failed = {}
    for f in read_jsonl(os.path.join(os.path.dirname(out_path), "failures.jsonl")):
        if f["cyl"].lower() not in scored:
            failed[f["cyl"].lower()] = f
    print(f"coverage: {len(every)} tracks; scored {len(scored & every)}, failed {len(failed)}, "
          f"not attempted {len(every - scored - set(failed))}")
    for stage, c in collections.Counter((f["stage"], f["error"].split(":")[0][:80]) for f in failed.values()).most_common(8):
        print(f"  failed at {stage[0]}: {stage[1]} x{c}")
    L = np.array([r["legib"] for r in rows.values()])
    edges = np.round(np.arange(0, 1.01, 0.1), 1)
    hist = np.histogram(L, bins=edges)[0]
    print(f"legib: mean {L.mean():.3f}, median {np.median(L):.3f}, p10 {np.percentile(L, 10):.3f}, "
          f"p90 {np.percentile(L, 90):.3f}, min {L.min():.3f}, max {L.max():.3f}")
    for lo, n in zip(edges[:-1], hist):
        print(f"  {lo:.1f}-{lo + 0.1:.1f} {n:5d} {'#' * int(round(60 * n / max(hist)))}")
    for key in ("kind", "kindFrom", "target", "firstLineSource", "lang"):
        print(f"{key}: {dict(collections.Counter(r[key] for r in rows.values()).most_common())}")
    for kind in ("sung", "instrumental"):
        v = [r["legib"] for r in rows.values() if r["kind"] == kind]
        if v:
            print(f"  {kind}: n {len(v)}, median legib {np.median(v):.3f}")
    nofirst = [r["cyl"] for r in rows.values() if r["firstLineSource"] == "none"]
    nofirst_sung = [r["cyl"] for r in rows.values() if r["firstLineSource"] == "none" and r["kind"] == "sung"]
    print(f"no first line anywhere: {len(nofirst)} tracks (words = 0.5), of which sung {len(nofirst_sung)}")
    for k in ("intelligibility", "words", "rhythm", "background", "hiss"):
        v = np.array([r["parts"][k] for r in rows.values()])
        print(f"  {k:15s} mean {v.mean():.2f}  at 0: {int((v == 0).sum())}  at 1: {int((v == 1).sum())}")


def check_gpu(args):
    import numpy as np
    g = GPU(args.whisper_compute, args.tf32)
    torch = g.torch
    log("torch", torch.__version__, "cuda", torch.version.cuda, "device", torch.cuda.get_device_name(0),
        "capability", torch.cuda.get_device_capability(0))
    x = torch.randn(1, 2, 44100 * 5)
    t = time.perf_counter(); y = g.f2._sep(x); torch.cuda.synchronize()
    log(f"Demucs 5 s stereo on cuda: output {tuple(y.shape)} in {time.perf_counter() - t:.2f} s; "
        f"GPU memory {torch.cuda.memory_allocated() / 2**20:.0f} MiB allocated")
    w = g.f2._wh
    log(f"faster-whisper model device: {w.model.device}, compute type {w.model.compute_type}")
    segs, _ = w.transcribe(np.zeros(SR * 3, dtype=np.float32), language="hu")
    list(segs)
    log("faster-whisper transcribe on cuda OK")
    a, b, c = g.score._squim(torch.randn(1, SR * 3))
    log(f"SQUIM on cuda: output on {a.device}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.join(HERE, "out", "audit.jsonl"))
    ap.add_argument("--failures", default=None, help="default: failures.jsonl next to --out")
    ap.add_argument("--cache-dir", default=os.environ.get("CULEGERI_AUDIO_CACHE", os.path.join(HERE, "out", "cache")))
    ap.add_argument("--sample", help="score only the cylinders in this sample.json")
    ap.add_argument("--limit", type=int, help="first N tracks of the (sorted) list")
    ap.add_argument("--workers", type=int, default=6, help="CPU processes for decoding, DNSMOS and flatness")
    ap.add_argument("--gpu-threads", type=int, default=2, help="tracks on the GPU at once")
    # int8: the same quantised weights as the discovery run (CPU int8). float16 weights hear nothing in MH_1192a,
    # where int8 hears the first line, and move legib by 0.095 there.
    ap.add_argument("--whisper-compute", default="int8", help="CTranslate2 compute type on the GPU")
    ap.add_argument("--tf32", action="store_true", help="allow TF32 in Demucs/SQUIM (faster, less like the CPU reference)")
    ap.add_argument("--keep-audio", action="store_true")
    ap.add_argument("--compare", help="after the run, compare with a discovery v3.json")
    ap.add_argument("--check-gpu", action="store_true")
    ap.add_argument("--list", action="store_true", help="print the track list summary and exit")
    ap.add_argument("--write-quality", action="store_true", help="write data/recording-quality.json from --out")
    args = ap.parse_args()
    args.out = os.path.abspath(args.out)
    args.failures = args.failures or os.path.join(os.path.dirname(args.out), "failures.jsonl")
    if args.check_gpu:
        return check_gpu(args)
    if args.list:
        songs = json.load(open(os.path.join(REPO, "data", "songs.json"), encoding="utf-8"))
        tr = build_tracks(songs)
        print(len(tr), "tracks;", sum(len(t["otherRecords"]) > 0 for t in tr), "with more than one record")
        for t in tr[:5] + tr[-3:]:
            print(t)
        return
    if args.write_quality:
        return write_quality(args.out, os.path.join(REPO, "data", "recording-quality.json"))
    run(args)
    if args.compare:
        sys.exit(0 if compare(args.out, args.compare) else 1)


if __name__ == "__main__":
    main()
