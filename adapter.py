"""Translate the model's Hypothesis (schema.py) into the shape the frontend
(lore.js normHyp) expects. Code decides backtestable; the model never does."""
from typing import Optional

from schema import Hypothesis, is_backtestable

# Display unit for each whitelisted weather variable.
UNITS = {
    "pressure_msl": "hPa",
    "wind_direction_10m": "°",
    "cloud_cover_high": "%",
    "relative_humidity_2m": "%",
}


def to_ui(h: Hypothesis, id: str, source: Optional[str]) -> dict:
    backtestable = is_backtestable(h)

    # No proxy variable -> send null so the UI shows no "match" line.
    proxy = None
    if h.proxy.variable != "none":
        proxy = {
            "variable": h.proxy.variable,
            "feature": h.proxy.feature,
            "fit": h.proxy.fit,
            "rationale": h.proxy.why_it_fits,
            "unit": UNITS.get(h.proxy.variable, ""),
        }

    return {
        "id": id,
        "original_text": h.original_text,
        "language": h.language,
        "source": source or "unknown",
        "translation_en": h.english_translation,
        "sign": {
            "kind": h.sign.kind,
            "observable": h.sign.description,
            "how_to_observe": h.sign.how_to_observe,
            "when_observable": h.sign.best_time_of_day,
            "observable_by": h.sign.observable_by,
        },
        # Must be an object with a string "outcome", else the UI shows [object Object].
        "prediction": {
            "outcome": h.outcome.event,
            "window_hours": h.outcome.window_hours,
        },
        "proxy": proxy,
        "live_only_reason": h.live_only_reason,
        "ambiguities": list(h.ambiguities),
        "backtestable": backtestable,
        "test_mode": "lab" if backtestable else "field",
        # threshold_suggestion is deliberately never sent: the user sets the number.
    }