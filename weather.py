import datetime as dt
from pathlib import Path
import httpx
import pandas as pd

CACHE = Path("cache")
CACHE.mkdir(exist_ok = True)

HOURLY = ["pressure_msl","cloud_cover_high","relative_humidity_2m", "wind_direction_10m","precipitation"]

def geocode(city:str):
    r = httpx.get("https://geocoding-api.open-meteo.com/v1/search",
        params = {"name": city, "count": 1}, timeout=30)
    r.raise_for_status()
    res = r.json().get("results")
    if not res:
        raise ValueError(f"Location not found: {city}")
    p = res[0]
    return p["name"],p["latitude"],p["longitude"]

def fetch_history(lat: float, lon: float, years: int = 10) -> pd.DataFrame:
    #* Hourly reanalysis (ERA5 via Open-Meteo archive), cached per location

    f = CACHE / f"{lat:.2f}_{lon:.2f}_{years}y.csv"
    if f.exists():
        return pd.read_csv(f, parse_dates=["time"], index_col="time")
    
    end = dt.date.today() - dt.timedelta(days=7)  #* archive lags a few days
    start = end.replace(year = end.year - years)

    frames = []
    for y in range(start.year, end.year + 1):     #* one request per year
        s = max(start, dt.date(y, 1, 1)) 
        e = min(end, dt.date(y, 12, 31))

        r = httpx.get("https://archive-api.open-meteo.com/v1/archive", params={
            "latitude": lat, "longitude": lon,
            "start_date": s.isoformat(), "end_date": e.isoformat(),
            "hourly": ",".join(HOURLY), "timezone": "auto",
        }, timeout=120)
        j = r.json()

        if r.status_code != 200 or "hourly" not in j:
            raise RuntimeError(f"Open-Meteo error for {y}: {j.get('reason', r.text[:200])}")
        frames.append(pd.DataFrame(j["hourly"]))
        print("fetched", y)
    df = pd.concat(frames)
    df["time"] = pd.to_datetime(df["time"])
    df = df.set_index("time").sort_index()
    df.to_csv(f)
    return df




