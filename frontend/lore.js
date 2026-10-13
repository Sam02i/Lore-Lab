/* =========================================================
   Lore Lab · Experiment Engine, System Architecture, Field Report
   Vanilla JS. Loaded after script.js. Touches only #engine, #architecture
   and the closing pages (everything is scoped to .lore sections).

   NOTHING in here fabricates data. All results come from the backend through
   the adapter in section 1. If an endpoint isn't configured, the UI says so.
   See INTEGRATION.md for the exact contract this file expects.
   ========================================================= */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const pct = (x) => `${Math.round(x * 100)}%`;
  const ac = new AbortController(); // one switch to remove every listener added with {signal}
  const on = (el, ev, fn, opt = {}) => el && el.addEventListener(ev, fn, { ...opt, signal: ac.signal });
  window.addEventListener("pagehide", () => ac.abort(), { once: true });

  /* ---------------------------------------------------------
     1. API ADAPTER  (the ONLY place that knows about the backend)
     Set window.LORE_CONFIG before this script loads, e.g.
       window.LORE_CONFIG = { apiBase: "https://…", endpoints: { extractHypothesis: { method:"POST", path:"/…" }, … } }
     Unset endpoints stay null: the UI then shows an honest "not connected" state.
     --------------------------------------------------------- */
  const CONFIG = (window.LORE_CONFIG = Object.assign(
    { apiBase: null, endpoints: {} },
    window.LORE_CONFIG || {}
  ));
  const ENDPOINTS = [
    "proverbs", "extractHypothesis", "confirmHypothesis", "runBacktest", "startFieldTest",
    "submitObservation", "resolvePending", "listObservations", "scorecards", "stats", "exampleResult",
  ];
  ENDPOINTS.forEach((k) => { if (!(k in CONFIG.endpoints)) CONFIG.endpoints[k] = null; });

  class NotConfigured extends Error { constructor(name) { super(`Endpoint "${name}" is not configured`); this.name = "NotConfigured"; this.endpoint = name; } }
  class TimeoutErr extends Error { constructor(ms) { super(`No answer after ${Math.round(ms / 1000)}s`); this.name = "TimeoutErr"; } }
  class ApiError extends Error { constructor(status, detail) { super(detail || `HTTP ${status}`); this.name = "ApiError"; this.status = status; } }
  const isConfigured = (name) => CONFIG.apiBase !== null && !!CONFIG.endpoints[name];

  const API_TIMEOUT_MS = 45000; // each call; raise if your backend is slow
  async function api(name, payload, params) {
    const ep = CONFIG.endpoints[name];
    if (CONFIG.apiBase === null || !ep) throw new NotConfigured(name);
    const method = (ep.method || "POST").toUpperCase();
    const path = ep.path.replace(/:(\w+)/g, (_, k) => encodeURIComponent((params || {})[k] ?? ""));
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), API_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(String(CONFIG.apiBase).replace(/\/$/, "") + path, {
      signal: ctl.signal,
      method,
      headers: { Accept: "application/json", ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
      body: method === "GET" ? undefined : JSON.stringify(payload ?? {}),
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw new TimeoutErr(API_TIMEOUT_MS);
      throw e;
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      let detail = "";
      try { const j = await res.json(); detail = typeof j.detail === "string" ? j.detail : j.message || ""; } catch (_) { /* no body */ }
      throw new ApiError(res.status, detail);
    }
    return res.status === 204 ? {} : res.json();
  }

  /* Normalisers: tolerant readers that map the backend's response onto what the UI shows.
     Adjust field names HERE if your schema differs. Missing values stay null (never invented). */
  function normHyp(r) {
    const h = (r && (r.hypothesis || r)) || {};
    const sign = h.sign || {}, pred = h.prediction || {}, proxy = h.proxy || null;
    const bt = typeof h.backtestable === "boolean" ? h.backtestable : typeof r?.backtestable === "boolean" ? r.backtestable : null;
    const mode = h.test_mode || r?.test_mode || (bt === true ? "lab" : bt === false ? "field" : null);
    return {
      id: r?.id ?? r?.hypothesis_id ?? h.id ?? null,
      original: h.original_text ?? h.proverb ?? "",
      source: h.source ?? null,
      language: h.language ?? null,
      translation: h.translation_en ?? h.translation ?? null,
      sign: { kind: sign.kind ?? null, text: sign.observable ?? sign.description ?? "", how: sign.how_to_observe ?? "", when: sign.when_observable ?? sign.when ?? "" },
      prediction: { outcome: pred.outcome ?? h.outcome ?? "", windowHours: num(pred.window_hours ?? h.window_hours) },
      proxy: proxy ? { variable: proxy.variable ?? null, feature: proxy.feature ?? null, fit: proxy.fit ?? null, rationale: proxy.rationale ?? null, unit: proxy.unit ?? "" } : null,
      ambiguities: (h.ambiguities || []).map((a) => (typeof a === "string" ? { text: a, options: null } : { text: a.question ?? a.text ?? "", options: a.options || null })),
      thresholdSuggestion: h.threshold_suggestion ?? null,
      backtestable: bt, testMode: mode,
    };
  }
  function normConfirm(r) {
    const bt = typeof r?.backtestable === "boolean" ? r.backtestable : null;
    const mode = r?.test_mode || (bt === true ? "lab" : bt === false ? "field" : null);
    return { id: r?.id ?? r?.hypothesis_id ?? null, testMode: mode === "lab" || mode === "field" ? mode : null, observeWhen: r?.observe_when ?? null };
  }
  const VERDICTS = { "on the trail": "trail", on_the_trail: "trail", trail: "trail", promising: "promising", "same as chance": "chance", same_as_chance: "chance", chance: "chance", backfires: "backfires" };
  function normCard(r) {
    const c = (r && (r.scorecard || r)) || {};
    return {
      mode: c.mode ?? c.test_mode ?? null, proverb: c.proverb ?? c.original_text ?? "", source: c.source ?? null, place: c.location_label ?? null,
      looks: num(c.looks_total ?? c.n_looks), n: num(c.n_sign_present ?? c.n), pending: num(c.n_pending), hits: num(c.hits ?? c.n_hits),
      baseRate: num(c.base_rate), hitRate: num(c.hit_rate), lo: num(c.ci_low), hi: num(c.ci_high), lift: num(c.lift),
      verdict: VERDICTS[String(c.verdict || "").toLowerCase()] || null, next: c.next_action ?? null, min: num(c.min_n),
      window: num(c.window_hours), rainMm: num(c.rain_mm), lookHour: num(c.look_hour),
      notes: Array.isArray(c.notes) ? c.notes.map(String) : [], failed: num(c.n_failed), notSeen: num(c.n_not_seen), expId: c.experiment_id ?? null,
    };
  }
  function normField(r, hyp, loc) {
    return {
      id: r?.experiment_id ?? r?.id ?? null, proverb: hyp?.original || "", sign: hyp?.sign.text || "", how: hyp?.sign.how || "",
      when: r?.observe_when ?? hyp?.sign.when ?? "", place: loc?.label || r?.location_label || "",
      outcome: hyp?.prediction.outcome || "", windowHours: hyp?.prediction.windowHours ?? null,
    };
  }

  /* ---------------------------------------------------------
     2. SHARED UI HELPERS
     --------------------------------------------------------- */
  function describeError(err) {
    if (err instanceof NotConfigured) return { title: "The lab isn’t connected yet", msg: "This page has no backend address for that action, so nothing was sent and nothing was invented. Configure LORE_CONFIG (see INTEGRATION.md)." };
    if (err instanceof TimeoutErr) return { title: "That took too long", msg: "The lab didn’t answer in time. Nothing was lost. Try again, it often works the second time." };
    if (err instanceof ApiError) return { title: `The lab said no (${err.status})`, msg: err.message && !/^HTTP/.test(err.message) ? err.message : "The server rejected that request. Check the details and try again." };
    return { title: "Couldn’t reach the lab", msg: "The request didn’t go through. Check your connection and try again." };
  }
  const alertBox = $("#lore-alert");
  function showAlert(err, kind) {
    if (!alertBox) return;
    const d = typeof err === "string" ? { title: "Hold on", msg: err } : describeError(err);
    alertBox.classList.toggle("lore-alert--info", kind === "info");
    alertBox.innerHTML = `<strong>${esc(d.title)}</strong>${esc(d.msg)}`;
    alertBox.hidden = false;
  }
  const clearAlert = () => { if (alertBox) alertBox.hidden = true; };
  function busy(btn, on_) { if (!btn) return; btn.disabled = on_; btn.classList.toggle("is-busy", on_); btn.setAttribute("aria-busy", String(on_)); }

  // scroll reveals
  (function reveals() {
    const els = $$(".lore-in");
    els.forEach((el, i) => el.style.setProperty("--d", `${(i % 3) * 0.1}s`));
    if (!("IntersectionObserver" in window)) return els.forEach((e) => e.classList.add("is-in"));
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }), { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
    on(window, "pagehide", () => io.disconnect());
  })();

  /* ---------------------------------------------------------
     3. SCORECARD (notebook page) · statistical rules live here
     --------------------------------------------------------- */
  const MIN_N = { lab: 30, field: 10 }; // MIN_N_BACKTEST / MIN_N_LIVE, as published in the page's "Pre-set constants"
  const VERDICT_TEXT = {
    trail: { label: "On the trail", plain: "Evidence is still accumulating. Nothing to conclude yet: this page is waiting for more looks." },
    promising: { label: "Promising", plain: "When the sign showed up, the predicted weather followed more often than it does anyway. The interval sits clearly above the bar to beat." },
    chance: { label: "Same as chance", plain: "The saying did about as well as ordinary chance. That’s a real finding." },
    backfires: { label: "Backfires", plain: "When the sign showed up, the predicted weather followed less often than it does anyway. The interval sits clearly below the bar to beat." },
  };
  const GLYPH = {
    trail: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="5" cy="17" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="7" r="2" opacity=".35"/></g></svg>',
    promising: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17 12 6l7 11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chance: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14M5 15h14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    backfires: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7l7 11 7-11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  function tallySVG(count, total) {
    const groups = Math.ceil(total / 5); let out = "";
    for (let g = 0; g < groups; g++) {
      let s = "";
      for (let i = 0; i < 5; i++) {
        const idx = g * 5 + i; if (idx >= total) break;
        const cls = idx < count ? "lore-tally-ink" : "lore-tally-ghost";
        s += i < 4 ? `<line class="${cls}" x1="${5 + i * 7}" y1="4" x2="${5 + i * 7}" y2="28"/>` : `<line class="${cls}" x1="1" y1="23" x2="33" y2="9"/>`;
      }
      out += `<svg viewBox="0 0 36 32" aria-hidden="true">${s}</svg>`;
    }
    return `<div class="lore-tallywrap">${out}</div>`;
  }
  function verdictBadge(v) { return `<span class="lore-verdict" data-v="${v}">${GLYPH[v]}<span>${VERDICT_TEXT[v].label}</span></span>`; }

  // the single source of the "enough looks?" and verdict rules
  function scoreOf(c, mode) {
    const min = c.min ?? (mode ? MIN_N[mode] : null), n = c.n ?? 0;
    const enough = min !== null && c.n !== null && n >= min;
    let verdict = null;
    if (!enough) verdict = "trail"; // below the minimum the only honest label is "On the trail"
    else if (c.verdict) verdict = c.verdict;
    else if (c.lo !== null && c.hi !== null && c.baseRate !== null) verdict = c.lo > c.baseRate ? "promising" : c.hi < c.baseRate ? "backfires" : "chance";
    return { min, n, enough, verdict };
  }
  function enoughBlock(c, n, unit) {
    let body = `<div class="lore-nums">
        <div><b>${c.hitRate !== null ? pct(c.hitRate) : "–"}</b><small>hit rate · ${c.hits !== null ? `${c.hits} of ${n}` : `n = ${n}`} ${unit}</small></div>
        <div><b>${c.baseRate !== null ? pct(c.baseRate) : "–"}</b><small>bar to beat</small></div>
        ${c.lift !== null ? `<div><b>×${c.lift.toFixed(2)}</b><small>lift</small></div>` : ""}</div>`;
    if (c.lo !== null && c.hi !== null) {
      body += `<div class="lore-bar" role="img" aria-label="Interval ${pct(c.lo)} to ${pct(c.hi)}${c.baseRate !== null ? `, bar to beat ${pct(c.baseRate)}` : ""}">
          <span class="ci" style="left:${c.lo * 100}%;width:${Math.max((c.hi - c.lo) * 100, 1)}%"></span>${c.baseRate !== null ? `<span class="base" style="left:${c.baseRate * 100}%"></span>` : ""}</div>
          <p class="lore-pend">Interval ${pct(c.lo)}–${pct(c.hi)} · n = ${n} · coral line = bar to beat</p>`;
    }
    return body;
  }
  function cardHTML(c) {
    const mode = c.mode === "lab" || c.mode === "field" ? c.mode : null;
    const unit = mode === "lab" ? "days" : "looks";
    const { min, n, enough, verdict } = scoreOf(c, mode);
    const empty = !enough && n === 0 && !(c.looks > 0);
    let body = "";
    if (!enough) {
      const need = min !== null ? Math.max(min - n, 0) : null;
      body += min !== null ? tallySVG(n, min) : "";
      body += empty
        ? `<p>A blank page, waiting for its first ${mode === "lab" ? "sign-present day" : "look"}.</p>`
        : `<p><b>${n}</b> ${mode === "lab" ? "sign-present days" : "sign-present looks"} so far${c.hits !== null ? `, and the predicted weather followed <b>${c.hits}</b> of them` : ""}.</p>`;
      if (c.pending) body += `<p class="lore-pend">${c.pending} still pending: logged, and waiting for the sky data.</p>`;
      if (need !== null) body += `<p class="lore-next">${need} more ${unit} with the sign before a hit rate or verdict can be shown.</p>`;
      if (c.baseRate !== null) body += `<div class="lore-nums"><div><b>${pct(c.baseRate)}</b><small>bar to beat (how often it happens anyway)</small></div></div>`;
    } else {
      body += enoughBlock(c, n, unit);
    }
    // the exact rule behind "rain followed", so every Lab result states its own window
    const rule = mode === "lab" && c.window
      ? `<p class="lore-pend">Counted as rain followed when ${c.rainMm !== null ? `at least ${c.rainMm} mm` : "rain"} fell in the ${c.window} hours after a look at ${c.lookHour !== null ? `${String(c.lookHour).padStart(2, "0")}:00` : "dusk"}.</p>`
      : "";
    const plain = verdict ? VERDICT_TEXT[verdict].plain : "The scoring service didn’t return a verdict for this card.";
    const next = c.next ?? (!enough
      ? (mode === "field" ? "Next: take another look at the next recommended time." : mode === "lab" ? "Next: a place or period with more days showing the sign." : "")
      : "");
    const where = mode === "lab" ? "Modelled reanalysis from Open-Meteo, not weather-station readings." : mode === "field" ? "Looks recorded by people; outcomes checked against hourly weather for the window." : "";
    return `<article class="lore-card${empty ? " lore-card--empty" : ""}" data-mode="${mode || ""}">
      <header><div><h4>${esc(c.proverb || "Untitled saying")}</h4><div class="lore-src">${[c.source ? `Said by: ${esc(c.source)}` : "", c.place ? esc(c.place) : ""].filter(Boolean).join(" · ")}</div></div>
      ${mode ? `<span class="lore-modetag lore-modetag--${mode}">${mode === "lab" ? "Lab Test" : "Field Test"}</span>` : ""}</header>
      ${verdict ? verdictBadge(verdict) : ""}
      ${body}
      ${rule}
      ${(c.notes || []).map((t) => `<p class="lore-pend">${esc(t)}</p>`).join("")}
      <p>${esc(plain)}</p>
      ${next ? `<p class="lore-next">${esc(next)}</p>` : ""}
      <p class="lore-caveat">One place and a short history is a hint, not proof.${where ? " " + esc(where) : ""}</p></article>`;
  }

  /* ---------------------------------------------------------
     3a. PROGRESSIVE EXPLAINING
     Nothing is required reading. Terms are tap-to-define at the moment they appear,
     and each step carries a collapsed "why" that explains the method only when it matters.
     --------------------------------------------------------- */
  const GLOSS = {
    bar: "The bar to beat is how often the predicted weather happens on any ordinary day anyway. A saying only counts as working if it does clearly better than that.",
    range: "With only this many days, the true hit rate could sit a bit higher or lower than what we measured. This is where it probably is. A narrower range means a firmer result.",
    days: "Days when the sign was actually there. Days without it aren’t counted, because the saying says nothing about them.",
  };
  const LEARN = {
    confirm: ["Why confirm before testing?", "Once you’ve seen a result, it’s tempting to tweak the question until it flatters the saying. So we agree exactly what counts first: the sign, the prediction and the number. Then the test is fair."],
    who: ["Who decided this?", "Gemma, an AI model, read the saying and suggested this test. Plain code decides whether it can be checked against past weather (from a fixed list, not a guess) and does all the maths. You choose every number."],
    number: ["Why do I choose this number?", "“The sign is there” needs a cut-off, like how humid counts as muggy. You set it before you see any result. If it were set afterwards, a number could always be found that makes the saying look good."],
    place: ["Why one place?", "Weather is local. We use the exact spot you pick, so the answer is about where you actually live."],
  };
  const term = (k, label) => `<button type="button" class="lore-term" data-term="${k}" aria-expanded="false">${label}</button>`;
  const LEARN_LINK = { confirm: "#protocol", who: "#protocol" }; // where the How it works page tells the longer story
  const learnHTML = (k) => `<details class="lore-learn"><summary>${LEARN[k][0]}</summary><p>${LEARN[k][1]}</p>${LEARN_LINK[k] ? `<a class="lore-learn__more" href="how-it-works.html${LEARN_LINK[k]}">More on the How it works page</a>` : ""}</details>`;
  // tap a term to open its definition just below the sentence it sits in; tap again to close
  on(document, "click", (e) => {
    const t = e.target.closest(".lore-term"); if (!t) return;
    const block = t.closest("p, li, dd, .dv-row") || t.parentElement, open = t.getAttribute("aria-expanded") === "true";
    const next = block.nextElementSibling;
    if (next && next.classList.contains("lore-def") && next.dataset.for === t.dataset.term) next.remove();
    if (open) { t.setAttribute("aria-expanded", "false"); return; }
    $$(".lore-term[aria-expanded=\"true\"]").forEach((x) => x.setAttribute("aria-expanded", "false")); // one open definition at a time, anywhere on the page
    $$(".lore-def").forEach((x) => x.remove());
    const d = document.createElement("p"); d.className = "lore-def"; d.setAttribute("role", "note"); d.dataset.for = t.dataset.term; d.textContent = GLOSS[t.dataset.term] || "";
    block.after(d); t.setAttribute("aria-expanded", "true");
  });

  /* ---------------------------------------------------------
     3b. THE DISCOVERY: one result story used by Lab results, quick-run and the field report.
     Hero (the verdict), then four beats: what was tested, what the evidence showed,
     how reliable it is, what to try next. Every line is built from the card or the
     hypothesis; a row with no data is left out rather than guessed.
     --------------------------------------------------------- */
  const VERDICT_HEAD = { trail: "Still on the trail.", promising: "Promising. It beat chance.", chance: "Same as chance. That’s a real finding.", backfires: "Backwards. It did worse than chance." };
  // Lore Lab's own rule of thumb for "how much to trust this", shown to the reader next to the label.
  const REL_RULE = "Firm = at least 3× the minimum sample and a range no wider than 20 points. Fair = range up to 35 points. Rough = wider than that. This label is a rule of thumb; the range itself is the statistic.";
  function reliabilityOf(c, sc, word) {
    if (!sc.enough) return { level: 0, label: "Too early", why: `Only ${sc.n} of the ${sc.min} ${word} needed so far, so there is nothing to rate yet.` };
    if (c.lo === null || c.hi === null) return { level: 0, label: "Can’t rate", why: "The scoring service didn’t return a range, so reliability can’t be rated." };
    const w = c.hi - c.lo, pts = Math.round(w * 100);
    if (sc.n >= 3 * sc.min && w <= 0.2) return { level: 3, label: "Firm", why: `${sc.n} ${word} and a range only ${pts} points wide.` };
    if (w <= 0.35) return { level: 2, label: "Fair", why: `${sc.n} ${word}, with a range ${pts} points wide. More ${word} would narrow it.` };
    return { level: 1, label: "Rough", why: `${sc.n} ${word} leaves a range ${pts} points wide. Treat it as a first look.` };
  }
  function nextSteps(v, mode) {
    if (mode === "field") return [{ title: "Keep looking", why: "More sightings make the result firmer, and a verdict can change as they come in.", btn: "Log another look", act: "keep" }];
    const place = { title: "See if it travels", why: "If the saying is real, it should hold in other places too.", btn: "Try another place", go: 3, hint: "Pick another city under the result." };
    const fair = " Pick the new number before you see its result, so the test stays fair.";
    if (v === "promising") return [place, { title: "Raise the bar", why: "Does it still work when the sign is stronger?" + fair, btn: "Try a stricter number", go: 2, hint: "Use “Choose your own number” under the result." }];
    if (v === "chance") return [{ title: "Try a different sign strength", why: "Maybe the saying means a stronger or weaker sign." + fair, btn: "Change my number", go: 2, hint: "Use “Choose your own number” under the result." }, { ...place, title: "Check another place", why: "One location can be unlucky for a saying." }];
    if (v === "backfires") return [{ ...place, title: "Check another place", why: "A result this far below chance deserves a second place before you trust it." }, { title: "Re-read the details", why: "Worth checking that the sign was measured the way the saying means it.", btn: "Review the details", go: 2, hint: "Use “Choose your own number” under the result." }];
    return [{ ...place, title: "Find more days with the sign", why: "A place or number that shows the sign more often gives the test more to work with." }, { title: "Change the number", why: "A lower bar for “the sign is there” gives more days to count." + fair, btn: "Change my number", go: 2, hint: "Use “Choose your own number” under the result." }];
  }
  function discoveryHTML(c, ctx = {}) {
    const mode = c.mode === "lab" || c.mode === "field" ? c.mode : null, lab = mode === "lab";
    const sc = scoreOf(c, mode), v = sc.verdict, h = ctx.h || null, f = ctx.f || null;
    const word = lab ? "sign-present days" : "sightings", unit = lab ? "days" : "looks";
    const outcome = String(h?.prediction.outcome || f?.outcome || "").trim(), outPhrase = outcome ? `“${esc(outcome)}”` : "the predicted weather";
    const place = c.place || f?.place || "", saying = c.proverb || h?.original || f?.proverb || "";
    const win = c.window ?? h?.prediction.windowHours ?? f?.windowHours ?? null;

    let take;
    if (sc.enough && c.hitRate !== null) take = `When the sign showed up, ${outPhrase} followed <b>${pct(c.hitRate)}</b> of the time${c.hits !== null ? ` (${c.hits} of ${sc.n} ${lab ? term("days", word) : word})` : ""}.${c.baseRate !== null ? ` It happens about <b>${pct(c.baseRate)}</b> of the time anyway.` : ""}`;
    else if (!sc.enough) take = `Only <b>${sc.n}</b> of the <b>${sc.min}</b> ${word} needed so far. That’s too few to say anything yet.`;
    else take = "The numbers are in, but the scoring service didn’t return a hit rate.";

    const hero = `<header class="dv-hero" data-v="${v || ""}">
      <p class="dv-kick">${lab ? "Lab test" : mode === "field" ? "Field report" : "Result"}${place ? ` · ${esc(place)}` : ""}${lab ? " · about ten years of weather" : ""}</p>
      <p class="dv-q">“${esc(saying)}”${c.source ? ` <small>Said by ${esc(c.source)}</small>` : ""}</p>
      ${v ? verdictBadge(v) : ""}
      <h4 class="dv-head">${esc(v ? VERDICT_HEAD[v] : "Your numbers are in.")}</h4>
      <p class="dv-take">${take}</p></header>`;

    // 1 · what was tested
    const rows = [];
    const sign = h?.sign.text || f?.sign;
    if (sign) {
      let m = "";
      if (lab && h?.proxy && ctx.th && Number.isFinite(Number(ctx.th.value))) {
        const ph = checkPhrase(h, String(ctx.th.value));
        if (ph) m = `<small>Measured as ${esc(ph)} (${ctx.th.preset ? "a quick-run preset" : "the number you chose"}${h.proxy.fit === "rough" ? ", a rough match" : ""}).</small>`;
      }
      rows.push(["The sign", `${esc(sign)}${m}`]);
    }
    if (!lab && (f?.how || h?.sign.how)) rows.push(["How to look", esc(f?.how || h.sign.how)]);
    if (outcome || win) rows.push(["The prediction", `${esc(outcome || "The predicted weather")}${win ? ` within ${win} hours` : ""}`]);
    const ev = ctx.evidence;
    if (place || lab || ev) rows.push(["Where and when", [place ? esc(place) : "", lab ? "about ten years of past weather" : "", ev?.days ? `${plural(ev.days, "day", "days")} of looking${ev.when ? ` (${esc(ev.when)})` : ""}` : ""].filter(Boolean).join(" · ")]);
    rows.push(["How it was scored", lab
      ? (c.window ? `Counted as rain followed when ${c.rainMm !== null ? `at least ${c.rainMm} mm` : "rain"} fell in the ${c.window} hours after a look at ${c.lookHour !== null ? `${String(c.lookHour).padStart(2, "0")}:00` : "dusk"}.` : "Checked against past weather at your spot.")
      : "Each sighting is checked against the hourly weather for its window."]);
    const tested = `<dl class="dv-dl">${rows.map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join("")}</dl>`;

    // 2 · what the evidence showed
    let evidence;
    if (sc.enough && c.hitRate !== null) {
      evidence = `<div class="dv-cmp">
          <div class="dv-row"><span>When the sign showed up</span><div class="dv-track"><i class="dv-fill dv-fill--hit" style="width:${Math.max(c.hitRate * 100, 1)}%"></i></div><b>${pct(c.hitRate)}</b></div>
          ${c.baseRate !== null ? `<div class="dv-row"><span>On any day, anyway (${term("bar", "the bar to beat")})</span><div class="dv-track"><i class="dv-fill dv-fill--base" style="width:${Math.max(c.baseRate * 100, 1)}%"></i></div><b>${pct(c.baseRate)}</b></div>` : ""}</div>
        ${c.lift !== null ? `<p class="dv-lift"><b>×${c.lift.toFixed(2)}</b> lift: how many times as often as chance it came true.</p>` : ""}
        ${ev ? `<p>You saw <b>${esc(sign || "the sign")}</b> <b>${plural(sc.n, "time", "times")}</b>${ev.days ? ` over <b>${plural(ev.days, "day", "days")}</b>` : ""}${ev.notSeen ? `, and logged <b>${plural(ev.notSeen, "look", "looks")}</b> where nothing showed` : ""}.</p>` : ""}`;
    } else {
      evidence = `${sc.min !== null ? tallySVG(sc.n, sc.min) : ""}${c.pending ? `<p class="lore-pend">${c.pending} still pending: logged, and waiting for the sky data.</p>` : ""}${c.baseRate !== null ? `<p class="dv-lift"><b>${pct(c.baseRate)}</b> is the bar to beat: how often it happens anyway.</p>` : ""}`;
    }
    evidence += `<p class="dv-plain">${esc(v ? VERDICT_TEXT[v].plain : "The scoring service didn’t return a verdict for this card.")}</p>`;

    // 3 · how reliable
    const rel = reliabilityOf(c, sc, word);
    let margin = "";
    if (sc.enough && c.lo !== null && c.hi !== null && c.baseRate !== null) margin = c.lo > c.baseRate ? "The whole range sits above the bar to beat." : c.hi < c.baseRate ? "The whole range sits below the bar to beat." : "The range straddles the bar to beat, so luck can’t be ruled out.";
    const reliable = `<div class="dv-rel" data-l="${rel.level}"><span class="dv-pips" aria-hidden="true"><i></i><i></i><i></i></span><b>${rel.label}</b></div>
      <p>${esc(rel.why)}</p>
      ${sc.enough && c.lo !== null && c.hi !== null ? `<div class="lore-bar" role="img" aria-label="Likely range ${pct(c.lo)} to ${pct(c.hi)}${c.baseRate !== null ? `, bar to beat ${pct(c.baseRate)}` : ""}"><span class="ci" style="left:${c.lo * 100}%;width:${Math.max((c.hi - c.lo) * 100, 1)}%"></span>${c.baseRate !== null ? `<span class="base" style="left:${c.baseRate * 100}%"></span>` : ""}</div>
        <p class="lore-pend">${term("range", "Likely range")} for the true hit rate: ${pct(c.lo)}–${pct(c.hi)} · coral line = ${term("bar", "bar to beat")}. ${esc(margin)}</p>` : ""}
      <p class="dv-limits">${lab ? "One place and about ten years of modelled weather (Open-Meteo reanalysis, not weather-station readings). A hint, not proof." : "One place and a short history is a hint, not proof. Looks recorded by people; outcomes checked against hourly weather for the window."}</p>
      ${(c.notes || []).map((t) => `<p class="lore-pend">${esc(t)}</p>`).join("")}
      <details class="dv-ruled"><summary>How is “${rel.label}” decided?</summary><p>${esc(REL_RULE)}</p></details>`;

    // 4 · what to try next
    const steps = nextSteps(v, mode), acts = ctx.actions !== false;
    const next = `${c.next ? `<p class="dv-srvnext">${esc(c.next)}</p>` : ""}<ul class="dv-next">${steps.map((s) => `<li><b>${esc(s.title)}</b><span>${esc(s.why)}${!acts && s.hint ? " " + esc(s.hint) : ""}</span>${acts ? `<button class="lore-btn lore-btn--butter" type="button" ${s.go ? `data-go="${s.go}"` : `data-act="${s.act}"`}>${esc(s.btn)}</button>` : ""}</li>`).join("")}</ul>`;

    const sec = (n, t, body, d) => `<section class="dv-sec" style="--d:${d}s" aria-labelledby="dv-h${n}"><h5 id="dv-h${n}"><i>${n}</i>${t}</h5>${body}</section>`;
    return `<article class="dv" data-v="${v || ""}">${hero}${sec(1, "What we tested", tested, 0.55)}${sec(2, "What the evidence showed", evidence, 0.8)}${sec(3, "How reliable is this?", reliable, 1.05)}${sec(4, "What to try next", next, 1.3)}</article>`;
  }

  /* ---------------------------------------------------------
     4. EXPERIMENT ENGINE
     --------------------------------------------------------- */
  const S = (window.LoreLab = { config: CONFIG, hyp: null, mode: null, field: null, location: null });
  const eng = { step: 1, max: 1, busy: false, hyp: null, confirmed: null, locked: [] }; // locked: tabs with nothing to show (a resumed field test has no steps 2-3)
  const panes = [1, 2, 3, 4].map((n) => $(`#lore-p${n}`));
  const tabs = [1, 2, 3, 4].map((n) => $(`#lore-tab-${n}`));
  const STEP_NAMES = ["Saying", "Hypothesis", "Test", "Result"];

  function go(n, focus = true) {
    eng.step = n; eng.max = Math.max(eng.max, n);
    if (n === 2 || n === 3) eng.locked = [];
    panes.forEach((p, i) => { p.hidden = i + 1 !== n; });
    tabs.forEach((t, i) => {
      t.disabled = i + 1 > eng.max || eng.locked.includes(i + 1);
      t.classList.toggle("is-active", i + 1 === n);
      t.classList.toggle("is-done", i + 1 < eng.max && i + 1 !== n && !eng.locked.includes(i + 1));
      t.setAttribute("aria-selected", String(i + 1 === n));
      t.tabIndex = i + 1 === n ? 0 : -1;
    });
    clearAlert();
    if (focus) { const h = panes[n - 1].querySelector("h3"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
    if (focus) keepEngineInView();
  }
  // after a step change the pane height changes and the page can end up scrolled far below the engine;
  // bring the top of the engine panel back into view (only if it has scrolled out of a comfortable spot)
  function keepEngineInView() {
    const sec = document.getElementById("engine"); if (!sec) return;
    requestAnimationFrame(() => {
      const top = sec.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.4) sec.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }
  tabs.forEach((t) => on(t, "click", () => go(Number(t.dataset.go))));

  // connection status: honest about being "configured", not "verified"
  (function status() {
    const el = $("#lore-conn"), tx = $("#lore-conn-text");
    const ok = CONFIG.apiBase !== null && ENDPOINTS.some((k) => CONFIG.endpoints[k]);
    el.classList.toggle("is-ok", ok);
    tx.textContent = ok ? "Backend address configured." : "Not connected: no backend address is set, so nothing can be sent yet.";
  })();

  /* Step 1 */
  const form = $("#lore-form");
  on($$(".lore-chip", form)[0]?.parentElement, "click", (e) => { const b = e.target.closest("[data-source]"); if (b) $("#lore-source").value = b.dataset.source; });
  on(form, "submit", async (e) => {
    e.preventDefault();
    if (eng.busy) return;
    const text = $("#lore-text").value.trim();
    if (!text) { showAlert("Write the saying first. A few words is enough.", "info"); $("#lore-text").focus(); return; }
    const btn = $("#lore-extract"); eng.busy = true; busy(btn, true); clearAlert();
    try {
      const r = await api("extractHypothesis", { text, source: $("#lore-source").value.trim() || null, language: $("#lore-lang").value.trim() || null });
      const h = normHyp(r);
      if (!h.sign.text && !h.original) throw new ApiError(502, "The hypothesis service returned something unreadable.");
      if (!h.original) h.original = text;
      eng.hyp = S.hyp = h; renderHyp(h); eng.max = 2; go(2);
    } catch (err) { showAlert(err); }
    finally { eng.busy = false; busy(btn, false); if (eng.valid) eng.valid(); }
  });

  // optional corpus (only if the backend provides one; nothing is hard-coded)
  (async function corpus() {
    if (!isConfigured("proverbs")) return;
    try {
      const r = await api("proverbs");
      const list = Array.isArray(r) ? r : r.proverbs || [];
      if (!list.length) return;
      const sel = $("#lore-starter");
      list.forEach((p) => { const o = document.createElement("option"); o.value = p.text ?? p.original_text ?? ""; o.dataset.source = p.source ?? ""; o.dataset.lang = p.language ?? ""; o.textContent = o.value; sel.appendChild(o); });
      $("#lore-starters").hidden = false;
      on(sel, "change", () => { const o = sel.selectedOptions[0]; if (!o.value) return; $("#lore-text").value = o.value; $("#lore-source").value = o.dataset.source || ""; $("#lore-lang").value = o.dataset.lang || ""; });
    } catch (_) { /* corpus is optional */ }
  })();

  /* Plain-language guide for the number the user has to choose */
  const VAR_NAME = { pressure_msl: "air pressure", cloud_cover_high: "high cloud", relative_humidity_2m: "humidity", wind_direction_10m: "wind direction" };
  const friendlyVar = (v) => VAR_NAME[v] || (v ? String(v).replace(/_/g, " ") : "");
  function thresholdGuide(p) {
    const v = p?.variable, f = p?.feature;
    if (v === "pressure_msl" && f === "level")
      return { q: "How low must the air pressure be?", unit: "hPa", ph: "e.g. 1000", chips: [],
        help: "A barometer (“the glass”) measures air pressure. A normal day is around 1013 hPa. Type the pressure it must be at or below for the sign to count." };
    if (v === "pressure_msl")
      return { q: "How big a pressure drop counts as a “falling glass”?", unit: "hPa", ph: "e.g. 2", chips: [["Small", 1], ["Medium", 2], ["Sharp", 3]],
        help: "A barometer (“the glass”) measures air pressure. Type how many hPa it must fall in a few hours. Use a plain positive number: 1 is a small drop, 3 or more is a sharp one." };
    if (v === "cloud_cover_high")
      return { q: "How much of the sky must be covered by high cloud?", unit: "%", ph: "e.g. 50", chips: [["A little", 30], ["Half the sky", 50], ["Most of it", 80]],
        help: "High cloud is the thin, wispy kind far above you. 0% is a clear sky and 100% means it covers all of it. Type the percentage it must reach." };
    if (v === "relative_humidity_2m")
      return { q: "How humid must the air be?", unit: "%", ph: "e.g. 80", chips: [["Muggy", 70], ["Very muggy", 80], ["Soaked", 90]],
        help: "100% means the air is holding all the water it can. Around 60% feels normal and above 80% feels muggy. Type the percentage it must reach." };
    if (v === "wind_direction_10m")
      return { q: "Which way must the wind blow from?", unit: "degrees", ph: "e.g. 270", chips: [["North", 0], ["East", 90], ["South", 180], ["West", 270]],
        help: "Compass bearings: north is 0, east is 90, south is 180, west is 270. The sign counts when the wind comes from within 45 degrees of your number." };
    return { q: `How high must ${friendlyVar(v) || "the value"} be?`, unit: p?.unit || "", ph: "Type a number", chips: [],
      help: "Type the number at which you would say “the sign is there”." };
  }
  function checkPhrase(h, th) {
    const v = h.proxy?.variable, f = h.proxy?.feature, g = thresholdGuide(h.proxy);
    if (!v || th === "" || !Number.isFinite(Number(th))) return null;
    const name = friendlyVar(v), u = g.unit === "%" ? "%" : g.unit ? " " + g.unit : "";
    if (v === "pressure_msl" && f === "level") return `${name} at or below ${th}${u}`;
    if (v === "pressure_msl") return `${name} falling by ${th}${u} or more`;
    if (v === "wind_direction_10m") return `wind from near ${th}°`;
    return `${name} over ${th}${u}`;
  }
  function thresholdHTML(h) {
    const g = thresholdGuide(h.proxy);
    return `<fieldset class="lore-fieldset"><legend>Your number</legend>
      <label for="lh-th">${esc(g.q)}</label>
      <div class="lore-thr"><input class="lore-field" id="lh-th" type="number" step="any" inputmode="decimal" required placeholder="${esc(g.ph)}"><span class="lore-thr__unit">${esc(g.unit)}</span></div>
      <input type="hidden" id="lh-unit" value="${esc(g.unit)}">
      <p class="lore-help">${esc(g.help)}</p>
      ${g.chips.length ? `<div class="lore-chips" aria-label="Quick picks">${g.chips.map(([t, n]) => `<button type="button" class="lore-chip" data-fill="${n}">${esc(t)} (${n})</button>`).join("")}</div>` : ""}
      <p class="lore-help"><b>You</b> choose this number, before you see any result.</p>${learnHTML("number")}</fieldset>`;
  }

  /* Step 1: example sayings (same ones as the hero) so there is never a blank box to stare at */
  (function examples() {
    const box = $("#lore-examples"), ta = $("#lore-text"); if (!box || !ta) return;
    const items = $$("[data-quick]").map((a) => [a.textContent.trim(), a.dataset.quick]).filter(([l, t]) => l && t);
    if (!items.length) return;
    box.innerHTML = `<span class="lore-examples__l">Not sure? Try one:</span>` + items.map(([l, t], i) => `<button type="button" class="lore-chip" data-example="${i}">${esc(l)}</button>`).join("") + `<span class="lore-examples__see">Want to watch one go start to finish first? <a href="how-it-works.html#run">See an example</a>.</span>`;
    box.hidden = false;
    on(box, "click", (e) => { const b = e.target.closest("[data-example]"); if (!b) return; ta.value = items[Number(b.dataset.example)][1]; ta.dispatchEvent(new Event("input", { bubbles: true })); ta.focus(); });
  })();

  /* Step 2: review + edit */
  on(panes[1], "input", () => eng.valid && eng.valid()); on(panes[1], "change", () => eng.valid && eng.valid());
  on(panes[1], "click", (e) => { const c = e.target.closest("[data-fill]"); if (!c) return; const t = $("#lh-th", panes[1]); if (!t) return; t.value = c.dataset.fill; t.dispatchEvent(new Event("input", { bubbles: true })); t.focus(); });
  function renderHyp(h) {
    const fit = h.proxy?.fit, rough = fit === "rough", hasProxy = !!h.proxy?.variable && fit && fit !== "none";
    const lab = h.testMode === "lab" || h.backtestable === true;
    const chips = [
      h.language && `<li>${esc(h.language)}</li>`,
      h.sign.kind && `<li>Sign: ${esc(h.sign.kind)}</li>`,
      hasProxy && `<li class="${rough ? "is-rough" : "is-good"}">${rough ? "Rough match" : "Good match"}: ${esc(h.proxy.variable)}</li>`,
      h.testMode && `<li>How we’ll test it: ${h.testMode === "lab" ? "past weather" : "look outside"}</li>`,
    ].filter(Boolean).join("");
    const amb = h.ambiguities.map((a, i) => `<div class="lore-ambig"><p>${esc(a.text)}</p>${a.options && a.options.length
      ? `<select class="lore-field" data-amb="${i}" aria-label="Settle: ${esc(a.text)}"><option value="">Choose…</option>${a.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`
      : `<input class="lore-field" data-amb="${i}" type="text" aria-label="Settle: ${esc(a.text)}" placeholder="Say what you mean">`}</div>`).join("");
    const g0 = lab ? thresholdGuide(h.proxy) : null;
    const preset = g0 && g0.chips.length ? g0.chips[Math.min(1, g0.chips.length - 1)][1] : null;
    const editOpen = lab && preset === null ? " open" : "";
    panes[1].innerHTML = `
      <h3>Does this say what you meant?</h3>
      <p class="lore-intro">First, we agree exactly what is being tested. Check this matches what they meant, and fix anything that is off. Nothing is tested until you say it looks right.</p>
      <blockquote class="lore-orig">${esc(h.original)}<small>${h.translation ? `In English: ${esc(h.translation)}` : ""}${h.source ? ` · Said by ${esc(h.source)}` : ""}</small></blockquote>
      ${h.testMode ? `<p class="lore-modeline">${h.testMode === "lab" ? "We can check this one against ten years of past weather." : "Weather instruments can’t see this sign, so you’ll check it by going outside and looking."}</p>` : ""}
      <p class="lore-sum" id="lh-sum" role="status"></p>
      ${preset !== null ? `<p class="lore-help">I picked a starting number. Open Edit details to change it.</p>` : ""}
      <details class="lore-edit"${editOpen}><summary>Edit details</summary>
      <div class="lore-grid2">
        <div><label for="lh-sign">The sign to look for</label><textarea class="lore-field" id="lh-sign" rows="3">${esc(h.sign.text)}</textarea></div>
        <div><label for="lh-how">How to check it</label><textarea class="lore-field" id="lh-how" rows="3">${esc(h.sign.how)}</textarea></div>
        <div><label for="lh-outcome">What the saying says will happen</label><input class="lore-field" id="lh-outcome" type="text" value="${esc(h.prediction.outcome)}"></div>
        <div><label for="lh-window">How many hours later do we check?</label><input class="lore-field" id="lh-window" type="number" min="1" step="1" inputmode="numeric" value="${h.prediction.windowHours ?? ""}"></div>
      </div>
      ${lab ? thresholdHTML(h) : ""}
      </details>
      ${rough ? `<fieldset class="lore-fieldset lore-fieldset--warn"><legend>Only a rough match</legend>
        <label class="lore-check"><input type="checkbox" id="lh-rough"><span>Weather data can only roughly measure this sign (a halo around the moon, for example, shows up as thin high cloud). Tick this if you are happy to test it that way.</span></label></fieldset>` : ""}
      ${h.ambiguities.length ? `<fieldset class="lore-fieldset"><legend>Say what you mean</legend><p class="lore-help">Gemma wasn’t sure what these words mean. Answer in your own words so the test is fair.</p>${amb}</fieldset>` : ""}
      ${h.proxy?.rationale ? `<details class="lore-why"><summary>Why this weather variable?</summary><p>${esc(h.proxy.rationale)}</p></details>` : ""}
      ${learnHTML("confirm")}${learnHTML("who")}
      <div class="lore-actions"><button class="lore-btn lore-btn--coral" id="lh-confirm" type="button" disabled>Looks right, continue</button>
        <button class="lore-btn lore-btn--ghost" type="button" data-go="1">Change the saying</button></div>`;
    const confirm = $("#lh-confirm", panes[1]);
    const valid = () => {
      const okAmb = $$("[data-amb]", panes[1]).every((x) => x.value.trim());
      const okRough = !rough || $("#lh-rough", panes[1]).checked;
      const okTh = !lab || ($("#lh-th", panes[1]).value !== "" && Number.isFinite(Number($("#lh-th", panes[1]).value)));
      const okSign = $("#lh-sign", panes[1]).value.trim() && $("#lh-how", panes[1]).value.trim();
      confirm.disabled = eng.busy || !(okAmb && okRough && okTh && okSign);
    };
    const sum = () => {
      const th = lab ? $("#lh-th", panes[1]).value : "";
      const ph = lab ? checkPhrase(h, th) : null;
      const sign = ($("#lh-sign", panes[1]).value || "").trim();
      const short = sign.length > 110 ? sign.slice(0, 107) + "…" : sign;
      $("#lh-sum", panes[1]).textContent = "We’ll check: " + (ph || short || "…") + (lab && !ph && h.proxy?.variable ? ". Pick a number under Edit details." : ".");
    };
    if (preset !== null) $("#lh-th", panes[1]).value = preset;
    eng.valid = () => { valid(); sum(); }; valid(); sum();
    on($('[data-go="1"]', panes[1]), "click", () => go(1));
    on(confirm, "click", async () => {
      if (eng.busy) return; eng.busy = true; busy(confirm, true); clearAlert();
      try {
        const q = (id) => $(id, panes[1]);
        const payload = {
          hypothesis_id: h.id,
          edits: { observable_sign: q("#lh-sign").value.trim(), how_to_observe: q("#lh-how").value.trim(), predicted_outcome: q("#lh-outcome").value.trim(), window_hours: num(q("#lh-window").value) },
          threshold: lab ? { value: Number(q("#lh-th").value), unit: q("#lh-unit").value.trim() || null } : null,
          ambiguity_resolutions: h.ambiguities.map((a, i) => ({ question: a.text, answer: q(`[data-amb="${i}"]`).value.trim() })),
          rough_match_accepted: rough ? q("#lh-rough").checked : null,
        };
        const c = normConfirm(await api("confirmHypothesis", payload, { id: h.id }));
        if (!c.testMode) throw new ApiError(502, "The server confirmed the hypothesis but didn’t say whether it is a Lab Test or a Field Test.");
        // keep the user's edits locally so step 3/4 show what was actually confirmed
        h.sign.text = payload.edits.observable_sign; h.sign.how = payload.edits.how_to_observe; h.prediction.outcome = payload.edits.predicted_outcome; h.prediction.windowHours = payload.edits.window_hours;
        if (c.observeWhen) h.sign.when = c.observeWhen;
        h.threshold = payload.threshold; h.thresholdPreset = false; // kept so the result can say what was measured
        h.id = c.id ?? h.id; eng.confirmed = c; S.mode = c.testMode; renderTest(h, c.testMode); go(3);
      } catch (err) { showAlert(err); }
      finally { eng.busy = false; busy(confirm, false); valid(); }
    });
  }

  /* Step 3: Lab vs Field */
  const ICON_LAB = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 6h12M21 6v14L9 40a3 3 0 0 0 3 4h24a3 3 0 0 0 3-4L27 20V6" fill="#fbf6e6" stroke="#10291b" stroke-width="3" stroke-linejoin="round"/><path d="M14 33h20" stroke="#10291b" stroke-width="3"/></svg>';
  const ICON_FIELD = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="9" fill="#f4d88a" stroke="#10291b" stroke-width="3"/><path d="M24 4v7M24 37v7M4 24h7M37 24h7M10 10l5 5M33 33l5 5M38 10l-5 5M15 33l-5 5" stroke="#10291b" stroke-width="3" stroke-linecap="round"/></svg>';
  const CITIES = { "Delhi": [28.6139, 77.2090], "Mumbai": [19.0760, 72.8777], "Pune": [18.5204, 73.8567], "Bengaluru": [12.9716, 77.5946], "Kolkata": [22.5726, 88.3639], "Chennai": [13.0827, 80.2707], "Hyderabad": [17.3850, 78.4867], "London": [51.5074, -0.1278], "New York": [40.7128, -74.0060], "Los Angeles": [34.0522, -118.2437], "Chicago": [41.8781, -87.6298], "Toronto": [43.6532, -79.3832], "Mexico City": [19.4326, -99.1332], "São Paulo": [-23.5505, -46.6333], "Paris": [48.8566, 2.3522], "Berlin": [52.5200, 13.4050], "Lagos": [6.5244, 3.3792], "Nairobi": [-1.2921, 36.8219], "Dubai": [25.2048, 55.2708], "Singapore": [1.3521, 103.8198], "Tokyo": [35.6762, 139.6503], "Sydney": [-33.8688, 151.2093] };
  function locationBlock() {
    return `<fieldset class="lore-fieldset"><legend>Where are you?</legend>
      <label for="ll-city">City</label>
      <select class="lore-field" id="ll-city"><option value="">Choose your city…</option>${Object.keys(CITIES).map((c) => `<option>${c}</option>`).join("")}<option value="__other">Somewhere else</option></select>
      <div class="lore-loc" id="ll-custom" hidden><div><label for="ll-label">Place name</label><input class="lore-field" id="ll-label" type="text" placeholder="e.g. my balcony" autocomplete="off"></div>
      <div><label for="ll-lat">Latitude</label><input class="lore-field" id="ll-lat" type="number" step="any" min="-90" max="90" inputmode="decimal"></div>
      <div><label for="ll-lon">Longitude</label><input class="lore-field" id="ll-lon" type="number" step="any" min="-180" max="180" inputmode="decimal"></div></div>
      <div class="lore-actions" style="margin-top:.8em"><button class="lore-btn lore-btn--ghost" type="button" id="ll-geo">Use my current location</button></div>
      <p class="lore-help" id="ll-note">Weather is looked up for this one spot.</p></fieldset>`;
  }
  function readLocation() {
    const lat = num($("#ll-lat").value), lon = num($("#ll-lon").value);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) { showAlert("Pick your city first, or use your current location.", "info"); return null; }
    return (S.location = { label: $("#ll-label").value.trim(), lat, lon });
  }
  function wireGeo() {
    const city = $("#ll-city"), custom = $("#ll-custom");
    on(city, "change", () => {
      const v = city.value;
      if (v === "__other") { custom.hidden = false; return; }
      custom.hidden = true;
      if (CITIES[v]) { $("#ll-label").value = v; $("#ll-lat").value = CITIES[v][0]; $("#ll-lon").value = CITIES[v][1]; }
      else { $("#ll-lat").value = ""; $("#ll-lon").value = ""; }
    });
    on($("#ll-geo"), "click", () => {
      if (!navigator.geolocation) return ($("#ll-note").textContent = "This browser can’t share a location. Pick a city instead.");
      $("#ll-note").textContent = "Asking your device…";
      navigator.geolocation.getCurrentPosition(
        (p) => { city.value = "__other"; custom.hidden = false; $("#ll-lat").value = p.coords.latitude.toFixed(4); $("#ll-lon").value = p.coords.longitude.toFixed(4); $("#ll-note").textContent = "Got it. Weather is looked up for this one spot."; },
        () => { $("#ll-note").textContent = "Location wasn’t shared. Pick a city instead."; }, { timeout: 10000 });
    });
  }
  function renderTest(h, mode) {
    $("#lore-side-mode").hidden = false; $("#lore-side-badge").textContent = mode === "lab" ? "Lab Test" : "Field Test";
    if (mode === "lab") {
      const rough = h.proxy?.fit === "rough";
      panes[2].innerHTML = `
        <div class="lore-mode lore-mode--lab">${ICON_LAB}<div><span class="lore-tag">Lab Test</span><h3>This one shows up in the weather data.</h3>
        <p>We use <b>${esc(friendlyVar(h.proxy?.variable) || "a weather measurement")}</b> as a stand-in for this sign (${rough ? "a rough match" : "a good match"}) and check it against about ten years of past weather at your spot.</p></div></div>
        ${locationBlock()}${learnHTML("place")}
        <div class="lore-actions"><button class="lore-btn lore-btn--coral" id="ll-run" type="button">Check it against past weather</button><button class="lore-btn lore-btn--ghost" type="button" data-go="2">Back to the saying details</button></div>`;
      wireGeo(); on($('[data-go="2"]', panes[2]), "click", () => go(2));
      on($("#ll-run"), "click", async (e) => {
        if (eng.busy) return; const loc = readLocation(); if (!loc) return;
        const btn = e.currentTarget; eng.busy = true; busy(btn, true); clearAlert();
        try {
          const c = normCard(await api("runBacktest", { hypothesis_id: h.id, location: loc }, { id: h.id }));
          c.mode = "lab"; c.place = c.place || loc.label || null; c.proverb = c.proverb || h.original; c.source = c.source ?? h.source;
          renderLabResult(c, h); go(4);
        } catch (err) { showAlert(err); }
        finally { eng.busy = false; busy(btn, false); }
      });
    } else {
      panes[2].innerHTML = `
        <div class="lore-mode lore-mode--field">${ICON_FIELD}<div><span class="lore-tag">Field Test</span><p class="lore-fieldnote">Tonight, you’re the instrument.</p>
        <p>No weather dataset records <b>${esc(h.sign.text || "this sign")}</b>, so it needs a person looking. ${h.sign.how ? esc(h.sign.how) : ""}</p></div></div>
        <ol class="ft-how" aria-label="How a field test works">
          <li><b>Look</b><span>A couple of minutes, outside. Phone down.</span></li>
          <li><b>Tap</b><span>Seen or Not seen. That’s the whole entry.</span></li>
          <li><b>Report</b><span>After ${MIN_N.field} sightings, we check the sky for each and write up your result.</span></li>
        </ol>
        ${locationBlock()}${learnHTML("place")}
        <div class="lore-actions"><button class="lore-btn lore-btn--coral" id="ll-start" type="button">Start my field test</button><button class="lore-btn lore-btn--ghost" type="button" data-go="2">Back to the saying details</button></div>`;
      wireGeo(); on($('[data-go="2"]', panes[2]), "click", () => go(2));
      on($("#ll-start"), "click", async (e) => {
        if (eng.busy) return; const loc = readLocation(); if (!loc) return;
        const btn = e.currentTarget; eng.busy = true; busy(btn, true); clearAlert();
        try {
          const f = normField(await api("startFieldTest", { hypothesis_id: h.id, location: loc }, { id: h.id }), h, loc);
          if (!f.id) throw new ApiError(502, "The server started the field test but didn’t return an experiment to log looks against.");
          beginField(f); go(4);
        } catch (err) { showAlert(err); }
        finally { eng.busy = false; busy(btn, false); }
      });
    }
  }

  /* Step 4 */
  function renderLabResult(c, h) {
    panes[3].innerHTML = `<h3>Here’s what the weather history says.</h3><p class="lore-intro">Lab Test results stay on their own page. They’re never mixed with outdoor looks.</p>${discoveryHTML(c, { h, th: h?.threshold ? { ...h.threshold, preset: !!h.thresholdPreset } : null, actions: true })}
      <div class="lore-actions"><button class="lore-btn lore-btn--sage" type="button" data-act="again">Test another saying</button></div>`;
    wireResultActions();
  }
  let resultWired = false;
  function wireResultActions() { // one delegated handler: "Test another saying" and every data-go button on step 4
    if (resultWired) return; resultWired = true;
    on(panes[3], "click", (e) => {
      if (e.target.closest('[data-act="again"]')) {
        eng.hyp = eng.confirmed = null; S.hyp = S.mode = null; fr.exp = null; fr.phase = "none"; eng.max = 1; eng.locked = []; form.reset(); $("#lore-side-mode").hidden = true; panes[1].innerHTML = panes[2].innerHTML = panes[3].innerHTML = ""; go(1);
        renderResume(); $("#lore-text").focus(); return;
      }
      const g = e.target.closest("[data-go]"); if (g) go(Number(g.dataset.go));
    });
  }
  go(1, false);

  /* Hooks for quickrun.js (one-tap chips). Same functions the form uses; nothing is re-implemented or faked. */
  Object.assign(S, {
    api, isConfigured, normHyp, normConfirm, normCard, cardHTML, resultHTML: discoveryHTML, thresholdGuide, CITIES, ApiError, describeError,
    // hand a hypothesis to the normal flow at step 2 (user must still choose/confirm)
    openReview(h) { eng.hyp = S.hyp = h; renderHyp(h); eng.max = 2; go(2); },
    // hand an already-confirmed hypothesis to step 3 (place + run/start)
    openTest(h, c) { eng.hyp = S.hyp = h; renderHyp(h); eng.confirmed = c; S.mode = c.testMode; renderTest(h, c.testMode); eng.max = 3; go(3); },
  });

  /* ---------------------------------------------------------
     5. SYSTEM ARCHITECTURE
     --------------------------------------------------------- */
  const W = 210, H = 100;
  const NODES = [
    { id: "ui", name: "Mobile web UI", sub: ["Proverbs, hypotheses,", "Seen / Not seen"], x: 0, y: 250, kind: "",
      what: "Where you enter a proverb, review and edit its hypothesis, run an experiment and record what you saw outdoors.",
      takes: "Hypotheses, scorecards and verdicts from the API.", gives: "Proverb text and source, your confirmed hypothesis and threshold, and Seen / Not seen looks." },
    { id: "api", name: "Backend API", sub: ["Coordinates every", "request"], x: 300, y: 250, kind: "",
      what: "Coordinates proverb, hypothesis, observation and result operations between the UI and everything behind it.",
      takes: "Requests from the UI.", gives: "Calls to the hypothesis service, weather client and database; results back to the UI." },
    { id: "hyp", name: "Hypothesis", sub: ["Gemma proposes,", "code validates"], x: 610, y: 20, kind: "code",
      what: "Open-weight Gemma turns a proverb into a structured hypothesis. The response is validated, and plain code (not the model) decides whether it’s backtestable.",
      takes: "A proverb in any language, plus its source.", gives: "Sign kind, observable sign, proxy and fit, ambiguities, and a threshold left empty for you to set." },
    { id: "wea", name: "Weather client", sub: ["Open-Meteo history", "and recent hours"], x: 610, y: 175, kind: "ext",
      what: "Fetches historical and recent weather from Open-Meteo.",
      takes: "A place and a time window.", gives: "Hourly weather data for scoring and for resolving outcomes." },
    { id: "out", name: "Outcome check", sub: ["Resolves pending looks", "when the app reopens"], x: 610, y: 330, kind: "",
      what: "A lazy, idempotent check: when the app next opens it finds due looks, claims each row so none resolve twice, fetches hourly rain for the window (retrying up to five times) and saves the outcome.",
      takes: "Looks whose window has closed.", gives: "Saved outcomes, and an updated scorecard." },
    { id: "score", name: "Scoring", sub: ["Base rate, hit rate,", "lift, interval, verdict"], x: 950, y: 175, kind: "code",
      what: "Computes the base rate, hit rate, lift, confidence interval and verdict. Below the minimum sample it withholds percentages and verdicts.",
      takes: "Sign-present days or looks and the matching weather outcomes.", gives: "A scorecard: counts, the bar to beat and one of four verdicts." },
    { id: "db", name: "Database", sub: ["Proverbs, hypotheses,", "looks, outcomes, results"], x: 950, y: 330, kind: "store",
      what: "Stores proverbs, hypotheses, locations, observations, outcomes and backtest results.",
      takes: "Records from the API, saved outcomes and scored results.", gives: "The records that scoring and outcome resolution read back." },
  ];
  const EDGES = [
    { id: "e1", a: "ui", b: "api", d: "M210 300H300", lbl: "words · looks", lx: 255, ly: 286, both: true },
    { id: "e2", a: "api", b: "hyp", d: "M510 275C560 275 560 70 610 70", lbl: "proverb text", lx: 566, ly: 168, both: true },
    { id: "e3", a: "api", b: "wea", d: "M510 300C560 300 560 225 610 225", lbl: "place · window", lx: 560, ly: 268 },
    { id: "e4", a: "api", b: "out", d: "M510 325C560 325 560 380 610 380", lbl: "on open", lx: 560, ly: 360 },
    { id: "e5", a: "wea", b: "score", d: "M820 225H950", lbl: "hourly weather", lx: 885, ly: 212 },
    { id: "e6", a: "out", b: "wea", d: "M715 330V275", lbl: "fetch rain", lx: 724, ly: 308, anchor: "start" },
    { id: "e7", a: "out", b: "db", d: "M820 380H950", lbl: "save outcome", lx: 885, ly: 404 },
    { id: "e8", a: "score", b: "db", d: "M1055 275V330", lbl: "scorecard", lx: 1063, ly: 308, anchor: "start" },
    { id: "e9", a: "out", b: "score", d: "M820 345C890 345 900 262 950 262", lbl: "update", lx: 884, ly: 316 },
    { id: "e10", a: "api", b: "db", d: "M405 350V475H1055V430", lbl: "save · read records", lx: 730, ly: 464 },
  ];
  const TRACES = {
    all: { edges: null, title: "", steps: [] },
    lab: { title: "Lab Test path", edges: ["e1", "e2", "e3", "e5", "e8", "e10"], steps: [
      "The web UI sends your proverb to the API.",
      "The hypothesis service asks Gemma for a structured hypothesis. Code, not the model, decides it’s backtestable.",
      "You confirm and pick a place. The API asks the weather client for about ten years of Open-Meteo history.",
      "The scoring service compares days showing the sign with the base rate.",
      "The result is stored and returned to you as a scorecard." ] },
    field: { title: "Field Test path", edges: ["e1", "e2", "e10"], steps: [
      "Same start: your proverb goes to the hypothesis service, and code says this one needs an observer.",
      "You confirm, go outside and tap Seen or Not seen. The API stores the look with a time to resolve after.",
      "The scorecard stays “On the trail” until enough looks have been resolved. See Outcome check." ] },
    outcome: { title: "Outcome check path", edges: ["e4", "e6", "e7", "e9", "e8"], steps: [
      "Whenever the app next opens, the API triggers the outcome check.",
      "It finds looks that are due and claims each row, so none resolve twice.",
      "It fetches hourly rain for the window through the weather client, retrying up to five times if an hour is missing.",
      "The outcome is saved and the scoring service updates the scorecard." ] },
  };
  const nodeById = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const KIND = { "": "Part", code: "Plain code decides", ext: "External data", store: "Storage" };
  const dgm = $("#lore-diagram"), stack = $("#lore-stack"), detail = $("#lore-detail");
  const arch = { pinned: null, hover: null, trace: "all" };

  (function buildDiagram() {
    if (!dgm) return;
    const edges = EDGES.map((e) => `<path class="lz-edge" id="lz-${e.id}" d="${e.d}" marker-end="url(#lz-arr)"${e.both ? ' marker-start="url(#lz-arr)"' : ""}/>`).join("");
    const labels = EDGES.map((e) => `<text class="lz-elabel" id="lz-l-${e.id}" x="${e.lx}" y="${e.ly}" text-anchor="${e.anchor || "middle"}">${esc(e.lbl)}</text>`).join("");
    const nodes = NODES.map((n, i) => `<g style="--n:${i}" class="lz-node${n.kind ? " lz-node--" + n.kind : ""}" id="lz-n-${n.id}" data-node="${n.id}" role="button" tabindex="0" aria-pressed="false" aria-label="${esc(n.name)}: ${esc(n.sub.join(" "))}">
      <rect class="lz-shadow" x="${n.x + 6}" y="${n.y + 6}" width="${W}" height="${H}" rx="14"/><rect class="lz-card" x="${n.x}" y="${n.y}" width="${W}" height="${H}" rx="14"/>
      <text class="lz-name" x="${n.x + W / 2}" y="${n.y + 34}" text-anchor="middle">${esc(n.name)}</text>
      <text class="lz-sub" x="${n.x + W / 2}" y="${n.y + 62}" text-anchor="middle">${esc(n.sub[0])}</text>
      <text class="lz-sub" x="${n.x + W / 2}" y="${n.y + 82}" text-anchor="middle">${esc(n.sub[1])}</text></g>`).join("");
    dgm.innerHTML = `<svg viewBox="-10 0 1190 520" role="group" aria-label="Lore Lab system architecture diagram"><defs>
      <marker id="lz-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="lz-mk" d="M0 0 10 5 0 10z"/></marker>
      <marker id="lz-arr-hot" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="lz-mk-hot" d="M0 0 10 5 0 10z"/></marker></defs>${edges}${labels}${nodes}</svg>`;
    $$(".lz-edge", dgm).forEach((p, i) => { p.style.setProperty("--len", Math.ceil(p.getTotalLength())); p.style.setProperty("--e", i); });
    const order = ["ui", "api", "hyp", "wea", "score", "out", "db"];
    stack.innerHTML = order.map((id, i) => { const n = nodeById[id];
      return `<li><button type="button" data-node="${id}" class="${n.kind ? "is-" + n.kind : ""}" aria-pressed="false"><strong>${esc(n.name)}</strong><small>${esc(n.sub.join(" "))}</small></button>${i < order.length - 1 ? '<span class="lz-link" aria-hidden="true">↓</span>' : ""}</li>`; }).join("");
  })();

  function paint() {
    const focusId = arch.pinned || arch.hover;
    let hotE = null, hotN = null;
    if (focusId) {
      hotE = new Set(EDGES.filter((e) => e.a === focusId || e.b === focusId).map((e) => e.id));
      hotN = new Set([focusId]); EDGES.forEach((e) => { if (hotE.has(e.id)) { hotN.add(e.a); hotN.add(e.b); } });
    } else if (arch.trace !== "all") {
      hotE = new Set(TRACES[arch.trace].edges); hotN = new Set(); EDGES.forEach((e) => { if (hotE.has(e.id)) { hotN.add(e.a); hotN.add(e.b); } });
    }
    EDGES.forEach((e) => {
      const p = $(`#lz-${e.id}`), l = $(`#lz-l-${e.id}`); if (!p) return;
      const hot = !!hotE && hotE.has(e.id);
      p.classList.toggle("is-hot", hot); p.classList.toggle("is-dim", !!hotE && !hot);
      p.setAttribute("marker-end", `url(#${hot ? "lz-arr-hot" : "lz-arr"})`); if (e.both) p.setAttribute("marker-start", `url(#${hot ? "lz-arr-hot" : "lz-arr"})`);
      l.classList.toggle("is-hot", hot); l.classList.toggle("is-dim", !!hotE && !hot);
    });
    NODES.forEach((n) => {
      const dim = !!hotN && !hotN.has(n.id), sel = arch.pinned === n.id;
      const g = $(`#lz-n-${n.id}`), b = $(`[data-node="${n.id}"]`, stack);
      if (g) { g.classList.toggle("is-dim", dim); g.classList.toggle("is-sel", sel); g.setAttribute("aria-pressed", String(sel)); }
      if (b) { b.classList.toggle("is-dim", dim); b.classList.toggle("is-sel", sel); b.setAttribute("aria-pressed", String(sel)); }
    });
    const id = focusId, n = id && nodeById[id];
    if (n) {
      const talks = [...new Set(EDGES.filter((e) => e.a === id || e.b === id).map((e) => nodeById[e.a === id ? e.b : e.a].name))];
      detail.innerHTML = `<span class="lore-tag">${KIND[n.kind]}</span><h3>${esc(n.name)}</h3><p>${esc(n.what)}</p><dl><div><dt>Takes in</dt><dd>${esc(n.takes)}</dd></div><div><dt>Hands on</dt><dd>${esc(n.gives)}</dd></div><div><dt>Talks to</dt><dd>${esc(talks.join(", "))}</dd></div></dl>`;
    } else if (arch.trace !== "all") {
      const T = TRACES[arch.trace];
      detail.innerHTML = `<span class="lore-tag">Trace</span><h3>${esc(T.title)}</h3><ol>${T.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol><p class="lore-help">Tap a part to see it up close.</p>`;
    } else {
      detail.innerHTML = "";
    }
    detail.hidden = !detail.innerHTML;
    if (arch.pinned && window.innerWidth <= 800) detail.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  if (dgm) {
    const pick = (id) => { arch.pinned = arch.pinned === id ? null : id; paint(); };
    on(dgm, "click", (e) => { const g = e.target.closest("[data-node]"); if (g) pick(g.dataset.node); });
    on(dgm, "keydown", (e) => { if (e.key !== "Enter" && e.key !== " ") return; const g = e.target.closest("[data-node]"); if (g) { e.preventDefault(); pick(g.dataset.node); } });
    on(dgm, "mouseover", (e) => { const g = e.target.closest("[data-node]"); const id = g ? g.dataset.node : null; if (id !== arch.hover) { arch.hover = id; paint(); } });
    on(dgm, "mouseleave", () => { arch.hover = null; paint(); });
    on(stack, "click", (e) => { const b = e.target.closest("[data-node]"); if (b) pick(b.dataset.node); });
    on($(".lore-trace"), "click", (e) => {
      const b = e.target.closest("[data-trace]"); if (!b) return;
      arch.trace = b.dataset.trace; arch.pinned = null; arch.hover = null;
      $$(".lore-trace button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); paint();
    });
    paint();
  }

  /* ---------------------------------------------------------
     6. FIELD TEST: trail, look card, observation log and field report,
        shown inline in step 4 of a Field Test
     --------------------------------------------------------- */
  const fr = { exp: null, phase: "none", busy: false, server: [], local: [], seq: 0, syncSeq: 0, cardSeq: 0, cards: [], remindTime: null, calDone: false, startedAt: null, pop: null, just: null, reportSeen: false, moreOpen: false };
  let obsEl = null, ftRoot = null, trailEl = null, lookEl = null, repEl = null, logEl = null, actEl = null, liveEl = null;
  const ST = { logged: "Logged", pending: "Pending", resolved: "Resolved", failed: "Couldn’t resolve" };

  /* ---------------------------------------------------------
     6b. DAILY REMINDER · "Add to calendar" (.ics, no server)
     A verdict needs 10 sign-present looks and nothing nudges anyone to look again,
     so the card can hand over a small recurring calendar event at the saying's best time.
     Times are "floating" (no timezone): the event fires at that clock time wherever the phone is.
     --------------------------------------------------------- */
  const REMIND_DAYS = 14;      // 10 sign-present looks are needed; "Not seen" days don't count, so leave some slack
  const REMIND_MINUTES = 15;   // length of the calendar block
  const BEST_TIME = [          // saying's best_time_of_day -> [hour, minute]; first match wins
    ["dawn", [6, 0]], ["sunrise", [6, 0]], ["morning", [8, 0]], ["noon", [12, 0]], ["midday", [12, 0]],
    ["afternoon", [16, 0]], ["dusk", [18, 0]], ["sunset", [18, 0]], ["evening", [19, 0]], ["night", [21, 0]],
  ];
  const DEFAULT_LOOK = [18, 0]; // "any": same hour the Lab uses for its look (LOOK_HOUR)
  const p2 = (n) => String(n).padStart(2, "0");
  function parseBestTime(w) {
    const t = String(w ?? "").trim().toLowerCase();
    let m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);                       // "18:30"
    if (m) return [Number(m[1]), Number(m[2])];
    m = t.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/);            // "6pm", "6:30 am"
    if (m) return [(Number(m[1]) % 12) + (m[3] === "pm" ? 12 : 0), Number(m[2] || 0)];
    const hit = BEST_TIME.find(([k]) => t.includes(k));
    return hit ? hit[1] : DEFAULT_LOOK;
  }
  const hasBestTime = (w) => { const t = String(w ?? "").toLowerCase(); return /\d/.test(t) || BEST_TIME.some(([k]) => t.includes(k)); };
  const BS = String.fromCharCode(92); // a single backslash; RFC 5545 TEXT escapes: \\ \; \, \n
  const icsEsc = (t) => String(t ?? "").replace(/[\\;,]/g, (c) => BS + c).replace(/\r?\n/g, BS + "n");
  function icsFold(line) { // RFC 5545: lines are at most 75 octets; continuation lines start with one space
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = []; let cur = "", bytes = 0;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > 75) { out.push(cur); cur = " "; bytes = 1; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join("\r\n");
  }
  const icsLocal = (d) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}T${p2(d.getHours())}${p2(d.getMinutes())}00`;
  const icsUtc = (d) => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;

  function buildICS(f, hour, minute, days = REMIND_DAYS, now = new Date()) {
    const start = new Date(now); start.setHours(hour, minute, 0, 0);
    if (start <= now) start.setDate(start.getDate() + 1);                    // today if it's still ahead, else tomorrow
    const end = new Date(start.getTime() + REMIND_MINUTES * 60000);
    const sign = f.sign || "the sign in the saying";
    const desc = [
      `“${f.proverb}”`, `Look for: ${sign}`, f.how ? `How: ${f.how}` : "", f.place ? `Where: ${f.place}` : "",
      "Look for a couple of minutes, tap Seen or Not seen, then put the phone away.",
    ].filter(Boolean).join("\n");
    const link = `${location.origin}/?skiploader&look=${encodeURIComponent(f.id)}#engine`; // reopens this exact test on the device that started it
    return [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lore Lab//Field reminder//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:lorelab-${f.id}@lorelab`,                                          // stable, so re-adding updates instead of duplicating
      `DTSTAMP:${icsUtc(now)}`, `DTSTART:${icsLocal(start)}`, `DTEND:${icsLocal(end)}`,
      `RRULE:FREQ=DAILY;COUNT=${days}`,
      `SUMMARY:${icsEsc(`Lore Lab: go look (${sign})`)}`,
      `DESCRIPTION:${icsEsc(desc)}`,
      `URL:${link}`, "TRANSP:TRANSPARENT",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(`Time to look: ${sign}`)}`, "TRIGGER:PT0M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR",
    ].map(icsFold).join("\r\n") + "\r\n";
  }
  function downloadICS(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  const ICON_CAL = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="9" width="38" height="34" rx="5" fill="#fbf6e6" stroke="#10291b" stroke-width="3"/><path d="M5 19h38V14a5 5 0 0 0-5-5H10a5 5 0 0 0-5 5z" fill="#10291b"/><path d="M15 4v10M33 4v10" stroke="#10291b" stroke-width="3.5" stroke-linecap="round"/><g fill="#f26a4f" stroke="#10291b" stroke-width="1.6"><circle cx="16" cy="28" r="3"/><circle cx="24" cy="28" r="3" fill="#f4d88a"/><circle cx="32" cy="28" r="3" fill="#8aa863"/><circle cx="16" cy="36" r="3" fill="#8aa863"/><circle cx="24" cy="36" r="3"/></g></svg>';
  function calHTML(f) {
    const [h, m] = parseBestTime(f.when);
    const val = fr.remindTime || `${p2(h)}:${p2(m)}`;
    const why = hasBestTime(f.when) ? `Best time for this sign: <b>${esc(f.when)}</b>.` : "This sign has no best time, so pick one that suits you.";
    return `<div class="lore-cal${fr.calDone ? " is-done" : ""}" id="lore-cal">
      ${ICON_CAL}
      <div><p class="lore-cal__t">Don’t forget to look</p>
        <p class="lore-cal__s">${why} A daily reminder, ${REMIND_DAYS} days, in any calendar app.</p>
        <label class="lore-cal__time" for="lf-time">Remind me at <input class="lore-field" id="lf-time" type="time" value="${val}"></label></div>
      <button class="lore-btn lore-btn--butter lore-cal__btn" type="button" data-act="ics">${fr.calDone ? "Save it again" : "Add to calendar"}</button>
      <img class="lore-cal__stamp" src="assets/cat-stamp.webp" alt="" width="72" height="72">
      <p class="lore-cal__ok" role="status" aria-live="polite">${fr.calDone ? "Saved. Open the file to add it to your calendar." : ""}</p></div>`;
  }
  function onAddToCalendar() {
    const f = fr.exp; if (!f) return;
    const input = $("#lf-time", obsEl);
    const [dh, dm] = parseBestTime(f.when);
    const mm = /^(\d{1,2}):(\d{2})$/.exec(input?.value || "");
    const hh = mm ? Math.min(Number(mm[1]), 23) : dh, mn = mm ? Math.min(Number(mm[2]), 59) : dm;
    fr.remindTime = `${p2(hh)}:${p2(mn)}`;
    const slug = (f.proverb || "saying").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "saying";
    downloadICS(buildICS(f, hh, mn), `lore-lab-${slug}.ics`);
    fr.calDone = true;
    const box = $("#lore-cal", obsEl);
    if (box) {
      box.classList.add("is-done");
      $(".lore-cal__ok", box).textContent = "Saved. Open the file to add it to your calendar.";
      $(".lore-cal__btn", box).textContent = "Save it again";
    }
  }
  window.LoreLab.buildICS = buildICS; // handy for tests

  /* ---------------------------------------------------------
     6c. FIELD TEST EXPERIENCE
     Four parts, all fed by real data only (nothing is invented):
       trail   : one daisy per sighting the report needs (checked / waiting / empty) + pebbles for "Not seen"
       look    : what to look for, Seen / Not seen, then a plain "what happens next"
       log     : every look for THIS saying, with its status and outcome
       report  : a draft that fills in, then the real field report once the scorecard has enough sightings
     Active tests are remembered in localStorage so a multi-day test survives closing the tab,
     and the calendar reminder (?look=<id>) reopens exactly the right one.
     --------------------------------------------------------- */
  const FT_KEY = "loreFieldTests", FT_SAVED_MAX = 8;
  const normTxt = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /* ---- remembered tests ---- */
  function ftStore() {
    try { const v = JSON.parse(localStorage.getItem(FT_KEY) || "[]"); return Array.isArray(v) ? v.filter((t) => t && t.exp && t.exp.id != null && t.exp.proverb) : []; } catch (_) { return []; }
  }
  function ftSave(list) { try { localStorage.setItem(FT_KEY, JSON.stringify(list.slice(0, FT_SAVED_MAX))); } catch (_) { /* private mode: the test still works this session */ } }
  function ftRemember() {
    const f = fr.exp; if (!f) return;
    const s = ftStats();
    const rest = ftStore().filter((t) => String(t.exp.id) !== String(f.id));
    ftSave([{ v: 1, exp: f, startedAt: fr.startedAt, remindTime: fr.remindTime, calDone: fr.calDone, snap: { looks: s.looks.length, sightings: s.sightings, min: s.min }, savedAt: new Date().toISOString() }, ...rest]);
  }
  const ftForget = (id) => ftSave(ftStore().filter((t) => String(t.exp.id) !== String(id)));

  /* ---- data: looks for this saying, and its scorecard ---- */
  function normLook(o) {
    const t = Date.parse(o.observed_at);
    const st = String(o.status || "pending").toLowerCase().replace("resolve_failed", "failed");
    return {
      exp: o.experiment_id ?? null, proverb: o.proverb ?? o.original_text ?? "", seen: !!o.seen, status: st in ST ? st : "pending",
      outcome: typeof o.outcome === "string" ? o.outcome : null,
      hit: typeof o.hit === "boolean" ? o.hit : typeof o.outcome === "boolean" ? o.outcome : null, // only if the server says so
      note: o.note ?? null, at: o.observed_at ?? null, t: Number.isFinite(t) ? t : 0,
    };
  }
  const isMine = (l) => { const f = fr.exp; return !!f && ((l.exp != null && String(l.exp) === String(f.id)) || normTxt(l.proverb) === normTxt(f.proverb)); };
  function myLooks() {
    const srv = fr.server.filter(isMine);
    const extra = fr.local.filter((l) => l.seq > fr.syncSeq); // logged here, not yet in the server's list
    return [...extra, ...srv].sort((a, b) => (b.t || 0) - (a.t || 0));
  }
  function pickCard() {
    const f = fr.exp; if (!f) return null;
    const field = fr.cards.filter((c) => c.mode === "field"), same = (c) => normTxt(c.proverb) === normTxt(f.proverb);
    return field.find((c) => c.expId != null && String(c.expId) === String(f.id))
      || field.find((c) => same(c) && (!c.place || !f.place || normTxt(c.place) === normTxt(f.place)))
      || field.find(same) || null;
  }
  function ftStats() {
    const looks = myLooks(), seen = looks.filter((l) => l.seen), card = pickCard();
    const min = card?.min ?? MIN_N.field;
    const lc = seen.filter((l) => l.status === "resolved").length;
    const lp = seen.filter((l) => l.status === "logged" || l.status === "pending").length;
    const unscored = fr.local.filter((l) => l.seen && l.seq > fr.cardSeq).length; // logged since the scorecard was fetched
    const counted = card && card.n !== null ? card.n : lc;
    const pending = card && card.pending !== null ? card.pending + unscored : lp;
    const times = looks.map((l) => l.t).filter(Boolean).sort((a, b) => a - b);
    const days = new Set(times.map((t) => dayKey(new Date(t)))).size;
    return { looks, seen, sightings: seen.length, notSeen: looks.length - seen.length, counted, pending, min, card, days, first: times[0] ?? null, last: times[times.length - 1] ?? null };
  }

  /* ---- parts ---- */
  const PETALS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<ellipse class="p" cx="20" cy="9.5" rx="4.1" ry="7.2" transform="rotate(${i * 45} 20 20)"/>`).join("");
  const daisy = (st, pop) => `<svg class="ft-fl ft-fl--${st}${pop ? " ft-fl--pop" : ""}" viewBox="0 0 40 40" aria-hidden="true" focusable="false">${PETALS}<circle class="c" cx="20" cy="20" r="5.4"/></svg>`;

  function renderTrail() {
    const f = fr.exp; if (!trailEl || !f) return;
    const s = ftStats(), slots = Math.max(1, Math.min(s.min, 20));
    let fl = ""; for (let i = 0; i < slots; i++) fl += daisy(i < s.counted ? "on" : i < s.counted + s.pending ? "wait" : "off", fr.pop === i);
    const over = Math.max(s.counted + s.pending - slots, 0), peb = Math.min(s.notSeen, 14);
    const logged = s.counted + s.pending;
    const label = `${logged} of ${s.min} sightings logged, ${s.counted} checked${s.pending ? `, ${s.pending} waiting for the sky` : ""}${s.notSeen ? `, ${plural(s.notSeen, "look", "looks")} with nothing seen` : ""}.`;
    trailEl.innerHTML = `<p class="ft-kick">${esc(f.place || "Field test")}</p>
      <p class="ft-q">“${esc(f.proverb)}”</p>
      <div class="ft-flowers" role="img" aria-label="${esc(label)}">${fl}${over ? `<span class="ft-extra">+${over}</span>` : ""}</div>
      <p class="ft-count"><b>${logged}</b> of ${s.min} sightings logged${logged ? `<span> · ${s.counted} checked${s.pending ? `, ${s.pending} waiting for the sky` : ""}</span>` : ""}</p>
      ${s.notSeen ? `<p class="ft-pebs"><span class="ft-pebs__row" aria-hidden="true">${"<i></i>".repeat(peb)}${s.notSeen > 14 ? `<em>+${s.notSeen - 14}</em>` : ""}</span><span>${plural(s.notSeen, "look", "looks")} with nothing seen</span></p>` : ""}
      <p class="ft-rule">Only sightings count toward the report. A “Not seen” look stays in your log as a pebble.</p>`;
    fr.pop = null;
  }

  function readyHTML() {
    const f = fr.exp, no = ftStats().looks.length + 1;
    const facts = [["How", f.how], ["Best time", f.when], ["Where", f.place]].filter(([, v]) => v);
    return `<p class="ft-kick ft-lookno">${no === 1 ? "Your first look" : `Look #${no}`}</p>
      <p class="ft-ask"><span>Look for</span> ${esc(f.sign || "the sign in the saying")}</p>
      ${facts.length ? `<dl class="ft-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
      <p class="ft-step">Give it a couple of minutes. Phone down, eyes up. Then tap what you saw.</p>
      <div class="lore-seen" role="group" aria-label="What did you see?"><button class="lore-btn" type="button" data-seen="true">Seen<small>I can see it</small></button><button class="lore-btn" type="button" data-seen="false">Not seen<small>Not this time</small></button></div>
      <details class="ft-d"><summary>Add a note (optional)</summary><textarea class="lore-field" id="lf-note" rows="2" placeholder="Anything worth remembering"></textarea></details>
      <details class="ft-d"><summary>Remind me to come back</summary>${calHTML(f)}</details>`;
  }
  function milestone(seen, s) {
    const m = s.min, n = s.sightings;
    if (!seen) return `Nothing showed this time. That’s a proper entry: it stays in your log, though only sightings count toward the ${m}.`;
    if (s.card && s.counted >= m) return "Another sighting for the report. More sightings make the result firmer.";
    if (n === 1) return "Your first sighting. The report has its first page.";
    if (n >= m) return `That’s ${n} sightings logged. Once the sky has been checked for each, your report opens.`;
    if (n === m - 1) return `${n} sightings logged. One more and the report can open.`;
    if (n === Math.ceil(m / 2)) return `Halfway: ${n} of ${m} sightings logged.`;
    return `Sighting ${n} of ${m}. ${m - n} to go.`;
  }
  function loggedHTML() {
    const f = fr.exp, j = fr.just, at = j.at;
    const closes = f.windowHours ? new Date(at.getTime() + f.windowHours * 3600000) : null;
    const next = j.seen
      ? `<ol class="ft-next" aria-label="What happens next"><li class="is-done"><b>Logged</b><span>${esc(fmtTime(at))}</span></li>
          <li><b>Window closes</b><span>${closes ? esc(`${fmtDay(closes)}, ${fmtTime(closes)}`) : "when the window ends"}</span></li>
          <li><b>Sky checked</b><span>Open Lore Lab after that${f.outcome ? ` and we check for “${esc(f.outcome)}”` : ""}.</span></li></ol>`
      : (f.when ? `<p class="ft-watch">Try again at the best time: <b>${esc(f.when)}</b>.</p>` : "");
    return `<div class="ft-stamp" aria-hidden="true">Logged</div>
      <p class="ft-kick">${j.seen ? "Seen" : "Not seen"} · ${esc(fmtDay(at))}, ${esc(fmtTime(at))}</p>
      <h4 class="ft-done__t" tabindex="-1">${j.no === 1 ? "Your first look is in the book." : `Look #${j.no} is in the book.`}</h4>
      <p class="ft-done__msg">${esc(j.msg)}</p>
      ${next}
      <p class="ft-phone">Now put the phone away.</p>
      ${calHTML(f)}
      <div class="lore-actions" style="justify-content:center"><button class="lore-btn lore-btn--ghost" type="button" data-act="another">Log another look</button></div>`;
  }
  function renderLook() {
    if (!lookEl || !fr.exp) return;
    const logged = fr.phase === "logged" && fr.just;
    lookEl.classList.toggle("is-logged", !!logged);
    lookEl.innerHTML = logged ? loggedHTML() : readyHTML();
    if (logged) { const h = $(".ft-done__t", lookEl); if (h) h.focus({ preventScroll: true }); lookEl.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" }); }
  }

  function entryHTML(l) {
    const st = l.status in ST ? l.status : "pending", d = l.t ? new Date(l.t) : null;
    let out = "";
    if (st === "failed") out = "No weather data for that window, so it can’t be scored.";
    else if (l.seen && st === "resolved") out = l.hit === true ? `<b class="ft-hit">It came true</b>` : l.hit === false ? `<b class="ft-miss">It didn’t happen</b>` : l.outcome ? esc(l.outcome) : "";
    return `<li class="ft-ent" data-seen="${l.seen}">
      <span class="ft-ent__d">${d ? `<time datetime="${esc(d.toISOString())}"><b>${esc(fmtDay(d))}</b><small>${esc(fmtTime(d))}</small></time>` : "<b>Date unknown</b>"}</span>
      <span class="ft-ent__m"><span class="ft-seenpill" data-seen="${l.seen}">${l.seen ? "Seen" : "Not seen"}</span>${out ? ` <span class="ft-ent__o">${out}</span>` : ""}${l.note ? `<span class="ft-ent__n">“${esc(l.note)}”</span>` : ""}</span>
      <span class="lore-st" data-s="${st}">${ST[st]}</span></li>`;
  }
  function renderLog() {
    if (!logEl || !fr.exp) return;
    const { looks } = ftStats(), head = looks.slice(0, 6), rest = looks.slice(6);
    const anyPending = looks.some((l) => l.seen && (l.status === "logged" || l.status === "pending"));
    logEl.innerHTML = `<div class="ft-sec__top"><h4 id="ft-log-h">Observation log</h4><span class="ft-sec__n">${plural(looks.length, "look", "looks")}</span></div>
      ${looks.length
        ? `<ol class="ft-log" aria-labelledby="ft-log-h">${head.map(entryHTML).join("")}</ol>${rest.length ? `<details class="ft-more"${fr.moreOpen ? " open" : ""}><summary>Show ${plural(rest.length, "earlier look", "earlier looks")}</summary><ol class="ft-log">${rest.map(entryHTML).join("")}</ol></details>` : ""}`
        : `<div class="ft-log ft-log--empty"><p>Your first look goes here.</p><i></i><i></i></div>`}
      ${anyPending ? `<p class="ft-rule">Pending means the window hasn’t closed yet, or hasn’t been checked. Open Lore Lab after it closes and it checks for you.</p>` : ""}`;
  }

  function renderReport() {
    if (!repEl || !fr.exp || !ftRoot) return;
    const f = fr.exp, s = ftStats(), c = s.card, sc = c ? scoreOf(c, "field") : null;
    const final = !!(sc && sc.enough && sc.verdict !== "trail"), v = final ? sc.verdict : null;
    const want = final ? lookEl : actEl;
    if (repEl.nextElementSibling !== want) ftRoot.insertBefore(repEl, want); // report rises above the look card once it exists
    if (final) {
      const isNew = !fr.reportSeen; fr.reportSeen = true;
      const when = s.first ? `${fmtDay(new Date(s.first))}${s.last && dayKey(new Date(s.last)) !== dayKey(new Date(s.first)) ? ` to ${fmtDay(new Date(s.last))}` : ""}` : "";
      repEl.innerHTML = `<div class="ft-rep ft-rep--final${isNew ? " is-new" : ""}">${discoveryHTML({ ...c, place: c.place || f.place }, { f, actions: true, evidence: { days: s.days, notSeen: s.notSeen, when } })}
        <div class="dv-foot"><button class="lore-btn lore-btn--coral" type="button" data-act="share">Save report image</button></div>
        <p class="ft-sharemsg" id="ft-share-msg" role="status" aria-live="polite"></p></div>`;
      return;
    }
    const logged = s.counted + s.pending, left = Math.max(s.min - logged, 0);
    const need = left > 0 ? `${plural(left, "more sighting", "more sightings")} to spot.`
      : s.counted < s.min ? `All the sightings you need are logged. ${s.min - s.counted} still waiting for the sky: open Lore Lab after their windows close.`
      : "Counting is done. Waiting for the scoring service to write the verdict.";
    repEl.innerHTML = `<article class="lore-card lore-card--empty ft-rep ft-rep--draft" aria-labelledby="ft-rep-h">
      <p class="ft-kick">Field report · draft</p>
      <h4 class="ft-rep__h" id="ft-rep-h">${s.looks.length ? "Taking shape." : "A blank page, waiting for your first look."}</h4>
      <dl class="ft-facts ft-facts--rep">
        <div><dt>Saying</dt><dd>“${esc(f.proverb)}”</dd></div>
        ${f.place ? `<div><dt>Place</dt><dd>${esc(f.place)}</dd></div>` : ""}
        ${fr.startedAt ? `<div><dt>Started</dt><dd>${esc(fmtDay(new Date(fr.startedAt)))}</dd></div>` : ""}
        <div><dt>Looks</dt><dd>${s.looks.length}${s.days ? ` on ${plural(s.days, "day", "days")}` : ""}</dd></div>
        <div><dt>Sightings</dt><dd>${s.sightings} · Not seen: ${s.notSeen}</dd></div></dl>
      <div class="ft-slot"><span class="ft-slot__l">Verdict</span><span>Unlocks after ${s.min} checked sightings. ${esc(need)}</span></div>
      ${c && c.hits !== null && s.counted > 0 ? `<p class="lore-pend">So far the predicted weather followed ${c.hits} of ${s.counted} checked sightings. Far too few to read anything into yet.</p>` : ""}
      <p class="ft-willh">What the finished report will show</p>
      <ul class="ft-will"><li><b>Hit rate</b> how often it came true after you saw the sign</li><li><b>Bar to beat</b> how often it happens anyway</li><li><b>Verdict</b> promising, same as chance, or backfires</li></ul></article>`;
  }

  function renderAll() {
    if (!ftRoot || !ftRoot.isConnected || !fr.exp) return;
    renderTrail(); renderReport(); renderLog();
    if (fr.phase === "ready") { const k = $(".ft-lookno", lookEl); if (k) k.textContent = ftStats().looks.length === 0 ? "Your first look" : `Look #${ftStats().looks.length + 1}`; }
    ftRemember();
  }

  async function refreshServerData() {
    const seq0 = fr.seq;
    if (isConfigured("listObservations")) {
      try { const r = await api("listObservations"); const list = Array.isArray(r) ? r : r.observations || []; if (seq0 >= fr.syncSeq) { fr.server = list.map(normLook); fr.syncSeq = seq0; } } catch (_) { /* keep what we have */ }
    }
    if (isConfigured("scorecards")) {
      try { const r = await api("scorecards"); if (seq0 >= fr.cardSeq) { fr.cards = (Array.isArray(r) ? r : r.scorecards || []).map(normCard); fr.cardSeq = seq0; } } catch (_) { /* draft stays */ }
    }
    renderAll();
  }

  function resetField() { Object.assign(fr, { exp: null, phase: "none", busy: false, server: [], local: [], seq: 0, syncSeq: 0, cardSeq: 0, cards: [], remindTime: null, calDone: false, startedAt: null, pop: null, just: null, reportSeen: false, moreOpen: false }); }

  function mountField() {
    panes[3].innerHTML = `<h3>Your field test</h3><p class="lore-intro">Look, tap, put the phone away. We check the sky for you later.</p>
      <div class="ft" id="ft">
        <section class="ft-trail" id="ft-trail" aria-label="Progress"></section>
        <section class="lore-obs ft-look" id="ft-look" aria-label="Log a look"></section>
        <section class="ft-repwrap" id="ft-report" aria-label="Field report"></section>
        <section class="ft-logwrap" id="ft-log" aria-label="Observation log"></section>
        <div class="ft-actions" id="ft-actions"><div class="lore-actions"><button class="lore-btn lore-btn--sage" type="button" data-act="again">Test another saying</button><button class="lore-btn lore-btn--ghost" type="button" data-act="stop">Stop following this saying</button></div>
          <div class="ft-stopbox" id="ft-stopbox" hidden><p>Stop following this saying here? Your looks stay in the logbook.</p><div class="lore-actions"><button class="lore-btn lore-btn--coral" type="button" data-act="stop-yes">Stop following</button><button class="lore-btn lore-btn--ghost" type="button" data-act="stop-no">Keep going</button></div></div></div>
      </div><p class="ft-sr" id="ft-live" role="status" aria-live="polite"></p>`;
    ftRoot = $("#ft"); trailEl = $("#ft-trail"); lookEl = $("#ft-look"); repEl = $("#ft-report"); logEl = $("#ft-log"); actEl = $("#ft-actions"); liveEl = $("#ft-live"); obsEl = lookEl;
    on(ftRoot, "click", onFieldClick);
    on(logEl, "toggle", (e) => { if (e.target.classList?.contains("ft-more")) fr.moreOpen = e.target.open; }, { capture: true });
    wireResultActions();
    renderLook(); renderAll(); refreshServerData();
  }
  function beginField(f) {
    resetField(); fr.exp = f; S.field = f; fr.phase = "ready"; fr.startedAt = new Date().toISOString();
    mountField(); ftRemember(); renderResume();
  }
  function openSaved(t, focus = true) {
    resetField(); fr.exp = t.exp; S.field = t.exp; fr.phase = "ready"; fr.startedAt = t.startedAt || null; fr.remindTime = t.remindTime || null; fr.calDone = !!t.calDone;
    $("#lore-side-mode").hidden = false; $("#lore-side-badge").textContent = "Field Test";
    eng.locked = [2, 3]; mountField(); eng.max = 4; go(4, focus);
  }

  async function onFieldClick(e) {
    const act = (k) => e.target.closest(`[data-act="${k}"]`);
    if (act("ics")) { onAddToCalendar(); return; }
    if (act("another")) { fr.phase = "ready"; fr.just = null; renderLook(); return; }
    if (act("keep")) { fr.phase = "ready"; fr.just = null; renderLook(); lookEl.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" }); return; }
    if (act("share")) { ftShare(); return; }
    if (act("stop")) { $("#ft-stopbox").hidden = false; return; }
    if (act("stop-no")) { $("#ft-stopbox").hidden = true; return; }
    if (act("stop-yes")) { ftForget(fr.exp.id); renderResume(); $('[data-act="again"]', panes[3]).click(); return; }
    const b = e.target.closest("[data-seen]"); if (!b || fr.busy || !fr.exp) return;
    const seen = b.dataset.seen === "true";
    fr.busy = true; $$(".lore-seen .lore-btn", lookEl).forEach((x) => (x.disabled = true)); busy(b, true);
    try {
      const note = ($("#lf-note", lookEl)?.value || "").trim();
      const r = await api("submitObservation", { experiment_id: fr.exp.id, seen, note: note || null }, { id: fr.exp.id });
      let at = r?.observed_at ? new Date(r.observed_at) : new Date(); if (isNaN(at)) at = new Date(); // fall back to the moment of the tap
      fr.seq++; fr.local.push({ seq: fr.seq, exp: fr.exp.id, proverb: fr.exp.proverb, seen, status: "logged", outcome: null, hit: null, note: note || null, at: at.toISOString(), t: at.getTime() });
      const s = ftStats();
      fr.phase = "logged"; fr.just = { seen, at, no: s.looks.length, msg: milestone(seen, s) };
      fr.pop = seen && s.counted + s.pending <= s.min ? s.counted + s.pending - 1 : null; // pop the new daisy
      renderTrail(); renderLook(); renderReport(); renderLog(); ftRemember(); renderResume();
      if (liveEl) liveEl.textContent = fr.just.msg;
      refreshServerData();
    } catch (err) {
      const d = describeError(err);
      lookEl.insertAdjacentHTML("beforeend", `<div class="lore-alert" role="alert"><strong>${esc(d.title)}</strong>${esc(d.msg)} Your look was <b>not</b> saved.</div>`);
      $$(".lore-seen .lore-btn", lookEl).forEach((x) => (x.disabled = false)); busy(b, false);
      setTimeout(() => $$(".lore-alert", lookEl).forEach((a) => a.remove()), 9000);
    } finally { fr.busy = false; }
  }

  /* ---- shareable report image (only from a real scorecard) ---- */
  function ftImage(s) {
    const f = fr.exp, c = s.card, sc = scoreOf(c, "field"), W = 1080, H = 1350, ink = "#10291b";
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const wrap = (text, x, y, maxW, lh, maxLines) => {
      let line = "", n = 0;
      for (const w of String(text).split(/\s+/)) {
        const t = line ? line + " " + w : w;
        if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); y += lh; line = w; if (++n >= maxLines) return y; } else line = t;
      }
      g.fillText(line, x, y); return y + lh;
    };
    g.fillStyle = "#1f5a3d"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#fffaf0"; g.strokeStyle = ink; g.lineWidth = 8; g.beginPath(); g.roundRect(70, 90, W - 140, H - 230, 36); g.fill(); g.stroke();
    g.fillStyle = ink; g.textBaseline = "alphabetic";
    g.font = "700 34px Nunito, system-ui, sans-serif"; g.fillText("LORE LAB · FIELD REPORT", 130, 190);
    g.font = "56px 'Caveat Brush', 'Chalkboard SE', cursive";
    let y = wrap("“" + (f.proverb || "").replace(/\s+/g, " ").slice(0, 140) + "”", 130, 290, W - 260, 70, 4);
    const fill = { promising: "#8aa863", chance: "#fbf6e6", backfires: "#f26a4f" }[sc.verdict] || "#f4d88a";
    g.fillStyle = fill; g.strokeStyle = ink; g.lineWidth = 6; y += 20; g.beginPath(); g.roundRect(130, y, W - 260, 120, 24); g.fill(); g.stroke();
    g.fillStyle = ink; g.font = "800 60px Nunito, system-ui, sans-serif"; g.fillText(VERDICT_TEXT[sc.verdict]?.label || "Result", 170, y + 80); y += 230;
    g.font = "800 120px Nunito, system-ui, sans-serif"; g.fillText(c.hitRate !== null ? pct(c.hitRate) : "–", 130, y);
    g.font = "600 38px Nunito, system-ui, sans-serif"; g.fillText(`hit rate · ${c.hits ?? "?"} of ${c.n}`, 130, y + 56);
    if (c.baseRate !== null) { g.font = "800 120px Nunito, system-ui, sans-serif"; g.fillText(pct(c.baseRate), 640, y); g.font = "600 38px Nunito, system-ui, sans-serif"; g.fillText("bar to beat", 640, y + 56); }
    y += 110;
    if (c.lo !== null && c.hi !== null) {
      const x0 = 130, bw = W - 260;
      g.fillStyle = "rgba(16,41,27,.1)"; g.strokeStyle = ink; g.lineWidth = 4; g.beginPath(); g.roundRect(x0, y, bw, 34, 17); g.fill(); g.stroke();
      g.fillStyle = "#8aa863"; g.beginPath(); g.roundRect(x0 + c.lo * bw, y + 5, Math.max((c.hi - c.lo) * bw, 6), 24, 12); g.fill();
      if (c.baseRate !== null) { g.fillStyle = "#f26a4f"; g.fillRect(x0 + c.baseRate * bw - 4, y - 10, 8, 54); }
      y += 44;
    }
    y += 50; g.fillStyle = ink; g.font = "600 34px Nunito, system-ui, sans-serif";
    wrap(`${plural(c.n, "sighting", "sightings")}${s.days ? ` over ${plural(s.days, "day", "days")}` : ""} · ${f.place || "one place"}. A hint, not proof.`, 130, y, W - 260, 46, 3);
    g.fillStyle = "#fbf6e6"; g.font = "700 40px Nunito, system-ui, sans-serif"; g.fillText("Test your family’s saying: " + location.host, 70, H - 60);
    return cv;
  }
  async function ftShare() {
    const msg = $("#ft-share-msg"), s = ftStats(); if (!s.card) return;
    try {
      try { await Promise.all([document.fonts.load("56px 'Caveat Brush'"), document.fonts.load("800 60px Nunito")]); } catch (_) { /* fall back to system fonts */ }
      const blob = await new Promise((r) => ftImage(s).toBlob(r, "image/png"));
      const file = new File([blob], "lore-lab-field-report.png", { type: "image/png" });
      const data = { files: [file], title: "Lore Lab field report", text: `I put “${fr.exp.proverb}” through a field test.` };
      if (navigator.canShare && navigator.canShare(data)) { await navigator.share(data); msg.textContent = "Shared."; return; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "lore-lab-field-report.png"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      msg.textContent = "Saved the report image to your device.";
    } catch (err) { if (err && err.name !== "AbortError" && msg) msg.textContent = "Couldn’t make the report image on this browser."; }
  }

  /* ---- "Field tests in progress" on step 1 ---- */
  let resumeEl = null;
  function renderResume() {
    const list = ftStore();
    if (!resumeEl) {
      resumeEl = document.createElement("div"); resumeEl.className = "ft-resume"; resumeEl.id = "ft-resume";
      panes[0].insertBefore(resumeEl, $(".lore-intro", panes[0]) || form);
      on(resumeEl, "click", (e) => { const b = e.target.closest("[data-resume]"); const t = b && ftStore().find((x) => String(x.exp.id) === b.dataset.resume); if (t) openSaved(t, true); });
    }
    resumeEl.hidden = !list.length;
    resumeEl.innerHTML = list.length ? `<p class="ft-kick">Field tests in progress</p><ul>${list.slice(0, 4).map((t) => {
      const sn = t.snap || {}, line = sn.looks ? `${sn.sightings} of ${sn.min} sightings · ${plural(sn.looks, "look", "looks")}` : "No looks yet";
      return `<li><span><b>“${esc(t.exp.proverb)}”</b><small>${esc([t.exp.place, line].filter(Boolean).join(" · "))}</small></span><button class="lore-btn lore-btn--butter" type="button" data-resume="${esc(t.exp.id)}">Continue looking</button></li>`;
    }).join("")}</ul>` : "";
  }

  // boot: show remembered tests, open the one a calendar reminder points at, and resolve what's due
  (async function boot() {
    renderResume();
    const want = new URLSearchParams(location.search).get("look");
    if (want) {
      const t = ftStore().find((x) => String(x.exp.id) === want);
      if (t) openSaved(t, false);
      else showAlert("That reminder is for a field test this browser doesn’t know about. Tests are remembered on the device where you started them.", "info");
    }
    if (isConfigured("resolvePending")) { try { await api("resolvePending"); } catch (_) { /* failed looks show as such */ } }
    if (fr.exp) refreshServerData();
  })();

  /* ---------------------------------------------------------
     7. STATEMENT + CLOSING: word reveal and paper-cut grass
     --------------------------------------------------------- */
  (function closing() {
    // split headlines into words (keeps <br> and <mark>), each rises out of a mask
    let n = 0;
    const wrap = (node, i0) => {
      [...node.childNodes].forEach((c) => {
        if (c.nodeType === 3) {
          const frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach((t) => {
            if (!t) return;
            if (/^\s+$/.test(t)) return frag.appendChild(document.createTextNode(" "));
            const w = document.createElement("span"); w.className = "w"; w.setAttribute("aria-hidden", "true");
            const i = document.createElement("span"); i.style.setProperty("--i", n++); i.textContent = t; w.appendChild(i); frag.appendChild(w);
          });
          c.replaceWith(frag);
        } else if (c.nodeType === 1 && c.tagName !== "BR") wrap(c);
      });
    };
    const splits = $$(".lore-split");
    splits.forEach((el) => { n = 0; el.setAttribute("aria-label", el.textContent.replace(/\s+/g, " ").trim()); wrap(el); });
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }), { threshold: 0.3 });
      splits.forEach((el) => io.observe(el)); on(window, "pagehide", () => io.disconnect());
    } else splits.forEach((el) => el.classList.add("is-in"));

    // grass: three cut-paper layers, deterministic so it never reshuffles
    const svg = $("#lore-grass"); if (!svg) return;
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const layers = [
      { cls: "g1", fill: "#8aa863", hMin: 34, hMax: 66, vMin: 22, vMax: 32, wMin: 26, wMax: 48 },
      { cls: "g2", fill: "#3f7d52", hMin: 26, hMax: 52, vMin: 14, vMax: 24, wMin: 22, wMax: 42 },
      { cls: "g3", fill: "#10291b", hMin: 14, hMax: 32, vMin: 6, vMax: 12, wMin: 20, wMax: 38 },
    ];
    svg.innerHTML = layers.map((L) => {
      let d = "M0 100", x = 0;
      while (x < 1200) {
        const w = L.wMin + rnd() * (L.wMax - L.wMin), h = L.hMin + rnd() * (L.hMax - L.hMin), v = L.vMin + rnd() * (L.vMax - L.vMin);
        const tip = x + w / 2 + (rnd() - 0.5) * w * 0.7;
        d += `L${x.toFixed(1)} ${(100 - v).toFixed(1)}L${tip.toFixed(1)} ${(100 - h).toFixed(1)}`; x += w;
      }
      return `<g class="${L.cls}"><path d="${d}L1200 ${(100 - L.vMin).toFixed(1)}L1200 100Z" fill="${L.fill}"/></g>`;
    }).join("");
    // sway only while the closing page is on screen
    const sec = $("#join");
    if ("IntersectionObserver" in window && sec && !reduce) {
      const lv = new IntersectionObserver((es) => es.forEach((e) => sec.classList.toggle("is-live", e.isIntersecting)), { threshold: 0.1 });
      lv.observe(sec); on(window, "pagehide", () => lv.disconnect());
    }
  })();
  /* ---------------------------------------------------------
     8. PAGE ENTRANCES, PROTOCOL TEXT MOTION, EASED NAV SCROLL
     --------------------------------------------------------- */
  (function entrances() {
    const pages = $$(".lore-engine, .lore-arch, .lore-say, .lore-close");
    const enter = (el) => {
      el.classList.add("is-entered");
      if (el.classList.contains("lore-arch")) { const svg = $("svg", el); if (svg) { svg.classList.add("lz-drawing"); setTimeout(() => svg.classList.remove("lz-drawing"), 2800); } }
    };
    if (!("IntersectionObserver" in window)) return pages.forEach(enter);
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { enter(e.target); io.unobserve(e.target); } }), { threshold: 0.2 });
    pages.forEach((p) => io.observe(p)); on(window, "pagehide", () => io.disconnect());
  })();

  (function protocol() {
    const sec = $("#protocol"); if (!sec) return;
    const flow = $(".flow", sec);
    if (flow) $$(":scope > .pn-in", flow).forEach((el, i) => el.style.setProperty("--d", `${i * 0.12}s`));
    $$(".chalk", sec).forEach((c) => c.style.setProperty("--lines", String(c.textContent.replace(/\n+$/, "").split("\n").length)));
    const els = $$(".pn-in", sec);
    if (!("IntersectionObserver" in window)) return els.forEach((e) => e.classList.add("is-in"));
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }), { threshold: 0.18 });
    els.forEach((e) => io.observe(e)); on(window, "pagehide", () => io.disconnect());
  })();

  // nav clicks glide with an ease-in-out curve; any wheel/touch/key press hands control back
  (function glide() {
    const root = document.documentElement; let cancel = false;
    ["wheel", "touchstart", "keydown"].forEach((ev) => on(window, ev, () => { cancel = true; }, { passive: true }));
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    on(document, "click", (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      const id = a.getAttribute("href"); if (id.length < 2) return;
      const t = document.querySelector(id); if (!t) return;
      e.preventDefault();
      const pad = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
      const from = window.scrollY, to = Math.max(0, t.getBoundingClientRect().top + from - pad);
      history.replaceState(null, "", id);
      if (reduce) { window.scrollTo(0, to); return; }
      const dist = to - from, dur = Math.min(1500, Math.max(700, Math.abs(dist) * 0.3));
      let t0 = null; cancel = false; root.style.scrollBehavior = "auto";
      const step = (ts) => {
        if (t0 === null) t0 = ts;
        const p = Math.min((ts - t0) / dur, 1);
        if (!cancel) window.scrollTo(0, from + dist * ease(p));
        if (p < 1 && !cancel) requestAnimationFrame(step); else root.style.scrollBehavior = "";
      };
      requestAnimationFrame(step);
    });
  })();
})();

/* =========================================================
   Lore Lab · quickrun.js  (loaded after lore.js)
   1. One tap on a hero chip runs the real pipeline: extract -> confirm -> backtest -> result card.
   2. Proof strip + example card: shown ONLY when the backend returns real numbers.
   3. Return hooks: look streak, 7-day reminder (.ics), shareable result image.
   Nothing here invents data. Presets are disclosed on the result and can be changed.
   To undo: remove the <script> and <link> for this file (and the #quick-result section).
   ========================================================= */
(() => {
  "use strict";
  const LL = window.LoreLab;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const out = $("#qr-out"), proof = $("#qr-proof"), example = $("#qr-example");
  if (!LL || !LL.api || !out) return;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
  };
  let running = false, last = null; // last = { h, c, preset, loc }

  const cityLoc = (n) => ({ label: n, lat: LL.CITIES[n][0], lon: LL.CITIES[n][1] });
  const place = () => {
    try {
      const o = JSON.parse(store.get("loreQuickLoc"));
      if (o && o.label && Number.isFinite(o.lat) && Number.isFinite(o.lon)) return o;
    } catch (_) { /* none saved */ }
    const old = store.get("loreQuickPlace"); // earlier versions saved just a city name
    return LL.CITIES[old] ? cityLoc(old) : null;
  };
  const savePlace = (loc) => store.set("loreQuickLoc", JSON.stringify(loc));
  // One-time question: device location, or a city picker. The answer is remembered in this browser only.
  function askPlace() {
    return new Promise((resolve) => {
      clearInterval(tick);
      const opts = Object.keys(LL.CITIES).map((n) => `<option>${esc(n)}</option>`).join("");
      out.hidden = false;
      out.innerHTML = `<div class="qr-box"><p class="qr-kick">One quick thing</p><h3>Where should we check the weather?</h3>
        <p>We look up ten years of weather for one spot. Your location stays in this browser and is only used to choose that spot.</p>
        <div class="qr-actions"><button class="qr-btn qr-btn--coral" type="button" id="qr-geo">Use my location</button></div>
        <p class="qr-used"><label>Or pick a city: <select id="qr-pickcity"><option value="">Choose…</option>${opts}</select></label></p>
        <p class="qr-note" id="qr-geonote" role="status"></p></div>`;
      const note = (t) => { $("#qr-geonote").textContent = t; };
      const done = (loc) => { savePlace(loc); resolve(loc); };
      $("#qr-pickcity").addEventListener("change", (e) => { if (LL.CITIES[e.target.value]) done(cityLoc(e.target.value)); });
      $("#qr-geo").addEventListener("click", () => {
        if (!navigator.geolocation) return note("This browser can’t share a location. Pick a city instead.");
        note("Asking your device…");
        navigator.geolocation.getCurrentPosition(
          (p) => done({ label: "Your location", lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2) }),
          () => { note("Location wasn’t shared. Pick a city instead."); $("#qr-pickcity").focus(); },
          { timeout: 10000 });
      });
    });
  }
  function waitMsg(msg) {
    clearInterval(tick);
    out.hidden = false;
    out.innerHTML = `<div class="qr-wait" role="status"><i aria-hidden="true"></i><span>${esc(msg)}</span></div>`;
  }

  /* ---------- progress / errors ---------- */
  const STEPS = ["Reading the saying", "Setting up the test", "Pulling ten years of weather"];
  const DEFAULT_SECS = [4, 3, 8]; // first-run guesses; replaced by what this device actually saw
  const learned = () => { try { const a = JSON.parse(store.get("loreStepSecs")); if (Array.isArray(a) && a.length === 3) return a; } catch (_) {} return DEFAULT_SECS; };
  let tick = null, stepAt = [], stepStart = 0;
  function progress(step) { // step: 0, 1 or 2
    const now = Date.now();
    if (step === 0) { stepAt = []; clearInterval(tick); }
    stepAt[step] = now; stepStart = stepAt[0];
    const est = learned(), total = est.reduce((a, b) => a + b, 0);
    out.hidden = false;
    out.innerHTML = `<div class="qr-wait qr-steps" role="status" aria-live="polite">
      <ol>${STEPS.map((s, i) => `<li class="${i < step ? "is-done" : i === step ? "is-now" : ""}"><i aria-hidden="true"></i>${esc(s)}${i === step ? "…" : ""}</li>`).join("")}</ol>
      <p class="qr-eta" id="qr-eta"></p></div>`;
    const eta = $("#qr-eta");
    const paint = () => {
      const el = Math.round((Date.now() - stepStart) / 1000), left = Math.max(0, total - el);
      eta.textContent = left > 0 ? `Step ${step + 1} of 3 · about ${left} second${left === 1 ? "" : "s"} left` : `Step ${step + 1} of 3 · taking a bit longer than usual (${el}s)`;
    };
    paint(); clearInterval(tick); tick = setInterval(paint, 1000);
  }
  function stopProgress(ok) {
    clearInterval(tick);
    if (!ok || stepAt.length < 3) return;
    const t = Date.now(), s = [stepAt[1] - stepAt[0], stepAt[2] - stepAt[1], t - stepAt[2]].map((x) => Math.max(1, Math.round(x / 1000)));
    const old = learned(); store.set("loreStepSecs", JSON.stringify(s.map((x, i) => Math.round((x + old[i]) / 2))));
  }
  function fail(err, retry) {
    stopProgress(false);
    const d = LL.describeError(err);
    out.hidden = false;
    out.innerHTML = `<div class="qr-box"><h3>${esc(d.title)}</h3><p>${esc(d.msg)}</p>
      <div class="qr-actions">${retry ? `<button class="qr-btn qr-btn--coral" type="button" id="qr-retry">Try again</button>` : ""}
      <a class="qr-btn qr-btn--ghost" href="#engine" data-scroll>Type it in the lab instead</a></div></div>`;
    const b = $("#qr-retry"); if (b) b.addEventListener("click", retry, { once: true });
  }
  function scrollTo(el) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }

  /* ---------- the one-tap run ---------- */
  async function run(text) {
    if (running) return;
    running = true;
    document.querySelectorAll("[data-quick]").forEach((a) => a.setAttribute("aria-disabled", "true"));
    progress(0);
    scrollTo($("#quick-result"));
    try {
      const h = LL.normHyp(await LL.api("extractHypothesis", { text, source: "Folk saying", language: null }));
      if (!h.original) h.original = text;
      if (!h.sign.text) throw new LL.ApiError(502, "The hypothesis service returned something unreadable.");

      // The engine asks the user to settle ambiguities, accept rough matches and pick the number.
      // A quick run can only skip those when there is nothing to settle and an engine preset exists.
      const guide = h.testMode === "field" ? null : LL.thresholdGuide(h.proxy);
      const preset = guide && guide.chips.length ? guide.chips[Math.min(1, guide.chips.length - 1)] : null;
      const needsYou = h.ambiguities.length > 0 || h.proxy?.fit === "rough" || (h.testMode !== "field" && !preset);
      if (needsYou) {
        out.innerHTML = `<div class="qr-box"><h3>This one needs a quick decision from you</h3>
          <p>Before it can be tested fairly, you have to settle a detail (a word that could mean two things, a rough match, or the number that counts as “the sign”). I’ve opened it in the lab for you.</p></div>`;
        LL.openReview(h); scrollTo($("#engine")); return;
      }

      progress(1);
      const payload = {
        hypothesis_id: h.id,
        edits: { observable_sign: h.sign.text, how_to_observe: h.sign.how, predicted_outcome: h.prediction.outcome, window_hours: h.prediction.windowHours },
        threshold: preset ? { value: Number(preset[1]), unit: guide.unit || null } : null,
        ambiguity_resolutions: [], rough_match_accepted: null,
      };
      const c = LL.normConfirm(await LL.api("confirmHypothesis", payload, { id: h.id }));
      if (!c.testMode) throw new LL.ApiError(502, "The server confirmed the hypothesis but didn’t say whether it is a Lab Test or a Field Test.");
      h.id = c.id ?? h.id;
      if (c.observeWhen) h.sign.when = c.observeWhen;

      if (c.testMode === "lab") {
        let loc = place();
        if (!loc) { const t0 = Date.now(); loc = await askPlace(); const d = Date.now() - t0; stepAt[0] += d; stepAt[1] += d; }
        progress(2);
        const card = await backtest(h, loc);
        stopProgress(true);
        last = { h, c, preset: preset ? { label: preset[0], value: preset[1], unit: guide.unit, q: guide.q } : null, loc, card };
        render();
      } else {
        last = { h, c, preset: null, loc: null, card: { mode: "field", proverb: h.original, source: h.source, n: 0, looks: 0, min: null, notes: [] } };
        render();
      }
    } catch (err) { fail(err, () => run(text)); }
    finally { running = false; document.querySelectorAll("[data-quick]").forEach((a) => a.removeAttribute("aria-disabled")); }
  }

  async function backtest(h, loc) {
    const c = LL.normCard(await LL.api("runBacktest", { hypothesis_id: h.id, location: loc }, { id: h.id }));
    c.mode = "lab"; c.place = c.place || loc.label || null; c.proverb = c.proverb || h.original; c.source = c.source ?? h.source;
    return c;
  }

  /* ---------- result render ---------- */
  function render() {
    const { h, c, preset, loc, card } = last;
    const lab = c.testMode === "lab";
    const cities = (loc && !LL.CITIES[loc.label] ? `<option value="__cur" selected>${esc(loc.label)}</option>` : "")
      + Object.keys(LL.CITIES).map((n) => `<option${loc && n === loc.label ? " selected" : ""}>${esc(n)}</option>`).join("");
    const used = lab
      ? `<p class="qr-used"><b>Quick run used:</b> “${esc(preset.label)}” (${esc(preset.value)}${preset.unit ? " " + esc(preset.unit) : ""}) for the sign, tested for
          <select id="qr-city" aria-label="Place">${cities}</select>.
          Those two choices are presets. <a href="#engine" id="qr-tune">Choose your own number</a> if you’d rather.</p>`
      : `<p class="qr-used">Weather instruments can’t see this sign, so it can’t be checked against past weather. It needs someone looking. That’s you, outside.</p>`;
    out.hidden = false;
    out.innerHTML = `<div class="qr-box">
      <p class="qr-kick">Your result</p>
      <div id="qr-card">${lab ? LL.resultHTML(card, { h, th: preset ? { value: preset.value, unit: preset.unit, preset: true } : null, actions: false }) : LL.cardHTML(card)}</div>
      ${used}
      <div class="qr-actions">
        ${lab ? `<button class="qr-btn qr-btn--coral" type="button" id="qr-share">Share this result</button>` : `<button class="qr-btn qr-btn--coral" type="button" id="qr-start">Pick a place and start looking</button>`}
        <button class="qr-btn" type="button" id="qr-remind">Remind me to look up (7 days)</button>
        <a class="qr-btn qr-btn--ghost" href="#engine" id="qr-own">Test your own saying</a>
      </div>
      <p class="qr-note" id="qr-msg" role="status"></p>
    </div>`;
    $("#qr-own").onclick = () => store.set("loreQuickSeen", "1");
    $("#qr-tune")?.addEventListener("click", (e) => { e.preventDefault(); LL.openReview(h); scrollTo($("#engine")); });
    $("#qr-start")?.addEventListener("click", () => { LL.openTest(h, c); scrollTo($("#engine")); });
    $("#qr-share")?.addEventListener("click", share);
    $("#qr-remind").addEventListener("click", remind);
    $("#qr-city")?.addEventListener("change", async (e) => {
      if (!LL.CITIES[e.target.value]) return;
      const loc2 = cityLoc(e.target.value); savePlace(loc2);
      waitMsg("Re-checking for " + e.target.value + "…");
      try { last.loc = loc2; last.card = await backtest(last.h, loc2); render(); } catch (err) { fail(err); }
    });
    refreshStreak();
  }

  /* ---------- share: draw the result to a canvas, share the PNG ---------- */
  function wrap(ctx, text, x, y, maxW, lh, maxLines) {
    const words = String(text).split(/\s+/); let line = "", n = 0;
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = w; if (++n >= maxLines) return y; } else line = t;
    }
    ctx.fillText(line, x, y); return y + lh;
  }
  function makeImage() {
    const { card } = last, W = 1080, H = 1350, ink = "#10291b";
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    g.fillStyle = "#1f5a3d"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#fffaf0"; g.strokeStyle = ink; g.lineWidth = 8;
    g.beginPath(); g.roundRect(70, 90, W - 140, H - 230, 36); g.fill(); g.stroke();
    g.fillStyle = ink; g.textBaseline = "alphabetic";
    g.font = "700 34px Nunito, system-ui, sans-serif"; g.fillText("LORE LAB · LAB TEST", 130, 190);
    g.font = "56px 'Caveat Brush', 'Chalkboard SE', cursive";
    let y = wrap(g, "“" + (card.proverb || "").replace(/\s+/g, " ").slice(0, 140) + "”", 130, 290, W - 260, 70, 4);
    const v = $("#qr-card .lore-verdict span")?.textContent || "";
    g.fillStyle = "#8aa863"; g.strokeStyle = ink; g.lineWidth = 6; y += 20;
    g.beginPath(); g.roundRect(130, y, W - 260, 120, 24); g.fill(); g.stroke();
    g.fillStyle = ink; g.font = "800 60px Nunito, system-ui, sans-serif"; g.fillText(v, 170, y + 80); y += 220;
    const pct = (x) => (x == null ? "–" : Math.round(x * 100) + "%");
    const enough = card.hitRate != null;
    g.font = "800 120px Nunito, system-ui, sans-serif"; g.fillText(enough ? pct(card.hitRate) : String(card.n ?? 0), 130, y);
    g.font = "600 38px Nunito, system-ui, sans-serif";
    g.fillText(enough ? "hit rate" : "sign-present days so far", 130, y + 56);
    if (card.baseRate != null) { g.font = "800 120px Nunito, system-ui, sans-serif"; g.fillText(pct(card.baseRate), 600, y); g.font = "600 38px Nunito, system-ui, sans-serif"; g.fillText("bar to beat", 600, y + 56); }
    y += 150; g.font = "600 34px Nunito, system-ui, sans-serif";
    y = wrap(g, `${card.place || "One place"} · about ten years of past weather. One place is a hint, not proof.`, 130, y, W - 260, 46, 3);
    g.fillStyle = "#fbf6e6"; g.font = "700 40px Nunito, system-ui, sans-serif";
    g.fillText("Test your family’s saying: " + location.host, 70, H - 60);
    return cv;
  }
  async function share() {
    const msg = $("#qr-msg");
    try {
      const cv = makeImage();
      const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
      const file = new File([blob], "lore-lab-result.png", { type: "image/png" });
      const data = { files: [file], title: "Lore Lab", text: "I tested an old weather saying against ten years of data." };
      if (navigator.canShare && navigator.canShare(data)) { await navigator.share(data); msg.textContent = "Shared."; return; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "lore-lab-result.png"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      msg.textContent = "Saved the result image to your device.";
    } catch (err) { if (err && err.name !== "AbortError") msg.textContent = "Couldn’t make the share image on this browser."; }
  }

  /* ---------- reminder: a 7-day calendar event at 18:00 (works with no notifications permission) ---------- */
  const fold = (l) => { let o = "", b = 0, cur = ""; for (const ch of l) { const n = new TextEncoder().encode(ch).length; if (b + n > 74) { o += cur + "\r\n "; cur = ""; b = 1; } cur += ch; b += n; } return o + cur; };
  const icsText = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const stamp = (d, t) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}T${t}`;
  function remind() {
    const { h } = last, now = new Date(), start = new Date(now);
    if (now.getHours() >= 18) start.setDate(start.getDate() + 1);
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lore Lab//Reminder//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
      `UID:lorelab-${Date.now()}@lorelab`, `DTSTAMP:${now.toISOString().replace(/[-:]|\.\d{3}/g, "")}`,
      `DTSTART:${stamp(start, "180000")}`, "DURATION:PT10M", "RRULE:FREQ=DAILY;COUNT=7",
      `SUMMARY:${icsText("Look at the sky: " + (h.sign.text || h.original).slice(0, 80))}`,
      `DESCRIPTION:${icsText("Look up for 5 seconds, then log Seen or Not seen in Lore Lab. Put your phone away.")}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Look up", "TRIGGER:PT0M", "END:VALARM", "END:VEVENT", "END:VCALENDAR"];
    const blob = new Blob([lines.map(fold).join("\r\n") + "\r\n"], { type: "text/calendar" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "lore-lab-look-up.ics"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    $("#qr-msg").textContent = "Calendar file saved. Open it to add a daily 6 pm look-up for a week.";
  }

  /* ---------- streak: consecutive days with at least one logged look ---------- */
  let streak = 0;
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  async function loadStreak() {
    if (!LL.isConfigured("listObservations")) return;
    try {
      const r = await LL.api("listObservations");
      const list = Array.isArray(r) ? r : r.observations || [];
      const days = new Set(list.map((o) => { const d = new Date(o.observed_at); return isNaN(d) ? null : dayKey(d); }).filter(Boolean));
      const d = new Date(); if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1); // today not yet looked: streak still alive until midnight
      streak = 0; while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
    } catch (_) { streak = 0; }
  }
  async function refreshStreak() { await loadStreak(); renderProof(window.__qrStats || null); }

  /* ---------- proof strip + example card (only with real backend data) ---------- */
  function renderProof(st) {
    const items = [];
    if (st) {
      if (st.sayings > 0) items.push([st.sayings.toLocaleString(), st.sayings === 1 ? "saying tested" : "sayings tested"]);
      if (st.days > 0) items.push([st.days.toLocaleString(), "days of weather checked"]);
      if (st.looks > 0) items.push([st.looks.toLocaleString(), st.looks === 1 ? "outdoor look logged" : "outdoor looks logged"]);
    }
    if (streak > 0) items.push([String(streak), streak === 1 ? "day look streak" : "day look streak"]);
    proof.hidden = !items.length;
    proof.innerHTML = items.map(([n, l]) => `<div><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join("");
  }
  async function loadProof() {
    if (LL.isConfigured("stats")) {
      try {
        const r = await LL.api("stats"), n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        window.__qrStats = { sayings: n(r.sayings_tested ?? r.sayings), days: n(r.days_checked ?? r.days), looks: n(r.looks_logged ?? r.looks) };
      } catch (_) { /* strip stays hidden */ }
    }
    await loadStreak();
    renderProof(window.__qrStats || null);
    if (LL.isConfigured("exampleResult")) {
      try {
        const card = LL.normCard(await LL.api("exampleResult"));
        if (card.proverb && card.mode) { example.hidden = false; example.innerHTML = `<p class="qr-kick">A real result from the lab</p>${LL.cardHTML(card)}`; }
      } catch (_) { /* no example shown */ }
    }
  }

  /* ---------- wiring ---------- */
  document.querySelectorAll("[data-quick]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    if (a.getAttribute("aria-disabled") === "true") return;
    run(a.dataset.quick);
  }));
  out.addEventListener("click", (e) => { const l = e.target.closest("[data-scroll]"); if (l) { e.preventDefault(); scrollTo($("#engine")); } });
  loadProof();
})();