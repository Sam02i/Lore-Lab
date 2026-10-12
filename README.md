<p align="center">
  <img src="https://media2.dev.to/dynamic/image/width=1000,height=420,fit=cover,gravity=auto,format=auto/https%3A%2F%2Fdev-to-uploads.s3.us-east-2.amazonaws.com%2Fuploads%2Farticles%2Fvwievgh7lrrp8u3ffnvt.png" alt="Lore Lab: test your family's weather sayings against ten years of real data" width="100%">
</p>

# 🌿 Lore Lab

### Your family's weather sayings, tested against ten years of real data.

**Then go outside, look at the sky, and put your phone away.**

![License: MIT](https://img.shields.io/badge/license-MIT-green)
[![Model: Gemma 3 4B](https://img.shields.io/badge/model-Gemma%203%204B-4285F4)](https://ai.google.dev/gemma)
[![Runs locally with Ollama](https://img.shields.io/badge/runs%20locally-Ollama-black)](https://ollama.com)
[![Hacktoberfest 2026](https://img.shields.io/badge/Hacktoberfest-2026-ff7518)](https://hacktoberfest.com)

[🎬 Demo video](https://www.youtube.com/watch?v=HX7lMTk8tac) · [🌐 Live demo](https://lore-lab.onrender.com/) · [📝 DEV write-up](https://dev.to/sam_26cdae0e6aa9ff7bd5aa6/lore-lab-i-tested-weather-folklore-against-10-years-of-rain-and-let-gemma-propose-but-never-2pe6)

![Lab scorecard for the south-wind saying in Delhi](https://media2.dev.to/dynamic/image/width=800%2Cheight=%2Cfit=scale-down%2Cgravity=auto%2Cformat=auto/https%3A%2F%2Fdev-to-uploads.s3.us-east-2.amazonaws.com%2Fuploads%2Farticles%2Ftr2jnm9xdeqhebc7j3xt.png)

---

## The idea

> *"When the wind turns south, rain is in its mouth."*

Everyone has a saying like this. Almost nobody checks it. **Lore Lab checks it, and tells you honestly when the answer is "just chance."**

A small open-weight model (**Gemma**) turns a saying into a hypothesis you can test. **You** review it and set every number. **Plain code** scores it, and every result is shown next to **the bar to beat**: how often it rains anyway.

> ### Gemma proposes. Code decides.

## Two ways to test a saying

| 🔬 **Lab Test** | 👀 **Field Test** |
|---|---|
| The sign is something an instrument records: pressure, wind direction, humidity, high cloud. | The sign is something no instrument records: a salt shaker, a swift, the look of the moon. |
| Scored against **ten years of past weather**. | **You are the instrument.** Step outside, tap **Seen** or **Not seen**, put the phone away. |
| Result in seconds. | The app checks the sky for you later and fills in the outcome. |

The Field Test ends on one instruction: **"Logged. We'll check the sky for you. Put your phone away."**

## First results

Delhi, 12-hour window, rain means 0.2 mm or more.

| Saying | Sign-present days | Hit rate (95% CI) | Bar to beat | Lift | Verdict |
|---|---|---|---|---|---|
| *When the wind turns south, rain is in its mouth* | 303 | **42%** (37 to 48%), 128 hits | 19% | ×2.19 | Promising |
| *Mackerel sky, mackerel sky, never long wet, never long dry* | 794 | **47%** (43 to 50%), 371 hits | 19% | ×2.42 | Promising |
| Salt shaker (Field) | 0 of 10 looks with the sign (1 not seen; rain followed, not counted) | not shown below 10 looks | 19% | n/a | On the trail |

> **"Promising" is a hint, not proof.** Both effects could simply be the monsoon: south winds and high cloud are both more common when it rains more anyway. There is no season-adjusted check yet, so that is a possibility, not a finding.

Both Lab sayings use a **rough** proxy that was accepted manually. Wind within 45° of south stands in for "turns south", and high cloud cover above the chosen threshold stands in for a mackerel sky. Each was run once, with no other thresholds tried. An earlier exploratory run on falling pressure predates the rules below, so it is reported but not counted.

## How it works

```
Saying ─► Gemma proposes a hypothesis (JSON, schema-validated, closed vocabularies)
       ─► YOU review it and set the threshold   (the model never picks a number)
       ─► plain code decides: Lab Test or Field Test
       ─► Lab:   10-year backtest · Wilson interval · lift · verdict
          Field: look outside ─► Seen / Not seen ─► outcome filled in lazily from weather data
```

### 🧠 Gemma proposes

`gemma3:4b` runs locally through Ollama. It returns a JSON hypothesis: translation, the sign, how to observe it, the predicted outcome, a proxy weather variable, and any ambiguities. The schema has **no threshold field at all**, so the model cannot choose the number that decides the result. The server refuses to run a Lab Test without a user-set threshold.

### ⚖️ Code decides

- The sign must be atmospheric.
- The proxy variable must be on a whitelist.
- The fit must not be "none". A "rough" fit needs explicit user approval.

The verdict is arithmetic:

| Verdict | Condition |
|---|---|
| **Promising** | The whole 95% Wilson interval sits above the base rate |
| **Backfires** | The whole 95% Wilson interval sits below the base rate |
| **Same as chance** | Anything else |

### 📜 Rules written before results

These constants were committed before looking at any result, so the rules could not be tuned to the numbers.

| Constant | Value |
|---|---|
| Minimum sign-present days for a Lab verdict | 30 |
| Minimum sign-present looks for a Field verdict | 10 |
| What counts as rain | 0.2 mm or more |
| Outcome window | 12 hours, from the next full hour |
| Backtest "look" time | 18:00 |
| History | 10 years |

### ⏳ Lazy outcome resolution

Free hosting sleeps, so a timer can silently never fire. Instead, each look stores when its window closes, and every time the app opens, an idempotent function fills in any due outcome from Open-Meteo hourly precipitation. A failed fetch retries up to five times, then the look is marked failed and counted separately, never dropped or guessed.

## 📏 Measured, not assumed

On a 21-case test set, `gemma3:4b` with prompt v2.1:

| Measure | Result |
|---|---|
| Valid JSON | **21 of 21** |
| Sign kind correct (atmospheric or not) | **17 of 18** |
| Backtestable correct | **19 of 20** |

**Where it failed.** *"Red sky at night, sailor's delight"* was labelled an atmospheric sign, so it came back as backtestable. The code trusts the model's label, so nothing automatic caught it. That is why every hypothesis goes through human review.

## Run it locally

You need Python 3.10 or newer and [Ollama](https://ollama.com).

```bash
# 1. Get the code
git clone https://github.com/Sam02i/Lore-Lab.git
cd Lore-Lab

# 2. Install the dependencies
pip install -r requirements.txt uvicorn

# 3. Download the model
ollama pull gemma3:4b

# 4. Start the app
uvicorn server:app --reload
```

Then open **http://127.0.0.1:8000** in your browser. Keep Ollama running in the background.

### What's in the repo

| File | What it does |
|---|---|
| `server.py` | FastAPI server and API routes; serves the frontend |
| `extract.py`, `prompt.py` | Ask Gemma to turn a saying into a hypothesis |
| `schema.py` | The hypothesis schema and the rules for what can be backtested |
| `adapter.py` | Shapes hypotheses for the frontend |
| `weather.py` | Fetches ten years of history from Open-Meteo |
| `backtest.py`, `lab.py`, `scorecard.py` | Plain-Python scoring and verdicts. **No model in the loop.** |
| `run_test.py` | Test runner for the extraction test set |
| `frontend/` | The web app |

## Hosted demo

The live app runs on Render's free plan at [lore-lab.onrender.com](https://lore-lab.onrender.com/).

- Render does not run Gemma, so the hosted app serves hypotheses that were generated locally ahead of time.
- There is **no persistent logbook** on the free plan. Field Test looks are saved only in a local install.
- The Delhi weather history ships as a cache file, because the host's shared IP hit Open-Meteo's daily request limit. It is the same history the local run downloaded, and the hosted result matches the local one.
- The free host sleeps, so the first load can take about a minute.

## Limits (please read)

- Reanalysis (modelled data), not weather-station readings.
- One place, ten years: a hint, not proof.
- Consecutive evenings are not independent, so the confidence intervals are probably narrower than they should be.
- The proxies only approximate the sayings.
- Lore Lab does not prove a saying true and does not forecast better than meteorologists.
- Field samples are tiny, and the app says so.

## Roadmap

- [ ] Season-adjusted check (the monsoon question)
- [ ] Comparison against a second Gemma size
- [ ] Dolbear's-law (cricket chirp) test
- [ ] Photos with a look
- [ ] Offline mode
- [ ] Daily look card

Contributions are welcome, especially new sayings in other languages. Open an issue or a pull request.

## Credits

- Weather data: [Open-Meteo](https://open-meteo.com)
- Model: [Gemma](https://ai.google.dev/gemma), run with [Ollama](https://ollama.com)
- Hosting: [Render](https://render.com)
- Demo narration: ElevenLabs text-to-speech
- Artwork: collected from Pinterest. The original artists are unknown, and no rights are claimed. If you made any of it and want credit or removal, please open an issue.

## License

The code is released under the MIT License. The license does not cover the artwork above.

*Built by Samiksha Tripathy · [@Sam02i](https://github.com/Sam02i)*