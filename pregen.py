"""Pre-generated hypotheses for the hosted demo.

Free and small hosts can't run Gemma, so `pregenerate.py` (run once on a machine with Ollama) saves
Gemma's validated output for each starter saying to pregenerated.json. The hosted app serves those.
Live extraction of any new saying still runs locally. Stdlib only, so it is cheap to test."""
import json
import re
import unicodedata
from pathlib import Path
from typing import Optional

FILE = Path(__file__).parent / "pregenerated.json"


def normalize(text: str) -> str:
    """Case, punctuation and spacing don't change which saying it is."""
    t = unicodedata.normalize("NFKC", text).casefold()
    t = re.sub(r"[^\w\s]", "", t)
    return " ".join(t.split())


def load(path: Path = FILE) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # a bad file must never stop the app
        print(f"could not read {path}: {e}")
        return {}


def lookup(text: str, path: Path = FILE) -> Optional[dict]:
    """Return {"hypothesis": dict, "model": str, "prompt_version": str} or None."""
    data = load(path)
    hit = data.get("items", {}).get(normalize(text))
    if not hit:
        return None
    return {
        "hypothesis": hit,
        "model": data.get("model", "unknown"),
        "prompt_version": data.get("prompt_version", "unknown"),
    }