from typing import Literal , Optional
from pydantic import BaseModel, Field

# used pydantic to convert the gemma strings into particular using Literal 
class Sign(BaseModel):
    description: str
    how_to_observe: str
    kind: Literal["atmospheric","animal","planet","celestial","body","other"]
    observable_by :Literal["eyes","ears","instrument","count"]
    best_time_of_day: Literal["day","night","midday","dusk","any"]

class Outcome(BaseModel):
    event : Literal["rain","wind","cold","clear","other"]
    window_hours : int = 24

class Proxy(BaseModel):
    variable: Literal["pressure_msl","wind_direction_10m","cloud_cover_high","relative_humidity_2m","none"]
    feature: Literal["level","change_3h","change_6h","none"]
    why_it_fits: Optional[str] = None
    fit: Literal["good","rough","none"]

class Hypothesis(BaseModel):
    original_text: str
    language: str
    english_translation : str
    sign: Sign
    outcome : Outcome
    proxy : Proxy
    live_only_reason: Optional[str] = None
    ambiguities: list[str] = Field(default_factory=list)

WHITELIST = {"pressure_msl","wind_direction_10m","cloud_cover_high","relative_humidity_2m"}

def is_backtestable(h : Hypothesis) -> bool:
    # Code is going to decide not the model
    return(h.sign.kind == "atmospheric"
    and h.proxy.variable in WHITELIST
    and h.proxy.fit != "none")





