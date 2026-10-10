
import sys

from backtest import wilson
from config import MIN_N_LIVE


def verdict_for(k: int, n: int, base: float) -> str:
    """Promising / Same as chance / Backfires, from the Wilson interval vs the base rate."""
    lo, hi = wilson(k, n)
    if lo > base:
        return "Promising"
    if hi < base:
        return "Backfires"
    return "Same as chance"


def what_would_count(n: int, base: float):
    """Smallest number of hits out of n whose Wilson lower bound beats chance (None if impossible)."""
    for k in range(n + 1):
        if wilson(k, n)[0] > base:
            return k
    return None


def what_would_count_text(n: int, base: float, event: str = "rain") -> str:
    k = what_would_count(n, base)
    if k is None:
        return f"Even {n} out of {n} would not clearly beat chance at this base rate."
    return f"With {n} looks, {event} would need to follow at least {k} times to clearly beat chance."


def tally(hits: int, looks: int, target: int) -> str:
    """Text version: filled = rain followed, hollow = no rain, dot = look still needed."""
    return " ".join("●" * hits + "○" * (looks - hits) + "·" * max(0, target - looks))


def live_card(city, hits, looks):  # CLI helper
    from backtest import build_days
    from weather import fetch_history, geocode

    name, lat, lon = geocode(city)
    base = build_days(fetch_history(lat, lon))["rain"].mean()
    print(f"\n  Field notes · {name}")
    print(f"  Chance says rain follows on {base:.0%} of days here.")
    if looks < MIN_N_LIVE:
        print(f"  On the trail. {looks} of {MIN_N_LIVE} looks.")
        print(f"  {tally(hits, looks, MIN_N_LIVE)}   ({hits} of {looks}: rain followed)")
        print(f"  {what_would_count_text(MIN_N_LIVE, base)}")
        print(f"  {MIN_N_LIVE - looks} more looks to a verdict. Look again at dusk.")
    else:
        lo, hi = wilson(hits, looks)
        print(f"  {verdict_for(hits, looks, base)}: {hits} of {looks} ({hits / looks:.0%}), 95% CI {lo:.0%} to {hi:.0%}")
    print("  One place and a short history is a hint, not proof.\n")


if __name__ == "__main__":
    # usage: python scorecard.py <hits> <looks> <city...>
    live_card(" ".join(sys.argv[3:]) or "Delhi", int(sys.argv[1]), int(sys.argv[2]))