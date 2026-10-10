"""Lab Test: turn a confirmed hypothesis + location into a scorecard dict
shaped for the frontend (see the card response in the handoff)."""
from backtest import LOOK_HOUR, MIN_N_BACKTEST, RAIN_MM, build_days, score, sign_mask, wilson


def build_card(df, *, proverb, source, label, variable, feature, threshold, window_hours):
    days = build_days(df, window_hours)
    if days.empty:
        raise ValueError("No usable days of weather history for that place.")

    mask = sign_mask(days, variable, feature, threshold)
    base, n, k = score(days, mask)

    card = {
        "mode": "lab",
        "proverb": proverb,
        "source": source,
        "location_label": label,
        "n_sign_present": n,
        "hits": k,
        "n_pending": 0,
        "base_rate": float(base),          # always sent
        "hit_rate": None,                  # null (never 0) below the minimum sample
        "ci_low": None,
        "ci_high": None,
        "lift": None,
        "lift_pp": None,
        "verdict": "On the trail",
        "next_action": None,
        "min_n": MIN_N_BACKTEST,
        "looks_total": int(len(days)),     # days analysed
        "window_hours": window_hours,
        "rain_mm": RAIN_MM,                # the pre-committed constants behind "rain followed"
        "look_hour": LOOK_HOUR,
    }

    if n < MIN_N_BACKTEST:
        card["next_action"] = (
            f"This sign showed up on only {n} of {len(days)} days. "
            f"A looser threshold may reach the {MIN_N_BACKTEST} sign days a verdict needs."
        )
        return card

    lo, hi = wilson(k, n)
    hit = k / n
    card["hit_rate"] = float(hit)
    card["ci_low"] = float(lo)
    card["ci_high"] = float(hi)
    # The UI prints lift as a multiplier ("x0.94"), so lift is hit_rate / base_rate.
    card["lift"] = float(hit / base) if base > 0 else None
    card["lift_pp"] = float(100 * (hit - base))
    card["verdict"] = "Promising" if lo > base else "Backfires" if hi < base else "Same as chance"
    card["next_action"] = "Try the Field Test to add your own looks. One place and a short history is a hint, not proof."
    return card