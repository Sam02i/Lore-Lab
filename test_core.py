"""Run with:  python -m pytest -q
Offline: no Ollama and no network. Weather is synthetic; the maths and the rules are real."""
import datetime as dt
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
from backtest import build_days, sign_mask, wilson  # noqa: E402
from field import build_field_card, count_looks  # noqa: E402
from schema import Hypothesis, is_backtestable  # noqa: E402
from scorecard import verdict_for, what_would_count  # noqa: E402


def hyp(kind="atmospheric", variable="pressure_msl", fit="good"):
    return Hypothesis.model_validate({
        "original_text": "x", "language": "English", "english_translation": "x",
        "sign": {"description": "d", "how_to_observe": "h", "kind": kind, "observable_by": "eyes", "best_time_of_day": "dusk"},
        "outcome": {"event": "rain"},
        "proxy": {"variable": variable, "feature": "change_3h", "fit": fit},
    })


def test_backtestable_is_decided_by_code():
    assert is_backtestable(hyp())
    assert not is_backtestable(hyp(kind="animal"))                       # animals are never instruments
    assert not is_backtestable(hyp(fit="none"))
    assert not is_backtestable(hyp(variable="none", fit="good"))         # not on the whitelist
    assert is_backtestable(hyp(kind="atmospheric", fit="rough"))         # rough still needs the user's OK (server)


def test_plant_kind_is_allowed():
    assert hyp(kind="plant").sign.kind == "plant"


def test_wilson_basic():
    lo, hi = wilson(5, 10)
    assert 0.23 < lo < 0.25 and 0.75 < hi < 0.77
    assert wilson(0, 0) == (0.0, 1.0)


def test_what_would_count_is_computed_not_hardcoded():
    k_low = what_would_count(10, 0.15)
    k_high = what_would_count(10, 0.5)
    assert k_low is not None and k_high is not None and k_high > k_low
    assert wilson(k_low, 10)[0] > 0.15 and wilson(k_low - 1, 10)[0] <= 0.15
    assert what_would_count(10, 0.99) is None


def test_verdicts():
    assert verdict_for(10, 10, 0.3) == "Promising"
    assert verdict_for(0, 12, 0.5) == "Backfires"
    assert verdict_for(5, 10, 0.5) == "Same as chance"


def synthetic_history(years=3, seed=1):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2022-01-01", periods=24 * 365 * years, freq="h")
    return pd.DataFrame({
        "pressure_msl": 1010 + np.cumsum(rng.normal(0, 0.4, len(idx))) * 0.1,
        "cloud_cover_high": rng.uniform(0, 100, len(idx)),
        "relative_humidity_2m": rng.uniform(20, 100, len(idx)),
        "wind_direction_10m": rng.uniform(0, 360, len(idx)),
        "precipitation": np.where(rng.uniform(0, 1, len(idx)) < 0.04, rng.uniform(0.2, 3, len(idx)), 0.0),
    }, index=idx.rename("time"))


def test_backtest_pipeline_uses_precommitted_constants():
    days = build_days(synthetic_history())
    assert (days.index.hour == config.LOOK_HOUR).all()
    assert days["rain"].dtype == bool
    mask = sign_mask(days, "pressure_msl", "change_3h", 1.0)
    assert mask.sum() >= 0
    with pytest.raises(ValueError):
        sign_mask(days, "none", "none", 0)


def obs(day_offset, seen=True, status="resolved", rain=True, hour=12):
    t = dt.datetime(2026, 10, 1, hour, 0, tzinfo=dt.timezone.utc) + dt.timedelta(days=day_offset)
    return {"seen": seen, "observed_at": t.isoformat(), "status": status, "rain": rain if status == "resolved" else None}


def exp_with(observations):
    return {"proverb": "Swifts flying low means rain.", "source": "unknown", "window_hours": 12, "observe_when": "dusk",
            "location": {"label": "Delhi", "lat": 28.6, "lon": 77.2}, "observations": observations}


def test_field_card_below_minimum_shows_tally_and_no_verdict():
    card = build_field_card(exp_with([obs(0, rain=True), obs(1, rain=False), obs(2, status="pending")]), base=0.31)
    assert card["verdict"] == "On the trail"
    assert card["hit_rate"] is None and card["ci_low"] is None and card["lift"] is None
    assert card["tally"] == ["hit", "miss", "pending"]
    assert card["n_sign_present"] == 2 and card["hits"] == 1 and card["n_pending"] == 1
    assert "8 more looks to a verdict" in card["next_action"]
    assert any("31%" in n for n in card["notes"])
    assert any("at least" in n and "10 looks" in n for n in card["notes"])


def test_field_card_counts_one_look_per_day_and_separates_not_seen_and_failed():
    o = [obs(0), obs(0, hour=13), obs(1, seen=False), obs(2, status="failed")]
    c = count_looks(exp_with(o))
    assert c["tally"] == ["hit"] and c["dupes"] == 1 and c["not_seen"] == 1 and c["failed"] == 1


def test_field_card_gives_a_verdict_at_minimum_n():
    looks = [obs(i, rain=(i < 9)) for i in range(10)]   # 9 of 10
    card = build_field_card(exp_with(looks), base=0.3)
    assert card["n_sign_present"] == 10 and card["verdict"] == "Promising"
    assert card["hit_rate"] == pytest.approx(0.9) and card["ci_low"] > 0.3
    chance = build_field_card(exp_with([obs(i, rain=(i < 3)) for i in range(10)]), base=0.3)
    assert chance["verdict"] == "Same as chance"


# ---------------------------------------------------------------- API (model and weather faked)
@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    import server
    monkeypatch.setattr(server, "HYP_FILE", tmp_path / "hypotheses.json")
    monkeypatch.setattr(server, "DATA_FILE", tmp_path / "data.json")
    server.HYPOTHESES.clear(); server.EXPERIMENTS.clear(); server._BASE_CACHE.clear()
    monkeypatch.setattr(server, "extract", lambda text: hyp(kind="animal", variable="none", fit="none"))
    hist = synthetic_history()
    monkeypatch.setattr(server, "fetch_history", lambda lat, lon, *a, **k: hist)
    monkeypatch.setattr(server, "resolve_due", lambda exps: 0)
    from fastapi.testclient import TestClient
    return TestClient(server.app), server


def test_api_flow_field_test(client):
    c, server = client
    r = c.post("/api/extract", json={"text": "Swifts flying low means rain.", "source": None}).json()
    assert r["test_mode"] == "field" and r["source"] == "unknown" and "threshold_suggestion" not in r
    hid = r["id"]
    assert c.post(f"/api/hypotheses/{hid}/confirm", json={}).json()["test_mode"] == "field"
    loc = {"location": {"label": "Delhi", "lat": 28.61, "lon": 77.21}}
    e1 = c.post(f"/api/hypotheses/{hid}/field-test", json=loc).json()["experiment_id"]
    e2 = c.post(f"/api/hypotheses/{hid}/field-test", json=loc).json()["experiment_id"]
    assert e1 == e2                                              # one saying = one notebook page
    assert c.post(f"/api/experiments/{e1}/observations", json={"seen": True}).json() == {"ok": True}
    card = [x for x in c.get("/api/scorecards").json() if x["mode"] == "field"][0]
    assert card["verdict"] == "On the trail" and card["n_pending"] == 1 and card["base_rate"] is not None


def test_state_survives_restart(client):
    c, server = client
    hid = c.post("/api/extract", json={"text": "x"}).json()["id"]
    server.HYPOTHESES.clear()
    server.HYPOTHESES.update(server._load_hypotheses())
    assert hid in server.HYPOTHESES and server.HYPOTHESES[hid]["prompt_version"]


def test_lab_requires_the_users_number(client, monkeypatch):
    c, server = client
    monkeypatch.setattr(server, "extract", lambda text: hyp())
    hid = c.post("/api/extract", json={"text": "falling glass"}).json()["id"]
    assert c.post(f"/api/hypotheses/{hid}/confirm", json={}).status_code == 400
    ok = c.post(f"/api/hypotheses/{hid}/confirm", json={"threshold": {"value": 1.0, "unit": "hPa"}})
    assert ok.json()["test_mode"] == "lab"
    card = c.post(f"/api/hypotheses/{hid}/backtest", json={"location": {"label": "Test", "lat": 1, "lon": 1}}).json()
    assert card["mode"] == "lab" and card["base_rate"] is not None
    if card["n_sign_present"] < config.MIN_N_BACKTEST:
        assert card["hit_rate"] is None and card["verdict"] == "On the trail"


def test_starter_corpus_is_served_and_verified_only(client):
    c, _ = client
    items = c.get("/api/proverbs").json()
    assert len(items) >= 10 and all(p["provenance"] and p["verified"] for p in items)
    assert any(p["text"].startswith("Swifts") for p in items)


def test_config_endpoint_matches_constants(client):
    c, _ = client
    j = c.get("/api/config").json()
    assert j["MIN_N_LIVE"] == config.MIN_N_LIVE and j["WINDOW_H"] == config.WINDOW_H


# ---------------------------------------------------------------- lazy outcome resolution (F9)
def _due_exp(window_hours=12):
    now = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = now - dt.timedelta(hours=window_hours + 2)
    o = {"seen": True, "observed_at": (start - dt.timedelta(minutes=10)).isoformat(),
         "window_start": start.isoformat(), "resolve_after": (start + dt.timedelta(hours=window_hours)).isoformat(),
         "status": "pending", "attempts": 0, "last_error": None, "precip_mm": None, "rain": None}
    return {"window_hours": window_hours, "location": {"lat": 1.0, "lon": 1.0}, "observations": [o]}, start


def test_resolution_is_idempotent_and_retries_then_fails(monkeypatch):
    import resolve
    exp, start = _due_exp()
    hours = pd.date_range(start.replace(tzinfo=None) - pd.Timedelta(hours=24), periods=60, freq="h")
    good = pd.DataFrame({"time": hours, "precip": [0.1] * len(hours)})          # 12 h x 0.1 = 1.2 mm -> rain
    monkeypatch.setattr(resolve, "_fetch_hourly", lambda lat, lon: good)
    assert resolve.resolve_due({"e": exp}) == 1
    o = exp["observations"][0]
    assert o["status"] == "resolved" and o["rain"] is True and o["precip_mm"] == pytest.approx(1.2)
    assert resolve.resolve_due({"e": exp}) == 0 and o["attempts"] == 1          # second call does nothing

    exp2, start2 = _due_exp()
    holes = good.copy(); holes.loc[holes["time"] == start2.replace(tzinfo=None), "precip"] = None
    monkeypatch.setattr(resolve, "_fetch_hourly", lambda lat, lon: holes)
    for i in range(config.MAX_ATTEMPTS):
        resolve.resolve_due({"e": exp2})
    o2 = exp2["observations"][0]
    assert o2["status"] == "failed" and o2["attempts"] == config.MAX_ATTEMPTS and o2["last_error"]