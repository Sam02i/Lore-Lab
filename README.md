# Lore Lab

**Your grandmother said it. Lore Lab goes outside with you to find out if she was right.**

Lore Lab turns folk weather sayings into small, honest experiments. A local open-weight model
(Gemma, through Ollama) reads a saying in any language and turns it into something you can check.
You review it and set every number yourself. Then either:

* **Lab Test** – the sign is something an instrument records (pressure, wind direction, humidity, high cloud),
  so the saying is scored against ten years of past weather, or
* **Field Test** – the sign is a swift, a cow, a pine cone, the look of the moon. No instrument records those,
  so *you* are the instrument: step outside, tap **Seen** or **Not seen**, and put the phone away.
  Lore Lab checks the sky for you later.

Every result is shown next to the **bar to beat**: how often it rains anyway. A saying only means something
if it beats that. "Same as chance" is a real result and is shown with the same pride as "Promising".

Built for the Hacktoberfest Open-Source AI Challenge, Week 1 "Touch Grass".

## How it works

```
Saying -> Gemma proposes a hypothesis (JSON, schema-validated, closed vocabularies)
       -> you review, edit and set the threshold (the model never picks a number)
       -> plain code decides Lab Test or Field Test      <- "Gemma proposes, code decides"
       -> Lab:   10-year backtest, Wilson interval, lift, verdict
          Field: look outside -> Seen / Not seen -> outcome filled in lazily from weather data
```

* **Gemma proposes, code decides.** `schema.is_backtestable()` is the only thing that classifies a saying as a
  Lab Test: `sign.kind == "atmospheric"` AND proxy variable on the whitelist AND `fit != "none"`.
  A "rough" fit needs your explicit OK.
* **No threshold from the model.** The schema has no threshold field at all. You set the number.
* **Lazy, idempotent outcome resolution** (`resolve.py`). No scheduler or workflow engine. Every time the app is
  opened, due looks are filled in from Open-Meteo hourly precipitation. Failed fetches retry, max 5 attempts, then
  the look is marked failed, excluded from scoring and counted separately.

## Run it

```bash
pip install -r requirements.txt
ollama pull gemma3:4b            # optional: LORE_MODEL=gemma3:12b python -m uvicorn server:app
uvicorn server:app
# open http://127.0.0.1:8000
```

Tests (offline, no model, no network): `pip install -r requirements-dev.txt && python -m pytest -q`

Model comparison for the write-up: `python run_test.py gemma3:4b gemma3:12b` (saves `results/<model>.json`).

## Pre-committed constants

Set in `config.py` and committed **before** looking at any new result. `GET /api/config` returns them.

| Constant | Value | Meaning |
|---|---|---|
| `MIN_N_BACKTEST` | 30 | sign-present days before a Lab Test shows a hit rate or verdict |
| `MIN_N_LIVE` | 10 | sign-present looks, on different days, before a Field Test shows a verdict |
| `RAIN_MM` | 0.2 | total precipitation in the window that counts as "rain" |
| `WINDOW_H` | 12 | outcome window in hours; starts at the next full hour after the look |
| `LOOK_HOUR` | 18 | local hour a backtest "looks outside" (dusk) |
| `HISTORY_YEARS` | 10 | years of reanalysis used by the Lab Test |

Deviation from the original plan, stated openly: the PRD drafted a 24 h window. It was shortened to 12 h so a
real evening look can resolve inside the build window.
**First exploratory Lab run was Delhi, at an earlier 24 h window; Pune is a separate result.**
Results below were produced with the constants above.

## How looks are counted

* Only **Seen** looks are sign-present looks. **Not seen** looks are logged and shown separately.
* **One look per local day counts.** Extra looks the same evening are noted and not counted.
* Pending looks appear on the tally but are never scored. Failed looks are excluded and counted separately.
* Lab and Field results are **never pooled**.
* Below the minimum N the card shows raw counts, the bar to beat, and what result would count
  (computed from the Wilson interval for the current N and base rate, never hardcoded). No hit rate,
  interval or verdict appears until the minimum is reached.

## Results

> Fill these in from real output only. Do not round up.

| Saying | Place | Mode | N | Base rate | Hit rate (95% CI) | Verdict |
|---|---|---|---|---|---|---|
| _e.g. falling pressure_ | Delhi | Lab | _n_ | _%_ | _% (lo–hi)_ | _Same as chance_ |
| Swifts flying low means rain | _place_ | Field | _n of 10_ | _%_ | not shown below N = 10 | On the trail |

Gemma extraction test set (`run_test.py`): see `results/*.json`. _Paste the table the script prints._

## Limits (please read)

* **Reanalysis, not stations.** The ten-year history is ERA5 reanalysis served by Open-Meteo: modelled data.
* **One place, a short history is a hint, not proof.** Lore Lab does not prove a saying true and does not
  forecast better than meteorologists.
* **Small pilot.** Field samples from a short build window are small. The UI says so.
* **Rain only.** The Lab Test scores rain outcomes; other predicted events run as Field Tests.
* **Small-model errors.** Gemma sometimes misclassifies a sign. That is why code decides backtestability,
  and why accuracy is measured and reported rather than assumed.
* **Storage.** Hypotheses are saved to `hypotheses.json` and Field notes to `data.json` (both gitignored,
  atomic writes). Local file storage is a deliberate choice for a one-person demo, not a production design.
* **Not built:** TabPFN context-adjusted lift, Dolbear's law test, photos, offline mode, Daily Look Card,
  Temporal (removed in favour of lazy resolution), hosted deployment. Gemma runs locally.

## Starter corpus

`proverbs.json` holds the starter sayings with provenance notes. Only entries marked `"verified": true`
are served to the app. Entries with `"verified": false` are kept in the file for transparency and are
never presented as verified. Sources are never invented; unknown means `unknown`.

## Rules and credits

* Project started inside the challenge window; repo created fresh.
* Open-Meteo (geocoding, archive, forecast), Ollama + Gemma, FastAPI, pandas.
* Any commit after the deadline is listed here: _none yet_.
