
import datetime as dt

from backtest import wilson
from config import MIN_N_LIVE
from scorecard import verdict_for, what_would_count_text


def local_day(observed_at_iso: str, lon: float) -> dt.date:
    """Calendar day at the place of the look (longitude/15 hours from UTC; no tz database needed)."""
    t = dt.datetime.fromisoformat(observed_at_iso)
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return (t.astimezone(dt.timezone.utc) + dt.timedelta(hours=lon / 15.0)).date()


def count_looks(exp: dict) -> dict:
    lon = exp["location"]["lon"]
    seen_days, tally = set(), []
    not_seen = failed = dupes = 0
    for o in sorted(exp["observations"], key=lambda x: x["observed_at"]):
        if o["status"] == "failed":
            failed += 1
            continue
        if not o["seen"]:
            not_seen += 1
            continue
        day = local_day(o["observed_at"], lon)
        if day in seen_days:
            dupes += 1
            continue
        seen_days.add(day)
        if o["status"] == "resolved":
            tally.append("hit" if o["rain"] else "miss")
        else:
            tally.append("pending")
    return {"tally": tally, "not_seen": not_seen, "failed": failed, "dupes": dupes}


def build_field_card(exp: dict, base) -> dict:
    c = count_looks(exp)
    resolved = [t for t in c["tally"] if t != "pending"]
    n, hits = len(resolved), sum(1 for t in resolved if t == "hit")
    pending = c["tally"].count("pending")
    event = "rain"

    card = {
        "mode": "field",
        "proverb": exp["proverb"],
        "source": exp["source"],
        "location_label": exp["location"]["label"],
        "n_sign_present": n,
        "hits": hits,
        "n_pending": pending,
        "n_not_seen": c["not_seen"],
        "n_failed": c["failed"],
        "tally": c["tally"],
        "base_rate": None if base is None else float(base),
        "hit_rate": None, "ci_low": None, "ci_high": None, "lift": None, "lift_pp": None,
        "verdict": "On the trail",
        "next_action": None,
        "min_n": MIN_N_LIVE,
        "looks_total": len(c["tally"]),
        "window_hours": exp["window_hours"],
        "notes": [],
    }
    notes = card["notes"]
    if base is not None:
        notes.append(f"Chance says rain follows on {base:.0%} of days here.")
    if c["not_seen"]:
        notes.append(f"{c['not_seen']} “Not seen” look(s) logged. They don’t count toward the tally: the saying only predicts rain when the sign is there.")
    if c["dupes"]:
        notes.append(f"{c['dupes']} extra look(s) on a day already counted were left out: one look per day.")
    if c["failed"]:
        notes.append(f"{c['failed']} look(s) couldn’t be resolved (no sky data) and are counted separately, not scored.")

    when = exp.get("observe_when") or "dusk"
    if n < MIN_N_LIVE:
        left = MIN_N_LIVE - n
        if base is not None:
            notes.append(what_would_count_text(MIN_N_LIVE, base, event))
        card["next_action"] = f"{left} more looks to a verdict. Look again at {when}."
        return card

    lo, hi = wilson(hits, n)
    hit = hits / n
    card["hit_rate"], card["ci_low"], card["ci_high"] = float(hit), float(lo), float(hi)
    if base is not None:
        card["verdict"] = verdict_for(hits, n, base)
        card["lift"] = float(hit / base) if base > 0 else None
        card["lift_pp"] = float(100 * (hit - base))
    card["next_action"] = "Keep looking on different days to tighten the interval."
    return card