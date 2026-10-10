import math
import sys

from weather import geocode, fetch_history

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

def build_days(df, window_h=WINDOW_H):
    d = df.copy()
    # outcome: precip summed over the next window_h hours (t+1 .. t+window_h)
    d["future_precip"] = d["precipitation"].rolling(window_h).sum().shift(-window_h)
    d["p_change_3h"] = d["pressure_msl"] - d["pressure_msl"].shift(3)
    d["p_change_6h"] = d["pressure_msl"] - d["pressure_msl"].shift(6)
    # NOTE: the rows kept are decided only by future_precip and p_change_3h, exactly as
    # before, so default results (e.g. the Delhi run) do not change.
    d = d[d.index.hour == LOOK_HOUR].dropna(subset=["future_precip", "p_change_3h"])
    d["rain"] = d["future_precip"] >= RAIN_MM
    return d


def sign_mask(days, variable, feature, threshold):
    """True on the days the sign is present. `threshold` is always the USER's number.
    pressure_msl            change_3h / change_6h: pressure fell by at least `threshold` hPa
                            level: pressure at or below `threshold` hPa
    cloud_cover_high        high cloud cover at or above `threshold` %
    relative_humidity_2m    humidity at or above `threshold` %
    wind_direction_10m      wind within 45 degrees of the compass bearing `threshold`
    """
    if variable == "pressure_msl":
        if feature == "level":
            return days["pressure_msl"] <= threshold
        col = "p_change_6h" if feature == "change_6h" else "p_change_3h"
        return days[col] <= -abs(threshold)
    if variable == "cloud_cover_high":
        return days["cloud_cover_high"] >= threshold
    if variable == "relative_humidity_2m":
        return days["relative_humidity_2m"] >= threshold
    if variable == "wind_direction_10m":
        diff = (days["wind_direction_10m"] - threshold + 180) % 360 - 180
        return diff.abs() <= 45
    raise ValueError(f"No lab proxy for {variable}")


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