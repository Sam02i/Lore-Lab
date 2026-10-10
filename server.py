import datetime as dt
import json
import os
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import ollama
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config
from adapter import to_ui
from backtest import build_days
from extract import MODEL, extract
from field import build_field_card
from lab import build_card
from prompt import PROMPT_VERSION
from resolve import resolve_due
from schema import Hypothesis, is_backtestable
from weather import fetch_history

LOCK = threading.RLock()  # one writer at a time; the files are tiny


def _warm_up():
    """Load Gemma into memory in the background so the first real request isn't slow."""
    try:
        ollama.chat(model=MODEL, messages=[{"role": "user", "content": "hi"}], keep_alive="1h")
        print("model warm:", MODEL)
    except Exception as e:
        print("warm-up skipped:", e)


@asynccontextmanager
async def lifespan(app):
    threading.Thread(target=_warm_up, daemon=True).start()
    yield


app = FastAPI(title="Lore Lab", lifespan=lifespan)

# ---------------------------------------------------------------- persistence
# hypotheses.json : proverbs, confirmed hypotheses (+ model name and prompt version), Lab results
# data.json       : Field Test experiments and observations
# Both are plain JSON files written atomically, so a restart (or --reload) loses nothing.
HYP_FILE = Path("hypotheses.json")
DATA_FILE = Path("data.json")
PROVERBS_FILE = Path(__file__).parent / "proverbs.json"


def _atomic_write(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def _load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # a corrupt file must never stop the app from starting
        print(f"could not read {path}: {e}")
        return default


def _load_hypotheses() -> dict:
    out = {}
    for hid, e in _load_json(HYP_FILE, {}).items():
        try:
            e["hypothesis"] = Hypothesis.model_validate(e["hypothesis"])
            out[hid] = e
        except Exception as err:
            print(f"skipping saved hypothesis {hid}: {err}")
    return out


HYPOTHESES: dict = _load_hypotheses()
EXPERIMENTS: dict = _load_json(DATA_FILE, {})
_BASE_CACHE: dict = {}  # (lat, lon, window) -> base rate


def save_hyps():
    _atomic_write(HYP_FILE, {k: {**v, "hypothesis": v["hypothesis"].model_dump()} for k, v in HYPOTHESES.items()})


def save():
    _atomic_write(DATA_FILE, EXPERIMENTS)


def get_entry(hid: str) -> dict:
    entry = HYPOTHESES.get(hid)
    if not entry:
        raise HTTPException(status_code=404, detail="That saying is no longer on the bench. Extract it again.")
    return entry


def base_rate_for(lat: float, lon: float, window_h: int):
    """Chance of rain in the window at this place. Needs no proxy, so it works for any proverb."""
    key = (round(lat, 2), round(lon, 2), window_h)
    if key not in _BASE_CACHE:
        try:
            _BASE_CACHE[key] = float(build_days(fetch_history(lat, lon), window_h)["rain"].mean())
        except Exception as err:
            print("base rate failed:", err)
            return None
    return _BASE_CACHE[key]


# ---------------------------------------------------------------- request shapes
class ExtractRequest(BaseModel):
    text: str
    source: Optional[str] = None  # the frontend sends null when blank
    language: Optional[str] = None


class Edits(BaseModel):
    observable_sign: Optional[str] = None
    how_to_observe: Optional[str] = None
    predicted_outcome: Optional[str] = None
    window_hours: Optional[int] = None


class Threshold(BaseModel):
    value: float
    unit: Optional[str] = None


class Resolution(BaseModel):
    question: str
    answer: Optional[str] = None


class ConfirmRequest(BaseModel):
    hypothesis_id: Optional[str] = None
    edits: Optional[Edits] = None
    threshold: Optional[Threshold] = None
    ambiguity_resolutions: list[Resolution] = []
    rough_match_accepted: Optional[bool] = None


class Location(BaseModel):
    label: Optional[str] = None
    lat: float
    lon: float


class RunRequest(BaseModel):
    hypothesis_id: Optional[str] = None
    location: Location


class ObsRequest(BaseModel):
    experiment_id: Optional[str] = None
    seen: bool
    note: Optional[str] = None


# ---------------------------------------------------------------- API (keep ABOVE the static mount)
@app.get("/api/config")
def api_config():
    """The pre-committed constants, so the UI, the README and the code can never drift apart."""
    return {
        "MIN_N_BACKTEST": config.MIN_N_BACKTEST, "MIN_N_LIVE": config.MIN_N_LIVE,
        "RAIN_MM": config.RAIN_MM, "WINDOW_H": config.WINDOW_H, "LOOK_HOUR": config.LOOK_HOUR,
        "HISTORY_YEARS": config.HISTORY_YEARS, "model": MODEL, "prompt_version": PROMPT_VERSION,
    }


@app.get("/api/proverbs")
def api_proverbs():
    """Starter corpus (F11). Only entries whose wording and provenance were checked are served."""
    return [p for p in _load_json(PROVERBS_FILE, []) if p.get("verified")]


@app.post("/api/extract")
def api_extract(req: ExtractRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Write the saying first.")
    try:
        h = extract(text)
    except Exception as e:
        print("extract failed:", e)
        raise HTTPException(
            status_code=502,
            detail="The model couldn't turn that saying into a hypothesis. Try rewording it.",
        )
    hid = uuid.uuid4().hex[:8]
    source = (req.source or "").strip() or "unknown"
    with LOCK:
        HYPOTHESES[hid] = {
            "hypothesis": h, "source": source, "confirmed": None, "backtest": None,
            "model": MODEL, "prompt_version": PROMPT_VERSION,
            "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        save_hyps()
    return to_ui(h, hid, source)


@app.post("/api/hypotheses/{hid}/confirm")
def api_confirm(hid: str, req: ConfirmRequest):
    entry = get_entry(hid)
    h = entry["hypothesis"]

    # Code decides Lab vs Field. A rough proxy needs the user's explicit OK.
    lab = is_backtestable(h)
    if lab and h.proxy.fit == "rough" and not req.rough_match_accepted:
        lab = False
    if lab and req.threshold is None:
        raise HTTPException(status_code=400, detail="Set your number first. Lore Lab never picks the threshold for you.")

    edits = req.edits or Edits()
    with LOCK:
        entry["confirmed"] = {
            "test_mode": "lab" if lab else "field",
            "predicted_outcome": (edits.predicted_outcome or h.outcome.event).strip(),
            "window_hours": edits.window_hours or h.outcome.window_hours,
            "edits": edits.model_dump(),
            "threshold": req.threshold.model_dump() if req.threshold else None,
            "ambiguity_resolutions": [r.model_dump() for r in req.ambiguity_resolutions],
            "rough_match_accepted": req.rough_match_accepted,
            "confirmed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        save_hyps()
    return {
        "id": hid,
        "hypothesis_id": hid,
        "test_mode": entry["confirmed"]["test_mode"],
        "backtestable": lab,
        "observe_when": None if lab else h.sign.best_time_of_day,
    }


@app.post("/api/hypotheses/{hid}/backtest")
def api_backtest(hid: str, req: RunRequest):
    entry = get_entry(hid)
    h = entry["hypothesis"]
    conf = entry["confirmed"]
    if not conf or conf["test_mode"] != "lab" or not conf["threshold"]:
        raise HTTPException(status_code=400, detail="Confirm the hypothesis as a Lab Test first.")
    if "rain" not in conf["predicted_outcome"].lower():
        raise HTTPException(
            status_code=400,
            detail="The lab scores rain outcomes for now. Try a saying that predicts rain, or run it as a Field Test.",
        )
    try:
        df = fetch_history(req.location.lat, req.location.lon)
    except Exception as e:
        print("weather fetch failed:", e)
        raise HTTPException(status_code=502, detail="The weather archive didn't answer. Give it a moment and try again.")
    try:
        card = build_card(
            df,
            proverb=h.original_text,
            source=entry["source"],
            label=(req.location.label or "").strip() or f"{req.location.lat:.2f}, {req.location.lon:.2f}",
            variable=h.proxy.variable,
            feature=h.proxy.feature,
            threshold=conf["threshold"]["value"],
            window_hours=conf["window_hours"],
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    with LOCK:
        entry["backtest"] = card
        save_hyps()
    return card


@app.post("/api/hypotheses/{hid}/field-test")
def api_field_test(hid: str, req: RunRequest):
    entry = get_entry(hid)
    h = entry["hypothesis"]
    conf = entry["confirmed"]
    if not conf:
        raise HTTPException(status_code=400, detail="Confirm the hypothesis first.")
    label = (req.location.label or "").strip() or f"{req.location.lat:.2f}, {req.location.lon:.2f}"
    with LOCK:
        # Re-use the experiment for the same saying + place + window, so one saying is one notebook page
        # (starting "Go look" twice must not create a second, empty card).
        for eid, e in EXPERIMENTS.items():
            if (e["proverb"] == h.original_text and e["location"]["lat"] == req.location.lat
                    and e["location"]["lon"] == req.location.lon and e["window_hours"] == conf["window_hours"]):
                return {"experiment_id": eid, "observe_when": e["observe_when"], "location_label": e["location"]["label"]}
        eid = uuid.uuid4().hex[:8]
        EXPERIMENTS[eid] = {
            "proverb": h.original_text,
            "source": entry["source"],
            "location": {"label": label, "lat": req.location.lat, "lon": req.location.lon},
            "window_hours": conf["window_hours"],
            "observe_when": h.sign.best_time_of_day,
            "model": entry.get("model"), "prompt_version": entry.get("prompt_version"),
            "observations": [],
        }
        save()
    return {"experiment_id": eid, "observe_when": h.sign.best_time_of_day, "location_label": label}


@app.post("/api/experiments/{eid}/observations")
def api_observe(eid: str, req: ObsRequest):
    exp = EXPERIMENTS.get(eid)
    if not exp:
        raise HTTPException(status_code=404, detail="That experiment isn't on the bench.")
    now = dt.datetime.now(dt.timezone.utc)
    # Window starts at the next full hour after the look and lasts window_hours.
    window_start = now.replace(minute=0, second=0, microsecond=0) + dt.timedelta(hours=1)
    resolve_after = window_start + dt.timedelta(hours=exp["window_hours"])
    with LOCK:
        exp["observations"].append({
            "seen": req.seen,
            "note": req.note or "",
            "observed_at": now.isoformat(),
            "window_start": window_start.isoformat(),
            "resolve_after": resolve_after.isoformat(),
            "status": "pending",
            "attempts": 0,
            "last_error": None,
            "precip_mm": None,
            "rain": None,
        })
        save()
    return {"ok": True}


@app.post("/api/resolve-pending")
def api_resolve_pending():
    with LOCK:
        n = resolve_due(EXPERIMENTS)
        save()
    return {"resolved": n}


@app.get("/api/observations")
def api_observations():
    with LOCK:
        resolve_due(EXPERIMENTS)
        save()
        out = []
        for eid, e in EXPERIMENTS.items():
            for o in e["observations"]:
                out.append({"experiment_id": eid, "proverb": e["proverb"], "location_label": e["location"]["label"], **o})
    return out


@app.get("/api/scorecards")
def api_scorecards():
    with LOCK:
        resolve_due(EXPERIMENTS)
        save()
        cards = []
        # Lab (backtest) cards first. Never pooled with field notes.
        for entry in HYPOTHESES.values():
            if entry["backtest"]:
                cards.append(entry["backtest"])
        # Field cards: same layout as the Lab card, built by field.py.
        for e in EXPERIMENTS.values():
            loc = e["location"]
            cards.append(build_field_card(e, base_rate_for(loc["lat"], loc["lon"], e["window_hours"])))
    return cards


# ---------------------------------------------------------------- static frontend (must stay LAST)
app.mount("/", StaticFiles(directory=str(Path(__file__).parent / "frontend"), html=True), name="frontend")