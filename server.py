import datetime as dt
import json
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import ollama
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from adapter import to_ui
from backtest import build_days
from extract import MODEL, extract
from lab import build_card
from resolve import resolve_due
from schema import is_backtestable
from weather import fetch_history


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

# In-memory store for hypotheses. Lost on restart (--reload restarts on every file save!).
# id -> {"hypothesis": Hypothesis, "source": str, "confirmed": dict|None, "backtest": dict|None}
HYPOTHESES: dict = {}

# Field-test experiments + observations live in a JSON file so they survive restarts.
DATA_FILE = Path("data.json")
EXPERIMENTS: dict = json.loads(DATA_FILE.read_text()) if DATA_FILE.exists() else {}


def save():
    DATA_FILE.write_text(json.dumps(EXPERIMENTS, indent=2))


def get_entry(hid: str) -> dict:
    entry = HYPOTHESES.get(hid)
    if not entry:
        raise HTTPException(status_code=404, detail="That saying is no longer on the bench. Extract it again.")
    return entry


# ---------- request shapes ----------
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


# ---------- API routes: keep them ABOVE the static mount at the bottom ----------
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
    HYPOTHESES[hid] = {"hypothesis": h, "source": source, "confirmed": None, "backtest": None}
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
    entry["confirmed"] = {
        "test_mode": "lab" if lab else "field",
        "predicted_outcome": (edits.predicted_outcome or h.outcome.event).strip(),
        "window_hours": edits.window_hours or h.outcome.window_hours,
        "edits": edits.model_dump(),
        "threshold": req.threshold.model_dump() if req.threshold else None,
        "ambiguity_resolutions": [r.model_dump() for r in req.ambiguity_resolutions],
        "rough_match_accepted": req.rough_match_accepted,
    }
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
    entry["backtest"] = card
    return card


@app.post("/api/hypotheses/{hid}/field-test")
def api_field_test(hid: str, req: RunRequest):
    entry = get_entry(hid)
    h = entry["hypothesis"]
    conf = entry["confirmed"]
    if not conf:
        raise HTTPException(status_code=400, detail="Confirm the hypothesis first.")
    label = (req.location.label or "").strip() or f"{req.location.lat:.2f}, {req.location.lon:.2f}"
    eid = uuid.uuid4().hex[:8]
    EXPERIMENTS[eid] = {
        "proverb": h.original_text,
        "source": entry["source"],
        "location": {"label": label, "lat": req.location.lat, "lon": req.location.lon},
        "window_hours": conf["window_hours"],
        "observe_when": h.sign.best_time_of_day,
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
    n = resolve_due(EXPERIMENTS)
    save()
    return {"resolved": n}


@app.get("/api/observations")
def api_observations():
    resolve_due(EXPERIMENTS)
    save()
    out = []
    for eid, e in EXPERIMENTS.items():
        for o in e["observations"]:
            out.append({
                "experiment_id": eid,
                "proverb": e["proverb"],
                "location_label": e["location"]["label"],
                **o,
            })
    return out


@app.get("/api/scorecards")
def api_scorecards():
    resolve_due(EXPERIMENTS)
    save()
    cards = []

    # Lab (backtest) cards first. Never pooled with field notes.
    for entry in HYPOTHESES.values():
        if entry["backtest"]:
            cards.append(entry["backtest"])

    # Field cards: only "Seen" looks count; failed looks are left out.
    for e in EXPERIMENTS.values():
        loc = e["location"]
        looks = [o for o in e["observations"] if o["seen"] and o["status"] != "failed"]
        try:
            base = float(build_days(fetch_history(loc["lat"], loc["lon"]), e["window_hours"])["rain"].mean())
        except Exception as err:
            print("base rate failed:", err)
            base = None
        left = max(0, 10 - len(looks))
        cards.append({
            "mode": "field",
            "proverb": e["proverb"],
            "source": e["source"],
            "location_label": loc["label"],
            "n_sign_present": len(looks),
            "hits": sum(1 for o in looks if o["rain"]),
            "n_pending": sum(1 for o in looks if o["status"] in ("pending", "retry")),
            "base_rate": base,
            "hit_rate": None,
            "ci_low": None,
            "ci_high": None,
            "lift": None,
            "verdict": "On the trail",
            "next_action": f"{left} more looks to a verdict.",
            "min_n": 10,
            "looks_total": len(looks),
        })
    return cards


# ---------- Static frontend (must stay LAST) ----------
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")