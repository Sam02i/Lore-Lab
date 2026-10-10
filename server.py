import threading
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import ollama
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from adapter import to_ui
from extract import MODEL, extract
from lab import build_card
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

# In-memory store for now (SQLite later). Lost on restart.
# id -> {"hypothesis": Hypothesis, "source": str, "confirmed": dict|None, "backtest": dict|None}
HYPOTHESES: dict = {}


def get_entry(hid: str) -> dict:
    entry = HYPOTHESES.get(hid)
    if not entry:
        raise HTTPException(status_code=404, detail="That saying is no longer on the bench. Extract it again.")
    return entry


# ---------- request shapes ----------

class ExtractRequest(BaseModel):
    text: str
    source: Optional[str] = None      # the frontend sends null when blank
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


# ---------- Static frontend (must stay LAST) ----------
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")