/* =========================================================
   Lore Lab · Experiment Engine, System Architecture, Field Report
   Vanilla JS. Loaded after script.js. Touches only #engine, #architecture
   and #field-reports (everything is scoped to .lore sections).

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
    "submitObservation", "resolvePending", "listObservations", "scorecards",
  ];
  ENDPOINTS.forEach((k) => { if (!(k in CONFIG.endpoints)) CONFIG.endpoints[k] = null; });

  class NotConfigured extends Error { constructor(name) { super(`Endpoint "${name}" is not configured`); this.name = "NotConfigured"; this.endpoint = name; } }
  class ApiError extends Error { constructor(status, detail) { super(detail || `HTTP ${status}`); this.name = "ApiError"; this.status = status; } }
  const isConfigured = (name) => CONFIG.apiBase !== null && !!CONFIG.endpoints[name];

  async function api(name, payload, params) {
    const ep = CONFIG.endpoints[name];
    if (CONFIG.apiBase === null || !ep) throw new NotConfigured(name);
    const method = (ep.method || "POST").toUpperCase();
    const path = ep.path.replace(/:(\w+)/g, (_, k) => encodeURIComponent((params || {})[k] ?? ""));
    const res = await fetch(String(CONFIG.apiBase).replace(/\/$/, "") + path, {
      method,
      headers: { Accept: "application/json", ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
      body: method === "GET" ? undefined : JSON.stringify(payload ?? {}),
    });
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
      proxy: proxy ? { variable: proxy.variable ?? null, fit: proxy.fit ?? null, rationale: proxy.rationale ?? null, unit: proxy.unit ?? "" } : null,
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
    };
  }
  function normField(r, hyp, loc) {
    return {
      id: r?.experiment_id ?? r?.id ?? null, proverb: hyp?.original || "", sign: hyp?.sign.text || "", how: hyp?.sign.how || "",
      when: r?.observe_when ?? hyp?.sign.when ?? "", place: loc?.label || r?.location_label || "",
    };
  }

  /* ---------------------------------------------------------
     2. SHARED UI HELPERS
     --------------------------------------------------------- */
  function describeError(err) {
    if (err instanceof NotConfigured) return { title: "The lab isn’t connected yet", msg: "This page has no backend address for that action, so nothing was sent and nothing was invented. Configure LORE_CONFIG (see INTEGRATION.md)." };
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

  function cardHTML(c) {
    const mode = c.mode === "lab" || c.mode === "field" ? c.mode : null;
    const min = c.min ?? (mode ? MIN_N[mode] : null);
    const unit = mode === "lab" ? "days" : "looks";
    const n = c.n ?? 0;
    const enough = min !== null && c.n !== null && n >= min;
    const empty = !enough && n === 0 && !(c.looks > 0);
    let verdict = null;
    if (!enough) verdict = "trail"; // below the minimum the only honest label is "On the trail"
    else if (c.verdict) verdict = c.verdict;
    else if (c.lo !== null && c.hi !== null && c.baseRate !== null) verdict = c.lo > c.baseRate ? "promising" : c.hi < c.baseRate ? "backfires" : "chance";

    let body = "";
    if (!enough) {
      const need = min !== null ? Math.max(min - n, 0) : null;
      body += min !== null ? tallySVG(n, min) : "";
      body += empty
        ? `<p>A blank page, waiting for its first ${mode === "lab" ? "sign-present day" : "look"}.</p>`
        : `<p><b>${n}</b> ${mode === "lab" ? "sign-present days" : "sign-present looks"} so far${c.hits !== null ? `, and the predicted weather followed <b>${c.hits}</b> of them` : ""}.</p>`;
      if (c.pending) body += `<p class="lore-pend">${c.pending} still pending, not counted yet.</p>`;
      if (need !== null) body += `<p class="lore-next">${need} more ${unit} with the sign before a hit rate or verdict can be shown.</p>`;
      if (c.baseRate !== null) body += `<div class="lore-nums"><div><b>${pct(c.baseRate)}</b><small>bar to beat (how often it happens anyway)</small></div></div>`;
    } else {
      body += `<div class="lore-nums">
        <div><b>${c.hitRate !== null ? pct(c.hitRate) : "–"}</b><small>hit rate · ${c.hits !== null ? `${c.hits} of ${n}` : `n = ${n}`} ${unit}</small></div>
        <div><b>${c.baseRate !== null ? pct(c.baseRate) : "–"}</b><small>bar to beat</small></div>
        ${c.lift !== null ? `<div><b>×${c.lift.toFixed(2)}</b><small>lift</small></div>` : ""}</div>`;
      if (c.lo !== null && c.hi !== null) {
        body += `<div class="lore-bar" role="img" aria-label="Interval ${pct(c.lo)} to ${pct(c.hi)}${c.baseRate !== null ? `, bar to beat ${pct(c.baseRate)}` : ""}">
          <span class="ci" style="left:${c.lo * 100}%;width:${Math.max((c.hi - c.lo) * 100, 1)}%"></span>${c.baseRate !== null ? `<span class="base" style="left:${c.baseRate * 100}%"></span>` : ""}</div>
          <p class="lore-pend">Interval ${pct(c.lo)}–${pct(c.hi)} · n = ${n} · coral line = bar to beat</p>`;
      }
    }
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
      <p>${esc(plain)}</p>
      ${next ? `<p class="lore-next">${esc(next)}</p>` : ""}
      <p class="lore-caveat">One place and a short history is a hint, not proof.${where ? " " + esc(where) : ""}</p></article>`;
  }

  /* ---------------------------------------------------------
     4. EXPERIMENT ENGINE
     --------------------------------------------------------- */
  const S = (window.LoreLab = { config: CONFIG, hyp: null, mode: null, field: null, location: null });
  const eng = { step: 1, max: 1, busy: false, hyp: null, confirmed: null };
  const panes = [1, 2, 3, 4].map((n) => $(`#lore-p${n}`));
  const tabs = [1, 2, 3, 4].map((n) => $(`#lore-tab-${n}`));
  const STEP_NAMES = ["Saying", "Hypothesis", "Test", "Result"];

  function go(n, focus = true) {
    eng.step = n; eng.max = Math.max(eng.max, n);
    panes.forEach((p, i) => { p.hidden = i + 1 !== n; });
    tabs.forEach((t, i) => {
      t.disabled = i + 1 > eng.max;
      t.classList.toggle("is-active", i + 1 === n);
      t.classList.toggle("is-done", i + 1 < eng.max && i + 1 !== n);
      t.setAttribute("aria-selected", String(i + 1 === n));
      t.tabIndex = i + 1 === n ? 0 : -1;
    });
    clearAlert();
    if (focus) { const h = panes[n - 1].querySelector("h3"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
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
    finally { eng.busy = false; busy(btn, false); }
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

  /* Step 2: review + edit */
  on(panes[1], "input", () => eng.valid && eng.valid()); on(panes[1], "change", () => eng.valid && eng.valid());
  function renderHyp(h) {
    const fit = h.proxy?.fit, rough = fit === "rough", hasProxy = !!h.proxy?.variable && fit && fit !== "none";
    const lab = h.testMode === "lab" || h.backtestable === true;
    const chips = [
      h.language && `<li>${esc(h.language)}</li>`,
      h.sign.kind && `<li>Sign: ${esc(h.sign.kind)}</li>`,
      hasProxy && `<li class="${rough ? "is-rough" : "is-good"}">${rough ? "Rough match" : "Good match"}: ${esc(h.proxy.variable)}</li>`,
      h.testMode && `<li>Code’s call: ${h.testMode === "lab" ? "Lab Test" : "Field Test"}</li>`,
    ].filter(Boolean).join("");
    const amb = h.ambiguities.map((a, i) => `<div class="lore-ambig"><p>${esc(a.text)}</p>${a.options && a.options.length
      ? `<select class="lore-field" data-amb="${i}" aria-label="Settle: ${esc(a.text)}"><option value="">Choose…</option>${a.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`
      : `<input class="lore-field" data-amb="${i}" type="text" aria-label="Settle: ${esc(a.text)}" placeholder="Say what you mean">`}</div>`).join("");
    panes[1].innerHTML = `
      <h3>Does this say what you meant?</h3>
      <p class="lore-intro">Gemma proposed this. Nothing is tested until you confirm it, and you can edit anything.</p>
      <blockquote class="lore-orig">${esc(h.original)}<small>${h.translation ? `In English: ${esc(h.translation)}` : ""}${h.source ? ` · Said by ${esc(h.source)}` : ""}</small></blockquote>
      ${chips ? `<ul class="lore-meta">${chips}</ul>` : ""}
      <div class="lore-grid2">
        <div><label for="lh-sign">The sign to look for</label><textarea class="lore-field" id="lh-sign" rows="3">${esc(h.sign.text)}</textarea></div>
        <div><label for="lh-how">How to observe it</label><textarea class="lore-field" id="lh-how" rows="3">${esc(h.sign.how)}</textarea></div>
        <div><label for="lh-outcome">Predicted weather</label><input class="lore-field" id="lh-outcome" type="text" value="${esc(h.prediction.outcome)}"></div>
        <div><label for="lh-window">Time window (hours)</label><input class="lore-field" id="lh-window" type="number" min="1" step="1" inputmode="numeric" value="${h.prediction.windowHours ?? ""}"></div>
      </div>
      ${lab ? `<fieldset class="lore-fieldset"><legend>Your threshold</legend>
        <div class="lore-grid2"><div><label for="lh-th">${esc(h.proxy?.variable || "Value")} counts as “the sign” when it reaches</label><input class="lore-field" id="lh-th" type="number" step="any" inputmode="decimal" required placeholder="A number you choose"></div>
        <div><label for="lh-unit">Unit</label><input class="lore-field" id="lh-unit" type="text" value="${esc(h.proxy?.unit || "")}" placeholder="e.g. hPa"></div></div>
        <p class="lore-help">The model never picks this number. You do.</p></fieldset>` : ""}
      ${rough ? `<fieldset class="lore-fieldset lore-fieldset--warn"><legend>Rough match</legend>
        <label class="lore-check"><input type="checkbox" id="lh-rough"><span>I understand weather data only roughly approximates this sign, and I’m happy to test it that way.</span></label></fieldset>` : ""}
      ${h.ambiguities.length ? `<fieldset class="lore-fieldset"><legend>Needs your call</legend>${amb}</fieldset>` : ""}
      ${h.proxy?.rationale ? `<details class="lore-why"><summary>Why this weather variable?</summary><p>${esc(h.proxy.rationale)}</p></details>` : ""}
      <p class="lore-decides"><b>Gemma proposes. Code decides.</b> Whether this can be backtested is computed by plain code from a whitelist, not guessed by the model.</p>
      <div class="lore-actions"><button class="lore-btn lore-btn--coral" id="lh-confirm" type="button" disabled>Confirm this hypothesis</button>
        <button class="lore-btn lore-btn--ghost" type="button" data-go="1">Rewrite the saying</button></div>`;
    const confirm = $("#lh-confirm", panes[1]);
    const valid = () => {
      const okAmb = $$("[data-amb]", panes[1]).every((x) => x.value.trim());
      const okRough = !rough || $("#lh-rough", panes[1]).checked;
      const okTh = !lab || ($("#lh-th", panes[1]).value !== "" && Number.isFinite(Number($("#lh-th", panes[1]).value)));
      const okSign = $("#lh-sign", panes[1]).value.trim() && $("#lh-how", panes[1]).value.trim();
      confirm.disabled = eng.busy || !(okAmb && okRough && okTh && okSign);
    };
    eng.valid = valid; valid();
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
        h.id = c.id ?? h.id; eng.confirmed = c; S.mode = c.testMode; renderTest(h, c.testMode); go(3);
      } catch (err) { showAlert(err); }
      finally { eng.busy = false; busy(confirm, false); valid(); }
    });
  }

  /* Step 3: Lab vs Field */
  const ICON_LAB = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 6h12M21 6v14L9 40a3 3 0 0 0 3 4h24a3 3 0 0 0 3-4L27 20V6" fill="#fbf6e6" stroke="#10291b" stroke-width="3" stroke-linejoin="round"/><path d="M14 33h20" stroke="#10291b" stroke-width="3"/></svg>';
  const ICON_FIELD = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="9" fill="#f4d88a" stroke="#10291b" stroke-width="3"/><path d="M24 4v7M24 37v7M4 24h7M37 24h7M10 10l5 5M33 33l5 5M38 10l-5 5M15 33l-5 5" stroke="#10291b" stroke-width="3" stroke-linecap="round"/></svg>';
  function locationBlock() {
    return `<fieldset class="lore-fieldset"><legend>Where?</legend>
      <div class="lore-loc"><div><label for="ll-label">Place name</label><input class="lore-field" id="ll-label" type="text" placeholder="e.g. my balcony" autocomplete="off"></div>
      <div><label for="ll-lat">Latitude</label><input class="lore-field" id="ll-lat" type="number" step="any" min="-90" max="90" inputmode="decimal"></div>
      <div><label for="ll-lon">Longitude</label><input class="lore-field" id="ll-lon" type="number" step="any" min="-180" max="180" inputmode="decimal"></div></div>
      <div class="lore-actions" style="margin-top:.8em"><button class="lore-btn lore-btn--ghost" type="button" id="ll-geo">Use my current location</button></div>
      <p class="lore-help" id="ll-note">Weather is looked up for this one spot.</p></fieldset>`;
  }
  function readLocation() {
    const lat = num($("#ll-lat").value), lon = num($("#ll-lon").value);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) { showAlert("Enter a valid latitude and longitude, or use your current location.", "info"); return null; }
    return (S.location = { label: $("#ll-label").value.trim(), lat, lon });
  }
  function wireGeo() {
    on($("#ll-geo"), "click", () => {
      if (!navigator.geolocation) return ($("#ll-note").textContent = "This browser can’t share a location. Enter coordinates instead.");
      $("#ll-note").textContent = "Asking your device…";
      navigator.geolocation.getCurrentPosition(
        (p) => { $("#ll-lat").value = p.coords.latitude.toFixed(4); $("#ll-lon").value = p.coords.longitude.toFixed(4); $("#ll-note").textContent = "Got it. Weather is looked up for this one spot."; },
        () => { $("#ll-note").textContent = "Location wasn’t shared. Enter coordinates instead."; }, { timeout: 10000 });
    });
  }
  function renderTest(h, mode) {
    $("#lore-side-mode").hidden = false; $("#lore-side-badge").textContent = mode === "lab" ? "Lab Test" : "Field Test";
    if (mode === "lab") {
      const rough = h.proxy?.fit === "rough";
      panes[2].innerHTML = `
        <div class="lore-mode lore-mode--lab">${ICON_LAB}<div><span class="lore-tag">Lab Test</span><h3>This one shows up in the weather data.</h3>
        <p>Approximated by <b>${esc(h.proxy?.variable || "a supported weather variable")}</b> (${rough ? "a rough match" : "a good match"}). We score it against about ten years of Open-Meteo history for your spot: a big sample, modelled reanalysis rather than station readings.</p></div></div>
        ${locationBlock()}
        <div class="lore-actions"><button class="lore-btn lore-btn--coral" id="ll-run" type="button">Run the backtest</button><button class="lore-btn lore-btn--ghost" type="button" data-go="2">Back to the hypothesis</button></div>`;
      wireGeo(); on($('[data-go="2"]', panes[2]), "click", () => go(2));
      on($("#ll-run"), "click", async (e) => {
        if (eng.busy) return; const loc = readLocation(); if (!loc) return;
        const btn = e.currentTarget; eng.busy = true; busy(btn, true); clearAlert();
        try {
          const c = normCard(await api("runBacktest", { hypothesis_id: h.id, location: loc }, { id: h.id }));
          c.mode = "lab"; c.place = c.place || loc.label || null; c.proverb = c.proverb || h.original; c.source = c.source ?? h.source;
          renderLabResult(c); go(4);
        } catch (err) { showAlert(err); }
        finally { eng.busy = false; busy(btn, false); }
      });
    } else {
      panes[2].innerHTML = `
        <div class="lore-mode lore-mode--field">${ICON_FIELD}<div><span class="lore-tag">Field Test</span><p class="lore-fieldnote">Tonight, you’re the instrument.</p>
        <p>No weather dataset records <b>${esc(h.sign.text || "this sign")}</b>, so it needs a person looking. ${h.sign.how ? esc(h.sign.how) : ""}</p></div></div>
        ${locationBlock()}
        <div class="lore-actions"><button class="lore-btn lore-btn--coral" id="ll-start" type="button">Start the field test</button><button class="lore-btn lore-btn--ghost" type="button" data-go="2">Back to the hypothesis</button></div>`;
      wireGeo(); on($('[data-go="2"]', panes[2]), "click", () => go(2));
      on($("#ll-start"), "click", async (e) => {
        if (eng.busy) return; const loc = readLocation(); if (!loc) return;
        const btn = e.currentTarget; eng.busy = true; busy(btn, true); clearAlert();
        try {
          const f = normField(await api("startFieldTest", { hypothesis_id: h.id, location: loc }, { id: h.id }), h, loc);
          if (!f.id) throw new ApiError(502, "The server started the field test but didn’t return an experiment to log looks against.");
          S.field = f; document.dispatchEvent(new CustomEvent("lore:field", { detail: f })); renderFieldReady(f); go(4);
        } catch (err) { showAlert(err); }
        finally { eng.busy = false; busy(btn, false); }
      });
    }
  }

  /* Step 4 */
  function renderLabResult(c) {
    panes[3].innerHTML = `<h3>Here’s what the weather history says.</h3><p class="lore-intro">Lab Test results stay on their own page. They’re never mixed with outdoor looks.</p>${cardHTML(c)}
      <div class="lore-actions"><button class="lore-btn lore-btn--sage" type="button" data-act="again">Test another saying</button><button class="lore-btn lore-btn--ghost" type="button" data-go="3">Change the place</button></div>`;
    wireResultActions();
  }
  function renderFieldReady(f) {
    panes[3].innerHTML = `<h3>Field test ready.</h3><p class="lore-intro">Your first look is waiting in the field notebook below. Go outside, look, tap what you saw, and put the phone away.</p>
      <div class="lore-actions"><a class="lore-btn lore-btn--coral" href="#field-reports">Open the field notebook</a><button class="lore-btn lore-btn--sage" type="button" data-act="again">Test another saying</button></div>`;
    wireResultActions();
  }
  function wireResultActions() {
    on($('[data-act="again"]', panes[3]), "click", () => {
      eng.hyp = eng.confirmed = null; S.hyp = S.mode = null; eng.max = 1; form.reset(); $("#lore-side-mode").hidden = true; panes[1].innerHTML = panes[2].innerHTML = panes[3].innerHTML = ""; go(1);
      $("#lore-text").focus();
    });
    const back = $('[data-go="3"]', panes[3]); if (back) on(back, "click", () => go(3));
  }
  go(1, false);

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
    all: { nodes: null, edges: null, steps: ["Pick a part, or choose Lab Test, Field Test or Outcome check above to read a journey step by step."] },
    lab: { edges: ["e1", "e2", "e3", "e5", "e8", "e10"], steps: [
      "The web UI sends your proverb to the API.",
      "The hypothesis service asks Gemma for a structured hypothesis. Code, not the model, decides it’s backtestable.",
      "You confirm and pick a place. The API asks the weather client for about ten years of Open-Meteo history.",
      "The scoring service compares days showing the sign with the base rate.",
      "The result is stored and returned to you as a scorecard." ] },
    field: { edges: ["e1", "e2", "e10"], steps: [
      "Same start: your proverb goes to the hypothesis service, and code says this one needs an observer.",
      "You confirm, go outside and tap Seen or Not seen. The API stores the look with a time to resolve after.",
      "The scorecard stays “On the trail” until enough looks have been resolved. See Outcome check." ] },
    outcome: { edges: ["e4", "e6", "e7", "e9", "e8"], steps: [
      "Whenever the app next opens, the API triggers the outcome check.",
      "It finds looks that are due and claims each row, so none resolve twice.",
      "It fetches hourly rain for the window through the weather client, retrying up to five times if an hour is missing.",
      "The outcome is saved and the scoring service updates the scorecard." ] },
  };
  const nodeById = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const KIND = { "": "Part", code: "Plain code decides", ext: "External data", store: "Storage" };
  const dgm = $("#lore-diagram"), stack = $("#lore-stack"), detail = $("#lore-detail"), stepsEl = $("#lore-steps");
  const arch = { pinned: null, hover: null, trace: "all" };

  (function buildDiagram() {
    if (!dgm) return;
    const edges = EDGES.map((e) => `<path class="lz-edge" id="lz-${e.id}" d="${e.d}" marker-end="url(#lz-arr)"${e.both ? ' marker-start="url(#lz-arr)"' : ""}/>`).join("");
    const labels = EDGES.map((e) => `<text class="lz-elabel" id="lz-l-${e.id}" x="${e.lx}" y="${e.ly}" text-anchor="${e.anchor || "middle"}">${esc(e.lbl)}</text>`).join("");
    const nodes = NODES.map((n) => `<g class="lz-node${n.kind ? " lz-node--" + n.kind : ""}" id="lz-n-${n.id}" data-node="${n.id}" role="button" tabindex="0" aria-pressed="false" aria-label="${esc(n.name)}: ${esc(n.sub.join(" "))}">
      <rect class="lz-shadow" x="${n.x + 6}" y="${n.y + 6}" width="${W}" height="${H}" rx="14"/><rect class="lz-card" x="${n.x}" y="${n.y}" width="${W}" height="${H}" rx="14"/>
      <text class="lz-name" x="${n.x + W / 2}" y="${n.y + 34}" text-anchor="middle">${esc(n.name)}</text>
      <text class="lz-sub" x="${n.x + W / 2}" y="${n.y + 62}" text-anchor="middle">${esc(n.sub[0])}</text>
      <text class="lz-sub" x="${n.x + W / 2}" y="${n.y + 82}" text-anchor="middle">${esc(n.sub[1])}</text></g>`).join("");
    dgm.innerHTML = `<svg viewBox="-10 0 1190 520" role="group" aria-label="Lore Lab system architecture diagram"><defs>
      <marker id="lz-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="lz-mk" d="M0 0 10 5 0 10z"/></marker>
      <marker id="lz-arr-hot" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="lz-mk-hot" d="M0 0 10 5 0 10z"/></marker></defs>${edges}${labels}${nodes}</svg>`;
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
      detail.innerHTML = `<span class="lore-tag">${KIND[n.kind]}</span><h3>${esc(n.name)}</h3><p>${esc(n.what)}</p><dl><dt>Takes in</dt><dd>${esc(n.takes)}</dd><dt>Hands on</dt><dd>${esc(n.gives)}</dd><dt>Talks to</dt><dd>${esc(talks.join(", "))}</dd></dl>`;
    } else {
      detail.innerHTML = `<span class="lore-tag">Blueprint</span><h3>Pick a part</h3><p>Hover or tap any box to see what it takes in, what it hands on and who it talks to. Tap again to let go.</p>`;
    }
  }
  function renderSteps() { stepsEl.innerHTML = TRACES[arch.trace].steps.map((s) => `<li>${esc(s)}</li>`).join(""); stepsEl.style.listStyle = arch.trace === "all" ? "none" : "decimal"; stepsEl.style.paddingLeft = arch.trace === "all" ? "1.4em" : ""; }
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
      $$(".lore-trace button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); paint(); renderSteps();
    });
    paint(); renderSteps();
  }

  /* ---------------------------------------------------------
     6. FIELD REPORT
     --------------------------------------------------------- */
  const obsEl = $("#lore-obs"), cardsEl = $("#lore-cards"), listEl = $("#lore-obslist");
  const fr = { exp: null, phase: "none", busy: false, entries: [], cards: [] };
  const ST = { logged: "Logged", pending: "Pending", resolved: "Resolved", failed: "Couldn’t resolve" };
  const ICON_EYE = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="14" fill="#f4d88a" stroke="#10291b" stroke-width="3"/><path d="M32 6v8M32 50v8M6 32h8M50 32h8M13 13l6 6M45 45l6 6M51 13l-6 6M19 45l-6 6" stroke="#10291b" stroke-width="3" stroke-linecap="round"/></svg>';

  function renderObs() {
    if (!obsEl) return;
    const f = fr.exp;
    if (!f) {
      obsEl.innerHTML = `<div class="lore-empty-obs">${ICON_EYE}<h3>No look due right now.</h3><p>A look starts when you confirm a hypothesis that needs an observer and start its Field Test.</p><div class="lore-actions" style="justify-content:center"><a class="lore-btn lore-btn--coral" href="#engine">Start a Field Test</a></div></div>`;
      return;
    }
    if (fr.phase === "logged") {
      obsEl.innerHTML = `<div class="lore-logged"><h3>Your look</h3><p class="lore-fieldnote">Logged. We’ll check the sky for you.</p><p>Now put the phone away.</p><p class="lore-pend">The outcome is pending until the window closes and the app next resolves it.</p><div class="lore-actions" style="justify-content:center"><button class="lore-btn lore-btn--ghost" type="button" data-act="another">Log another look</button></div></div>`;
      return;
    }
    obsEl.innerHTML = `<h3>Look, then tap.</h3><p class="lore-q">${esc(f.proverb)}</p>
      <dl><div><dt>Look for: </dt><dd>${esc(f.sign || "the sign in the saying")}</dd></div>
      ${f.how ? `<div><dt>How: </dt><dd>${esc(f.how)}</dd></div>` : ""}${f.when ? `<div><dt>When: </dt><dd>${esc(f.when)}</dd></div>` : ""}${f.place ? `<div><dt>Where: </dt><dd>${esc(f.place)}</dd></div>` : ""}</dl>
      <div class="lore-seen" role="group" aria-label="What did you see?"><button class="lore-btn" type="button" data-seen="true">Seen</button><button class="lore-btn" type="button" data-seen="false">Not seen</button></div>
      <details><summary>Add a note (optional)</summary><textarea class="lore-field" id="lf-note" rows="2" placeholder="Anything worth remembering"></textarea></details>`;
  }
  on(obsEl, "click", async (e) => {
    const another = e.target.closest('[data-act="another"]'); if (another) { fr.phase = "ready"; renderObs(); return; }
    const b = e.target.closest("[data-seen]"); if (!b || fr.busy || !fr.exp) return;
    fr.busy = true; $$(".lore-seen .lore-btn", obsEl).forEach((x) => (x.disabled = true)); busy(b, true);
    try {
      const note = ($("#lf-note", obsEl)?.value || "").trim();
      const r = await api("submitObservation", { experiment_id: fr.exp.id, seen: b.dataset.seen === "true", note: note || null }, { id: fr.exp.id });
      fr.phase = "logged"; // only after the server accepted it
      fr.entries.unshift({ proverb: fr.exp.proverb, seen: b.dataset.seen === "true", status: "logged", at: r?.observed_at || null });
      renderObs(); renderList(); refreshServerData();
    } catch (err) {
      const d = describeError(err);
      obsEl.insertAdjacentHTML("beforeend", `<div class="lore-alert" role="alert"><strong>${esc(d.title)}</strong>${esc(d.msg)} Your look was <b>not</b> saved.</div>`);
      $$(".lore-seen .lore-btn", obsEl).forEach((x) => (x.disabled = false)); busy(b, false);
      setTimeout(() => $$(".lore-alert", obsEl).forEach((a) => a.remove()), 9000);
    } finally { fr.busy = false; }
  });
  on(document, "lore:field", (e) => { fr.exp = e.detail; fr.phase = "ready"; renderObs(); renderCards(); });

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = fr.entries.map((en) => {
      const st = en.status in ST ? en.status : "pending";
      const out = en.status === "resolved" && en.outcome ? ` · ${esc(en.outcome)}` : "";
      return `<li><span>${esc(en.proverb)} · <b>${en.seen ? "Seen" : "Not seen"}</b>${out}</span><span class="lore-st" data-s="${st}">${ST[st]}</span></li>`;
    }).join("");
  }
  function renderCards() {
    if (!cardsEl) return;
    const field = fr.cards.filter((c) => c.mode === "field"), lab = fr.cards.filter((c) => c.mode === "lab");
    let html = `<div class="lore-group"><h3>Field Tests</h3><p>Looks recorded by people. Scored on their own.</p>`;
    if (field.length) html += field.map(cardHTML).join("");
    else html += cardHTML({ mode: "field", proverb: fr.exp?.proverb || "Your saying goes here", source: null, place: fr.exp?.place || null, looks: null, n: 0, pending: null, hits: null, baseRate: null, hitRate: null, lo: null, hi: null, lift: null, verdict: null, next: fr.exp ? null : "Start a Field Test above, then come back with your first look.", min: null });
    html += `</div>`;
    if (lab.length) html += `<div class="lore-group"><h3>Lab Tests</h3><p>Modelled weather history. Never combined with the field looks above.</p>${lab.map(cardHTML).join("")}</div>`;
    cardsEl.innerHTML = html;
  }
  async function refreshServerData() {
    if (isConfigured("listObservations")) {
      try {
        const r = await api("listObservations"); const list = Array.isArray(r) ? r : r.observations || [];
        const fromServer = list.map((o) => ({ proverb: o.proverb ?? o.original_text ?? "", seen: !!o.seen, status: String(o.status || "pending").toLowerCase().replace("resolve_failed", "failed"), outcome: o.outcome ?? null, at: o.observed_at ?? null }));
        // never drop a look the user just logged because the list hasn't caught up yet
        if (fromServer.length) fr.entries = fromServer;
        renderList();
      } catch (_) { /* leave the local list */ }
    }
    if (isConfigured("scorecards")) {
      try { const r = await api("scorecards"); fr.cards = (Array.isArray(r) ? r : r.scorecards || []).map(normCard); renderCards(); } catch (_) { /* keep empty state */ }
    }
  }
  // lazy outcome resolution: the app resolves what's due whenever it opens
  (async function boot() {
    renderObs(); renderCards();
    const key = $("#lore-key");
    if (key) key.innerHTML = Object.keys(VERDICT_TEXT).map((v) => `<div class="lore-key">${verdictBadge(v)}${esc({ trail: "Evidence is still accumulating.", promising: "The interval is clearly above the bar to beat.", chance: "The interval overlaps the bar to beat. A real finding.", backfires: "The interval is clearly below the bar to beat." }[v])}</div>`).join("");
    if (isConfigured("resolvePending")) { try { await api("resolvePending"); } catch (_) { /* resolution can fail quietly; failed looks show as such */ } }
    refreshServerData();
  })();
})();
