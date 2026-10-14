/* Lore Lab · how.js — how-it-works page: architecture schematic, protocol cards, FAQ, one-saying strip.
   Restored from the old sections.js, plus the pieces that file never had (protocol header, FAQ toggles, walkthrough strip).
   Loads after script.js. Does not need lore.js. Kept separate from sections.js (the notebook result card). */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------------------------------------------------------
     ARCHITECTURE
     --------------------------------------------------------- */
  const sec = $("#architecture");
  if (sec) {
    const W = 170, H = 76;
    const NODES = [
      { id: "ui", name: "Mobile web UI", sub: ["Proverbs, hypotheses,", "Seen / Not seen"], x: 215, y: 0, kind: "",
        what: "Where you enter a proverb, review and edit its hypothesis, run an experiment and record what you saw outdoors.",
        takes: "Hypotheses, scorecards and verdicts from the API.", gives: "Proverb text and source, your confirmed hypothesis and threshold, and Seen / Not seen looks." },
      { id: "api", name: "Backend API", sub: ["Coordinates every", "request"], x: 215, y: 120, kind: "",
        what: "Coordinates proverb, hypothesis, observation and result operations between the UI and everything behind it.",
        takes: "Requests from the UI.", gives: "Calls to the hypothesis service, weather client and database; results back to the UI." },
      { id: "hyp", name: "Hypothesis", sub: ["Gemma proposes,", "code validates"], x: 0, y: 250, kind: "code",
        what: "Open-weight Gemma turns a proverb into a structured hypothesis. The response is validated, and plain code (not the model) decides whether it\u2019s backtestable.",
        takes: "A proverb in any language, plus its source.", gives: "Sign kind, observable sign, proxy and fit, ambiguities, and a threshold left empty for you to set." },
      { id: "wea", name: "Weather client", sub: ["Open-Meteo history", "and recent hours"], x: 215, y: 250, kind: "ext",
        what: "Fetches historical and recent weather from Open-Meteo.",
        takes: "A place and a time window.", gives: "Hourly weather data for scoring and for resolving outcomes." },
      { id: "out", name: "Outcome check", sub: ["Resolves pending looks", "when the app reopens"], x: 430, y: 250, kind: "",
        what: "A lazy, idempotent check: when the app next opens it finds due looks, claims each row so none resolve twice, fetches hourly rain for the window (retrying up to five times) and saves the outcome.",
        takes: "Looks whose window has closed.", gives: "Saved outcomes, and an updated scorecard." },
      { id: "score", name: "Scoring", sub: ["Base rate, hit rate,", "lift, interval, verdict"], x: 215, y: 400, kind: "code",
        what: "Computes the base rate, hit rate, lift, confidence interval and verdict. Below the minimum sample it withholds percentages and verdicts.",
        takes: "Sign-present days or looks and the matching weather outcomes.", gives: "A scorecard: counts, the bar to beat and one of four verdicts." },
      { id: "db", name: "Database", sub: ["Proverbs, hypotheses,", "looks, outcomes, results"], x: 430, y: 400, kind: "store",
        what: "Stores proverbs, hypotheses, locations, observations, outcomes and backtest results.",
        takes: "Records from the API, saved outcomes and scored results.", gives: "The records that scoring and outcome resolution read back." },
    ];
    const EDGES = [
      { id: "e1", a: "ui", b: "api", d: "M300 76V120", lbl: "words \u00b7 looks", lx: 310, ly: 104, anchor: "start", both: true },
      { id: "e2", a: "api", b: "hyp", d: "M215 158H85V250", lbl: "proverb", lx: 150, ly: 148, both: true },
      { id: "e3", a: "api", b: "wea", d: "M300 196V250", lbl: "place \u00b7 window", lx: 310, ly: 228, anchor: "start" },
      { id: "e4", a: "api", b: "out", d: "M385 158H515V250", lbl: "on open", lx: 450, ly: 148 },
      { id: "e5", a: "wea", b: "score", d: "M300 326V400", lbl: "hourly weather", lx: 292, ly: 368, anchor: "end" },
      { id: "e6", a: "out", b: "wea", d: "M430 288H385", lbl: "rain", lx: 407, ly: 279 },
      { id: "e7", a: "out", b: "db", d: "M515 326V400", lbl: "save outcome", lx: 523, ly: 368, anchor: "start" },
      { id: "e8", a: "score", b: "db", d: "M385 438H430", lbl: "result", lx: 407, ly: 496 },
      { id: "e9", a: "out", b: "score", d: "M460 326C460 372 360 362 345 400", lbl: "update", lx: 424, ly: 350 },
      { id: "e10", a: "api", b: "db", d: "M385 182H630V438H600", lbl: "save \u00b7 read", lx: 622, ly: 214, anchor: "end" },
    ];
    const TRACES = {
      all: { edges: null, title: "", steps: [] },
      lab: { title: "Lab Test path", edges: ["e1", "e2", "e3", "e5", "e8", "e10"], steps: [
        "The web UI sends your proverb to the API.",
        "The hypothesis service asks Gemma for a structured hypothesis. Code, not the model, decides it\u2019s backtestable.",
        "You confirm and pick a place. The API asks the weather client for about ten years of Open-Meteo history.",
        "The scoring service compares days showing the sign with the base rate.",
        "The result is stored and returned to you as a scorecard." ] },
      field: { title: "Field Test path", edges: ["e1", "e2", "e10"], steps: [
        "Same start: your proverb goes to the hypothesis service, and code says this one needs an observer.",
        "You confirm, go outside and tap Seen or Not seen. The API stores the look with a time to resolve after.",
        "The scorecard stays \u201cOn the trail\u201d until enough looks have been resolved. See Outcome check." ] },
      outcome: { title: "Outcome check path", edges: ["e4", "e6", "e7", "e9", "e8"], steps: [
        "Whenever the app next opens, the API triggers the outcome check.",
        "It finds looks that are due and claims each row, so none resolve twice.",
        "It fetches hourly rain for the window through the weather client, retrying up to five times if an hour is missing.",
        "The outcome is saved and the scoring service updates the scorecard." ] },
    };
    const KIND = { "": "Part", code: "Plain code decides", ext: "External data", store: "Storage" };
    const ORDER = ["ui", "api", "hyp", "wea", "score", "out", "db"];
    const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
    const talksTo = (id) => [...new Set(EDGES.filter((e) => e.a === id || e.b === id).map((e) => byId[e.a === id ? e.b : e.a].name))];

    // rows (left)
    const rows = $("#ax-rows");
    rows.innerHTML = ORDER.map((id, i) => {
      const n = byId[id];
      return `<li class="ax-row${n.kind ? " ax-row--" + n.kind : ""}" data-node="${id}">
        <span class="ax-row__n">${String(i + 1).padStart(2, "0")}</span>
        <div><span class="ax-row__tag">${KIND[n.kind]}</span>
        <h3 class="ax-row__name">${esc(n.name)}</h3>
        <p class="ax-row__what">${esc(n.what)}</p>
        <dl class="ax-row__io"><div><dt>Takes in</dt><dd>${esc(n.takes)}</dd></div><div><dt>Hands on</dt><dd>${esc(n.gives)}</dd></div></dl>
        <p class="ax-row__talks">Talks to <b>${esc(talksTo(id).join(", "))}</b></p></div></li>`;
    }).join("");

    // schematic (right)
    const dgm = $("#ax-dgm"), cap = $("#ax-cap");
    const edgeSvg = EDGES.map((e) => `<path class="ax-e" id="ax-${e.id}" d="${e.d}" marker-end="url(#ax-arr)"${e.both ? ' marker-start="url(#ax-arr)"' : ""}/>`).join("");
    const lblSvg = EDGES.map((e) => `<text class="ax-l" id="ax-l-${e.id}" x="${e.lx}" y="${e.ly}" text-anchor="${e.anchor || "middle"}">${esc(e.lbl)}</text>`).join("");
    const nodeSvg = NODES.map((n, i) => `<g class="ax-n${n.kind ? " ax-n--" + n.kind : ""}" id="ax-n-${n.id}" data-node="${n.id}" style="--n:${i}" role="button" tabindex="0" aria-label="${esc(n.name)}">
      <rect x="${n.x}" y="${n.y}" width="${W}" height="${H}" rx="12"/><circle class="dot" cx="${n.x + 16}" cy="${n.y + 16}" r="4"/>
      <text class="nm" x="${n.x + W / 2}" y="${n.y + 36}" text-anchor="middle">${esc(n.name)}</text>
      <text class="sb" x="${n.x + W / 2}" y="${n.y + 54}" text-anchor="middle">${esc(n.sub[0])}</text>
      <text class="sb" x="${n.x + W / 2}" y="${n.y + 68}" text-anchor="middle">${esc(n.sub[1])}</text></g>`).join("");
    dgm.innerHTML = `<svg viewBox="-20 -10 670 515" role="group" aria-label="Lore Lab system schematic"><defs>
      <marker id="ax-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="ax-mk" d="M0 0 10 5 0 10z"/></marker>
      <marker id="ax-arr-hot" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="ax-mk-hot" d="M0 0 10 5 0 10z"/></marker></defs>
      <g id="ax-edges">${edgeSvg}</g><g id="ax-labels">${lblSvg}</g><g id="ax-nodes">${nodeSvg}</g><g id="ax-pkts"></g></svg>`;
    const svg = $("svg", dgm), pkts = $("#ax-pkts", svg);

    const st = { active: "ui", trace: "all" };
    function paint() {
      let hotE = null, hotN = null, sel = null;
      if (st.trace !== "all") {
        hotE = new Set(TRACES[st.trace].edges); hotN = new Set();
        EDGES.forEach((e) => { if (hotE.has(e.id)) { hotN.add(e.a); hotN.add(e.b); } });
      } else if (st.active) {
        sel = st.active; hotE = new Set(EDGES.filter((e) => e.a === sel || e.b === sel).map((e) => e.id)); hotN = new Set([sel]);
        EDGES.forEach((e) => { if (hotE.has(e.id)) { hotN.add(e.a); hotN.add(e.b); } });
      }
      EDGES.forEach((e) => {
        const p = $(`#ax-${e.id}`), l = $(`#ax-l-${e.id}`), hot = !!hotE && hotE.has(e.id);
        p.classList.toggle("is-hot", hot); p.classList.toggle("is-dim", !!hotE && !hot);
        const mk = `url(#${hot ? "ax-arr-hot" : "ax-arr"})`; p.setAttribute("marker-end", mk); if (e.both) p.setAttribute("marker-start", mk);
        l.classList.toggle("is-hot", hot); l.classList.toggle("is-dim", !!hotE && !hot);
      });
      NODES.forEach((n) => {
        const g = $(`#ax-n-${n.id}`);
        g.classList.toggle("is-sel", sel === n.id);
        g.classList.toggle("is-near", !!hotN && hotN.has(n.id) && sel !== n.id);
        g.classList.toggle("is-dim", !!hotN && !hotN.has(n.id));
      });
      // data packets travel along live wires
      pkts.innerHTML = "";
      if (hotE && !reduce) {
        EDGES.filter((e) => hotE.has(e.id)).forEach((e, i) => {
          pkts.insertAdjacentHTML("beforeend", `<circle class="ax-pkt" r="4.5"><animateMotion dur="${(1.6 + (i % 3) * 0.3).toFixed(1)}s" repeatCount="indefinite" path="${e.d}"/></circle>`);
        });
      }
      // caption
      if (st.trace !== "all") {
        const T = TRACES[st.trace];
        cap.innerHTML = `<b>${esc(T.title)}</b><ol>${T.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;
      } else if (st.active) {
        const n = byId[st.active];
        cap.innerHTML = `<b>${esc(n.name)}</b>Talks to ${esc(talksTo(n.id).join(", "))}.`;
      } else cap.innerHTML = "";
      $$(".ax-row").forEach((r) => r.classList.toggle("is-active", r.dataset.node === st.active));
    }

    const setActive = (id) => { if (id !== st.active) { st.active = id; paint(); } };
    // scroll drives the active part
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setActive(e.target.dataset.node); }), { rootMargin: "-42% 0px -42% 0px", threshold: 0 });
      $$(".ax-row").forEach((r) => io.observe(r));
    }
    $$(".ax-row").forEach((r) => r.addEventListener("mouseenter", () => { if (window.matchMedia("(hover:hover)").matches) setActive(r.dataset.node); }));
    // clicking a box jumps to its row
    const jump = (id) => { const r = $(`.ax-row[data-node="${id}"]`); if (r) r.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" }); st.trace = "all"; $$("#ax-chips button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.trace === "all"))); setActive(id); paint(); };
    dgm.addEventListener("click", (e) => { const g = e.target.closest("[data-node]"); if (g) jump(g.dataset.node); });
    dgm.addEventListener("keydown", (e) => { if (e.key !== "Enter" && e.key !== " ") return; const g = e.target.closest("[data-node]"); if (g) { e.preventDefault(); jump(g.dataset.node); } });
    $("#ax-chips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-trace]"); if (!b) return;
      st.trace = b.dataset.trace; $$("#ax-chips button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); paint();
    });
    paint();

    // entrance (draws nodes + wires once)
    if ("IntersectionObserver" in window) {
      const io2 = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { sec.classList.add("is-entered"); io2.disconnect(); } }), { threshold: 0.05 });
      io2.observe(sec);
    } else sec.classList.add("is-entered");
  }

  /* ---------------------------------------------------------
     PROTOCOL: stacking cards that shrink as the next one lands
     --------------------------------------------------------- */
  const stack = $("#px-stack");
  if (stack) {
    const cards = $$(".px-card", stack);
    cards.forEach((c, i) => c.style.setProperty("--i", i));
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }), { threshold: 0.12 });
      cards.forEach((c) => io.observe(c));
    } else cards.forEach((c) => c.classList.add("is-in"));

    let ticking = false;
    const mq = window.matchMedia("(max-width:900px)");
    function update() {
      ticking = false;
      if (mq.matches || reduce) { cards.forEach((c) => c.style.removeProperty("--s")); return; }
      const vh = window.innerHeight;
      cards.forEach((c, i) => {
        const next = cards[i + 1]; if (!next) return;
        const stickyTop = parseFloat(getComputedStyle(c).top) || 0;
        const gap = next.getBoundingClientRect().top - stickyTop;           // distance until the next card covers this one
        const p = Math.min(1, Math.max(0, 1 - gap / (vh * 0.75)));
        c.style.setProperty("--s", (1 - p * 0.045).toFixed(4));
      });
    }
    const req = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    window.addEventListener("scroll", req, { passive: true });
    window.addEventListener("resize", req);
    update();
  }

  /* ---------------------------------------------------------
     PROTOCOL header + FAQ
     --------------------------------------------------------- */
  const ptop = $("#px-top");
  if (ptop) {
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }), { threshold: 0.1 });
      io.observe(ptop);
    } else ptop.classList.add("is-in");
  }

  const faq = $("#px-faq");
  if (faq) {
    const setOpen = (btn, open) => {
      btn.setAttribute("aria-expanded", String(open));
      const q = btn.closest(".px-q"), a = q && $(".px-q__a", q);
      if (q) q.classList.toggle("is-open", open);
      if (a) a.style.gridTemplateRows = open ? "1fr" : "0fr";
    };
    $$(".px-q button", faq).forEach((b) => setOpen(b, false));
    faq.addEventListener("click", (e) => {
      const b = e.target.closest(".px-q button");
      if (b) setOpen(b, b.getAttribute("aria-expanded") !== "true");
    });
  }

  /* ---------------------------------------------------------
     ONE SAYING, START TO FINISH (#run-strip)
     The rule below mirrors build_showcase.py. Numbers come only from assets/showcase.json;
     if that file isn't there, the steps still show and the numbers are left out. Nothing is invented.
     --------------------------------------------------------- */
  const strip = $("#run-strip");
  if (strip) {
    const pc = (v) => (v === null || v === undefined || !Number.isFinite(+v) ? "–" : Math.round(v * 100) + "%");
    const VLAB = { on_the_trail: "On the trail", promising: "Promising", same_as_chance: "Same as chance", backfires: "Backfires" };
    function stripHTML(d) {
      const sc = d && d.scorecard, s = d && d.setup;
      const saying = d ? d.saying : "A falling glass brings rain.", source = d ? d.source : "Traditional";
      const place = s ? s.place : "London", yrs = s ? `${s.years[0]}–${s.years[1]}` : "2016–2025";
      const enough = sc && sc.hit_rate !== null && sc.hit_rate !== undefined && sc.verdict !== "on_the_trail";
      const step = (kind, who, h, inner) => `<article class="run-st run-st--${kind}"><p class="run-st__who">${esc(who)}</p><h3 class="run-st__h">${esc(h)}</h3>${inner}</article>`;
      return [
        step("saying", "You type", "A saying", `<p class="run-q">\u201c${esc(saying)}\u201d</p><p class="run-meta">${esc(source)}</p>`),
        step("model", "Gemma proposes", "Sorted, not judged",
          `<pre class="run-code">sign.kind        atmospheric\nproxy.variable   pressure_msl\nproxy.fit        good\nthreshold        null</pre><p class="run-meta">Gemma never judges the saying and never invents the number.</p>`),
        step("code", "Plain code decides", "Is it testable?",
          `<ul class="run-checks"><li><code>sign.kind == "atmospheric"</code></li><li><code>variable in WHITELIST</code></li><li><code>fit != "none"</code></li></ul><p class="run-meta">All three pass, so it\u2019s a Lab Test. The rule is fixed first: pressure at 8am at least 2 hPa below 5am, then 1 mm or more of rain in the next 12 hours.</p>`),
        step("data", "Open-Meteo history", `Ten years of ${place}`,
          `<p class="run-q">${esc(yrs)}${s && s.days_total ? `, ${Number(s.days_total).toLocaleString()} days` : ""}</p><p class="run-meta">Modelled reanalysis (ERA5), not station readings. One place.</p>`),
        step("score", "The scorecard", enough ? VLAB[sc.verdict] || "Scored" : "Only what the data can back",
          enough
            ? `<p class="run-q">Rain followed the sign on <b>${pc(sc.hit_rate)}</b> of ${sc.n_sign_present} days. On any day: <b>${pc(sc.base_rate)}</b>.</p><p class="run-meta">Likely range ${pc(sc.ci_low)} to ${pc(sc.ci_high)}. Needs ${sc.min_n || 30} sign days for a verdict.</p>`
            : `<p class="run-q">Percentages and verdicts appear only when there are enough days with the sign.</p><p class="run-meta">Run <code>python build_showcase.py</code> to fill in the real numbers.</p>`),
      ].join("");
    }
    const reveal = () => {
      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }), { threshold: 0.12 });
        io.observe(strip);
      } else strip.classList.add("is-in");
    };
    strip.innerHTML = stripHTML(null); reveal();
    fetch("assets/showcase.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => { strip.innerHTML = stripHTML(d); }).catch(() => {});
  }
})();
