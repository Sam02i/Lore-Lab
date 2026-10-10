/* Lore Lab · Architecture schematic + Protocol stacking cards. Vanilla JS, loaded after lore.js. */
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

    const STEPS = {
      lab: [["e1"], ["e2"], ["e3"], ["e5"], ["e8", "e10"]],
      field: [["e1", "e2"], ["e1", "e10"], ["e8", "e10"]],
      outcome: [["e4"], ["e4"], ["e6"], ["e7", "e9", "e8"]],
    };
    const st = { active: "ui", trace: "all", step: null, playing: true, inView: false };
    const chips = $("#ax-chips");
    const playBtn = document.createElement("button");
    playBtn.type = "button"; playBtn.className = "ax-play"; playBtn.textContent = "Pause"; chips.appendChild(playBtn);

    function paint() {
      let hotE = null, keepE = null, selN = new Set(), nearN = new Set();
      const tracing = st.trace !== "all";
      if (tracing) {
        keepE = new Set(TRACES[st.trace].edges);
        hotE = st.step !== null ? new Set(STEPS[st.trace][st.step]) : keepE;
        EDGES.forEach((e) => { if (keepE.has(e.id)) { nearN.add(e.a); nearN.add(e.b); } });
        if (st.step !== null) EDGES.forEach((e) => { if (hotE.has(e.id)) { selN.add(e.a); selN.add(e.b); } });
      } else if (st.active) {
        hotE = new Set(EDGES.filter((e) => e.a === st.active || e.b === st.active).map((e) => e.id)); keepE = hotE;
        selN.add(st.active); EDGES.forEach((e) => { if (hotE.has(e.id)) { nearN.add(e.a); nearN.add(e.b); } });
      }
      EDGES.forEach((e) => {
        const p = $(`#ax-${e.id}`), l = $(`#ax-l-${e.id}`), hot = !!hotE && hotE.has(e.id), dim = !!keepE && !keepE.has(e.id);
        p.classList.toggle("is-hot", hot); p.classList.toggle("is-dim", dim);
        const mk = `url(#${hot ? "ax-arr-hot" : "ax-arr"})`; p.setAttribute("marker-end", mk); if (e.both) p.setAttribute("marker-start", mk);
        l.classList.toggle("is-hot", hot); l.classList.toggle("is-dim", dim);
      });
      NODES.forEach((n) => {
        const g = $(`#ax-n-${n.id}`);
        g.classList.toggle("is-sel", selN.has(n.id));
        g.classList.toggle("is-near", nearN.has(n.id) && !selN.has(n.id));
        g.classList.toggle("is-dim", !!keepE && !nearN.has(n.id));
      });
      pkts.innerHTML = "";
      if (hotE && !reduce) {
        EDGES.filter((e) => hotE.has(e.id)).forEach((e, i) => {
          pkts.insertAdjacentHTML("beforeend", `<circle class="ax-pkt" r="4.5"><animateMotion dur="${(1.5 + (i % 3) * 0.3).toFixed(1)}s" repeatCount="indefinite" path="${e.d}"/></circle>`);
        });
      }
      chips.classList.toggle("is-trace", tracing && !reduce);
      playBtn.textContent = st.playing ? "Pause" : "Play";
      if (tracing) {
        const T = TRACES[st.trace];
        if (st.step !== null) {
          cap.innerHTML = `<div class="ax-steps">${T.steps.map((_, i) => `<button type="button" data-step="${i}" aria-label="Step ${i + 1}" class="${i < st.step ? "is-done" : i === st.step ? "is-cur" : ""}"></button>`).join("")}</div><span class="ax-stepn">${esc(T.title)} \u00b7 step ${st.step + 1} of ${T.steps.length}</span><span class="ax-stept">${esc(T.steps[st.step])}</span>`;
        } else cap.innerHTML = `<b>${esc(T.title)}</b><ol>${T.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;
      } else if (st.active) {
        const n = byId[st.active];
        cap.innerHTML = `<b>${esc(n.name)}</b>Talks to ${esc(talksTo(n.id).join(", "))}.`;
      } else cap.innerHTML = "";
      $$(".ax-row").forEach((r) => r.classList.toggle("is-active", r.dataset.node === st.active));
    }

    // trace player: steps advance on their own while the section is on screen
    let timer = null;
    const stopTimer = () => { clearInterval(timer); timer = null; };
    function startTimer() {
      stopTimer();
      if (reduce || st.trace === "all" || !st.playing) return;
      timer = setInterval(() => {
        if (!st.inView) return;
        st.step = (st.step + 1) % STEPS[st.trace].length; paint();
      }, 2800);
    }
    function setTrace(t) {
      st.trace = t; st.playing = true; st.step = t === "all" || reduce ? null : 0;
      $$("button[data-trace]", chips).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.trace === t)));
      paint(); startTimer();
    }
    playBtn.addEventListener("click", () => { st.playing = !st.playing; if (st.playing) startTimer(); else stopTimer(); paint(); });
    cap.addEventListener("click", (e) => { const b = e.target.closest("[data-step]"); if (!b) return; st.step = +b.dataset.step; st.playing = false; stopTimer(); paint(); });
    if ("IntersectionObserver" in window) new IntersectionObserver((es) => es.forEach((e) => { st.inView = e.isIntersecting; }), { threshold: 0.1 }).observe(sec);
    else st.inView = true;

    const setActive = (id) => { if (id !== st.active) { st.active = id; if (st.trace === "all") paint(); else $$(".ax-row").forEach((r) => r.classList.toggle("is-active", r.dataset.node === id)); } };
    // scroll drives the active part
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setActive(e.target.dataset.node); }), { rootMargin: "-42% 0px -42% 0px", threshold: 0 });
      $$(".ax-row").forEach((r) => io.observe(r));
    }
    $$(".ax-row").forEach((r) => r.addEventListener("mouseenter", () => { if (window.matchMedia("(hover:hover)").matches) setActive(r.dataset.node); }));
    // clicking a box jumps to its row
    const jump = (id) => { const r = $(`.ax-row[data-node="${id}"]`); if (r) r.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" }); stopTimer(); st.trace = "all"; st.step = null; $$("button[data-trace]", chips).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.trace === "all"))); st.active = id; paint(); };
    dgm.addEventListener("click", (e) => { const g = e.target.closest("[data-node]"); if (g) jump(g.dataset.node); });
    dgm.addEventListener("keydown", (e) => { if (e.key !== "Enter" && e.key !== " ") return; const g = e.target.closest("[data-node]"); if (g) { e.preventDefault(); jump(g.dataset.node); } });
    chips.addEventListener("click", (e) => { const b = e.target.closest("[data-trace]"); if (b) setTrace(b.dataset.trace); });
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

  // header: pink blob that springs to the hovered / current link
  const nav = $(".header__nav");
  if (nav) {
    const blob = document.createElement("i"); blob.className = "header__blob"; nav.prepend(blob);
    const place = (a) => {
      if (!a) { blob.style.opacity = 0; return; }
      blob.style.opacity = 1; blob.style.width = a.offsetWidth + "px"; blob.style.transform = `translateX(${a.offsetLeft}px)`;
    };
    const cur = () => nav.querySelector("a.is-active");
    $$("a", nav).forEach((a) => { a.addEventListener("pointerenter", () => place(a)); a.addEventListener("focus", () => place(a)); });
    nav.addEventListener("pointerleave", () => place(cur()));
    new MutationObserver(() => { if (!nav.matches(":hover")) place(cur()); }).observe(nav, { subtree: true, attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", () => place(cur()));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => place(cur()));
    place(cur());
  }

  // architecture header: cursor-lit circuit + spotlight
  const head = $("#ax-head");
  if (head && !reduce) {
    const base = $(".ax__circuit", head);
    if (base) { const hot = base.cloneNode(true); hot.classList.add("ax__circuit--hot"); base.after(hot); }
    let raf = 0;
    head.addEventListener("pointermove", (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0; const r = head.getBoundingClientRect();
        head.style.setProperty("--mx", `${e.clientX - r.left}px`); head.style.setProperty("--my", `${e.clientY - r.top}px`);
        head.classList.add("is-hover");
      });
    });
    head.addEventListener("pointerleave", () => head.classList.remove("is-hover"));
  }

  // protocol header: simple fade-in, no title animation
  const top = $("#px-top");
  if (top) {
    if ("IntersectionObserver" in window) { const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { top.classList.add("is-in"); io.disconnect(); } }, { threshold: 0.2 }); io.observe(top); } else top.classList.add("is-in");
  }

  /* FAQ accordion */
  $$("#px-faq .px-q button").forEach((b) => b.addEventListener("click", () => {
    const open = b.getAttribute("aria-expanded") === "true";
    $$("#px-faq .px-q button").forEach((x) => x.setAttribute("aria-expanded", "false"));
    b.setAttribute("aria-expanded", String(!open));
  }));
})();
/* phone menu toggle */
(function () {
  const btn = document.getElementById("header-menu"), nav = document.getElementById("header-nav");
  if (!btn || !nav) return;
  const set = (open) => { nav.classList.toggle("is-open", open); btn.setAttribute("aria-expanded", String(open)); };
  btn.addEventListener("click", () => set(btn.getAttribute("aria-expanded") !== "true"));
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".header")) set(false); });
  window.matchMedia("(min-width:801px)").addEventListener("change", () => set(false));
})();