import math
import sys

from backend.weather import geocode, fetch_history

RAIN_MM = 0.2   #? total perception in the window that counts as "rain"
LOOK_HOUR = 18           #? local hour you "look outside" (dusk)
WINDOW_H = 24            #? outcome window starts the next full hour
MIN_N_BACKTEST = 30

#? Hypothesis: "falling glass" = pressure drops by at least this much in 3 hours

PRESSURE_DROP_HPA = 1.0  #? user-set threshold, never model-set (F4)

def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)

def build_days(df):
    d = df.copy()
    # outcome: precip summed over the next WINDOW_H hours (t+1 .. t+24)
    d["future_precip"] = d["precipitation"].rolling(WINDOW_H).sum().shift(-WINDOW_H)
    d["p_change_3h"] = d["pressure_msl"] - d["pressure_msl"].shift(3)
    d = d[d.index.hour == LOOK_HOUR].dropna(subset=["future_precip", "p_change_3h"])
    d["rain"] = d["future_precip"] >= RAIN_MM
    return d


def score(days, sign):
    base = days["rain"].mean()
    present = days[sign]
    n = len(present)
    k = int(present["rain"].sum())
    return base, n, k


if __name__ == "__main__":
    city = " ".join(sys.argv[1:]) or "Pune"
    name, lat, lon = geocode(city)
    print(f"Location: {name} ({lat:.2f}, {lon:.2f})")
    days = build_days(fetch_history(lat, lon))
    sign = days["p_change_3h"] <= -PRESSURE_DROP_HPA
    base, n, k = score(days, sign)

    print(f"Days analysed : {len(days)}")
    print(f"Base rate (rain follows any day): {base:.1%}")
    if n < MIN_N_BACKTEST:
        print(f"ON THE TRAIL: sign seen on {n} days, rain followed {k}. Need {MIN_N_BACKTEST}.")
    else:
        lo, hi = wilson(k, n)
        hit = k / n
        verdict = ("Promising" if lo > base else
                "Backfires" if hi < base else "Same as chance")
        print(f"Sign present: {n} days | rain followed: {k}")
        print(f"Hit rate: {hit:.1%} (95% CI {lo:.1%} to {hi:.1%})")
        print(f"Lift: {100 * (hit - base):+.1f} percentage points")
        print(f"Verdict: {verdict}")
        print("Caveat: one place, reanalysis data, not proof.")
