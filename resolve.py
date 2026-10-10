"""Lazy outcome resolution: for every observation whose window has closed,
look up the real hourly rain and record whether it rained.

Safe to call as often as you like (idempotent): resolved rows are skipped,
and each try is counted so a broken row gives up after MAX_ATTEMPTS."""

import datetime as dt

import httpx
import pandas as pd

from config import MAX_ATTEMPTS, RAIN_MM


def _fetch_hourly(lat: float, lon: float) -> pd.DataFrame:
    # Forecast endpoint with past_days: the archive endpoint lags by days.
    r = httpx.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat,
            "longitude": lon,
            "hourly": "precipitation",
            "past_days": 7,
            "forecast_days": 2,
            "timezone": "UTC",
        },
        timeout=30,
    )
    r.raise_for_status()
    h = r.json()["hourly"]
    return pd.DataFrame({"time": pd.to_datetime(h["time"]), "precip": h["precipitation"]})


def _naive_utc(iso: str) -> dt.datetime:
    return dt.datetime.fromisoformat(iso).astimezone(dt.timezone.utc).replace(tzinfo=None)


def resolve_due(experiments: dict) -> int:
    """Fill in outcomes for due observations. Returns how many were resolved."""
    now = dt.datetime.now(dt.timezone.utc)
    resolved = 0
    cache = {}  # one weather call per location per run

    for exp in experiments.values():
        loc = exp["location"]
        key = (loc["lat"], loc["lon"])

        for o in exp["observations"]:
            if o["status"] not in ("pending", "retry"):
                continue
            if o["attempts"] >= MAX_ATTEMPTS:
                o["status"] = "failed"
                continue
            if dt.datetime.fromisoformat(o["resolve_after"]) > now:
                continue  # window still open

            o["attempts"] += 1  # claim this try
            try:
                if key not in cache:
                    cache[key] = _fetch_hourly(*key)
                df = cache[key]
                start = _naive_utc(o["window_start"])
                end = _naive_utc(o["resolve_after"])
                win = df[(df["time"] >= start) & (df["time"] < end)]

                if len(win) != exp["window_hours"] or win["precip"].isna().any():
                    raise ValueError("weather data missing for part of the window")

                o["precip_mm"] = float(win["precip"].sum())
                o["rain"] = o["precip_mm"] >= RAIN_MM
                o["status"] = "resolved"
                o["last_error"] = None
                resolved += 1
            except Exception as e:
                o["status"] = "retry"
                o["last_error"] = str(e)

            if o["status"] != "resolved" and o["attempts"] >= MAX_ATTEMPTS:
                o["status"] = "failed"

    return resolved