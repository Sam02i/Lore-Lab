import uuid
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from adapter import to_ui
from extract import extract

app = FastAPI(title="Lore Lab")

# In-memory store for now (SQLite later). Lost on restart.
# id -> {"hypothesis": Hypothesis, "source": str}
HYPOTHESES: dict = {}


class ExtractRequest(BaseModel):
    text: str
    source: Optional[str] = None      # the frontend sends null when blank
    language: Optional[str] = None


# ---- API routes go ABOVE the static mount below ----

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
    HYPOTHESES[hid] = {"hypothesis": h, "source": source}
    return to_ui(h, hid, source)


# ---- Static frontend (must stay LAST) ----
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")