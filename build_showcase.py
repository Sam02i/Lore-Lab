#!/usr/bin/env python3
"""Runs ONE pre-registered Lore Lab experiment on real Open-Meteo (ERA5) history
and writes assets/showcase.json for the landing page. Stdlib only. Needs internet.
    python build_showcase.py
Everything under PRE-REGISTERED is fixed before any data is fetched; the page shows whatever comes out."""
import datetime as dt, json, math, os, sys, time, urllib.parse, urllib.request

# ---- PRE-REGISTERED (edit only to run a different experiment) ----
SAYING, SOURCE = "A falling glass brings rain.", "Traditional"
PLACE, LAT, LON, TZ = "London", 51.5074, -0.1278, "Europe/London"
YEARS = list(range(2016, 2026))
LOOK_HOUR, SPAN_H, FALL_HPA = 8, 3, 2.0   # sign: pressure at 08:00 is >= 2 hPa below 05:00
WINDOW_H, RAIN_MM, MIN_N = 12, 1.0, 30    # outcome: >= 1 mm rain in the next 12 h; verdict needs 30 sign days

def fetch(y):
    """One year of hourly data. Cached in .cache/ so a dropped connection resumes instead of restarting."""
    path = f".cache/{PLACE}-{y}-{LAT}-{LON}.json"
    if os.path.exists(path):
        with open(path) as f: return json.load(f)
    q = urllib.parse.urlencode(dict(latitude=LAT, longitude=LON, start_date=f"{y}-01-01", end_date=f"{y}-12-31",
                                    hourly="pressure_msl,precipitation", timezone=TZ))
    for a in range(8):
        try:
            with urllib.request.urlopen("https://archive-api.open-meteo.com/v1/archive?" + q, timeout=60) as r:
                h = json.load(r)["hourly"]
            os.makedirs(".cache", exist_ok=True)
            with open(path, "w") as f: json.dump(h, f)
            print(f"  fetched {y}", flush=True)
            return h
        except Exception as e:
            wait = min(5 * 2 ** a, 120)  # 5s, 10s, 20s ... capped at 2 min (also covers HTTP 429 rate limits)
            if a == 7: sys.exit(f"Could not fetch {y}: {e}\nCheck your connection/VPN/DNS, then just run it again: finished years are cached.")
            print(f"  {y}: {e}; retrying in {wait}s", flush=True); time.sleep(wait)

def wilson(k, n, z=1.96):
    if n == 0: return 0.0, 0.0
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - m, c + m

def run():
    days = []  # (year, sign_present, outcome)
    for y in YEARS:
        h = fetch(y); P = dict(zip(h["time"], h["pressure_msl"])); R = dict(zip(h["time"], h["precipitation"]))
        d = dt.date(y, 1, 1)
        while d.year == y:
            s = d.isoformat()
            p1, p0 = P.get(f"{s}T{LOOK_HOUR:02d}:00"), P.get(f"{s}T{LOOK_HOUR - SPAN_H:02d}:00")
            rain = [R.get(f"{s}T{LOOK_HOUR + k:02d}:00") for k in range(1, WINDOW_H + 1)]
            if p1 is not None and p0 is not None and None not in rain:
                days.append((y, p1 - p0 <= -FALL_HPA, sum(rain) >= RAIN_MM))
            d += dt.timedelta(1)
    N = len(days); base = sum(o for _, _, o in days) / N
    sign = [x for x in days if x[1]]; n = len(sign); hits = sum(o for _, _, o in sign)
    lo, hi = wilson(hits, n); hit = hits / n if n else None
    verdict = "on_the_trail" if n < MIN_N else "promising" if lo > base else "backfires" if hi < base else "same_as_chance"
    years = []
    for y in YEARS:
        dy = [x for x in days if x[0] == y]; sy = [x for x in dy if x[1]]
        years.append(dict(year=y, n=len(sy), base_rate=sum(o for *_, o in dy) / len(dy),
                          hit_rate=(sum(o for *_, o in sy) / len(sy)) if sy else None))
    return dict(
        saying=SAYING, source=SOURCE,
        setup=dict(place=PLACE, years=[YEARS[0], YEARS[-1]], days_total=N,
                   sign=f"Pressure at {LOOK_HOUR}am at least {FALL_HPA:g} hPa below {LOOK_HOUR - SPAN_H}am",
                   outcome=f"{RAIN_MM:g} mm or more of rain in the next {WINDOW_H} hours"),
        scorecard=dict(mode="lab", proverb=SAYING, source=SOURCE, location_label=PLACE, n_sign_present=n, hits=hits,
                       base_rate=base, hit_rate=hit, ci_low=lo, ci_high=hi, lift=(hit / base) if hit is not None and base else None,
                       verdict=verdict, min_n=MIN_N, window_hours=WINDOW_H, rain_mm=RAIN_MM, look_hour=LOOK_HOUR,
                       notes=[f"Threshold preset: a {FALL_HPA:g} hPa fall over {SPAN_H} hours, fixed before any data was fetched.",
                              "Modelled reanalysis (ERA5 via Open-Meteo), not weather-station readings."]),
        years=years,
        provenance=dict(source="Open-Meteo Historical Weather API (ERA5 reanalysis)",
                        url="https://open-meteo.com/en/docs/historical-weather-api", generated=dt.date.today().isoformat()))

if __name__ == "__main__":
    out = run(); os.makedirs("assets", exist_ok=True)
    with open("assets/showcase.json", "w") as f: json.dump(out, f, indent=1)
    sc = out["scorecard"]; print(f"{sc['verdict']}: {sc['hits']}/{sc['n_sign_present']} sign days, base {sc['base_rate']:.1%}, hit {sc['hit_rate']:.1%}")