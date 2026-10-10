from typing import Literal, Optional
from pydantic import BaseModel, Field

from config import WINDOW_H

# Closed vocabularies: Gemma may only pick from these (PRD section 8).
class Sign(BaseModel):
    description: str
    how_to_observe: str
    kind: Literal["atmospheric", "animal", "plant", "celestial", "body", "other"]
    observable_by: Literal["eyes", "ears", "instrument", "count"]
    best_time_of_day: Literal["dawn", "day", "midday", "dusk", "night", "any"]


class Outcome(BaseModel):
    event: Literal["rain", "wind", "cold", "clear", "other"]
    window_hours: int = WINDOW_H


class Proxy(BaseModel):
    variable: Literal["pressure_msl", "wind_direction_10m", "cloud_cover_high", "relative_humidity_2m", "none"]
    feature: Literal["level", "change_3h", "change_6h", "none"]
    why_it_fits: Optional[str] = None
    fit: Literal["good", "rough", "none"]


class Hypothesis(BaseModel):
    original_text: str
    language: str
    english_translation: str
    sign: Sign
    outcome: Outcome
    proxy: Proxy
    live_only_reason: Optional[str] = None
    ambiguities: list[str] = Field(default_factory=list)
    # NOTE: there is deliberately NO threshold_suggestion field. The model never
    # proposes a number (F4); the user sets it on the review screen.


WHITELIST = {"pressure_msl", "wind_direction_10m", "cloud_cover_high", "relative_humidity_2m"}


def is_backtestable(h: Hypothesis) -> bool:
    """Gemma proposes, code decides (F5)."""
    return (
        h.sign.kind == "atmospheric"
        and h.proxy.variable in WHITELIST
        and h.proxy.fit != "none"
    )