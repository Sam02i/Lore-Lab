/* Lore Lab · sections.js (replaces the old showcase.js). Renders one finished experiment from assets/showcase.json
   as a field-notebook result page. The file is written by build_showcase.py from real Open-Meteo data.
   No file, no section: nothing is invented here. Works on index.html (#showcase) and how-it-works.html (#run). Styles are injected below. */
(() => {
  let sec = document.getElementById("showcase"), body = document.getElementById("sc-body");
  if (!sec) { const wrap = document.querySelector("#run .run__wrap"); if (wrap) { body = document.createElement("div"); body.id = "sc-body"; body.className = "sc-in-run"; wrap.insertBefore(body, document.getElementById("run-strip")); } }
  if (!body) return console.warn("[showcase] no #showcase or #run section on this page");

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pc = (v) => (v === null || v === undefined || !Number.isFinite(+v) ? "–" : Math.round(v * 100) + "%");
  const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
  const VKEY = { on_the_trail: "trail", promising: "promising", same_as_chance: "chance", backfires: "backfires" };
  const VLAB = { trail: "On the trail", promising: "Promising", chance: "Same as chance", backfires: "Backfires" };
  const SUPPORTS = {
    promising: ["Rain followed the sign more often than it rains on a typical day.", "The whole likely range sits above the bar."],
    chance: ["The sign and rain moved together no more than luck would.", "The likely range includes the bar to beat."],
    backfires: ["Rain followed the sign less often than on a typical day.", "The whole likely range sits below the bar."],
    trail: ["The first hints, nothing more.", "Too few days showed the sign to call it."],
  };
  const CANT = ["That the sky causes the rain. Both may follow the same weather front.", "That it works in another town, another season, or for your own eyes.", "That it beats a forecast. It was never compared with one."];

  /* one axis: observed rate + 95% range, against the baseline line and its own band */
  function chart(c, baseRange) {
    const W = 640, L = 18, R = 622, x = (v) => L + (R - L) * v, y = 72, right = c.hit_rate >= c.base_rate;
    const ticks = [0, .25, .5, .75, 1].map((t) => `<line class="rn-grid" x1="${x(t)}" x2="${x(t)}" y1="30" y2="112"/><text class="rn-ax" x="${x(t)}" y="132" text-anchor="middle">${pc(t)}</text>`).join("");
    const band = baseRange ? `<rect class="rn-band" x="${x(baseRange[0])}" y="30" width="${Math.max(x(baseRange[1]) - x(baseRange[0]), 2)}" height="82"/>` : "";
    return `<svg viewBox="0 0 ${W} 150" role="img" aria-label="Rain followed the sign ${pc(c.hit_rate)} of the time, likely range ${pc(c.ci_low)} to ${pc(c.ci_high)}. Rain on any day: ${pc(c.base_rate)}.">
      ${ticks}${band}
      <line class="rn-base" x1="${x(c.base_rate)}" x2="${x(c.base_rate)}" y1="22" y2="112"/>
      <text class="rn-lab" x="${x(c.base_rate) + (right ? -8 : 8)}" y="18" text-anchor="${right ? "end" : "start"}">any day ${pc(c.base_rate)}</text>
      <g class="rn-obs"><line class="rn-whisk" x1="${x(c.ci_low)}" x2="${x(c.ci_high)}" y1="${y}" y2="${y}"/>
      <line class="rn-whisk" x1="${x(c.ci_low)}" x2="${x(c.ci_low)}" y1="${y - 9}" y2="${y + 9}"/><line class="rn-whisk" x1="${x(c.ci_high)}" x2="${x(c.ci_high)}" y1="${y - 9}" y2="${y + 9}"/>
      <circle class="rn-dot" cx="${x(c.hit_rate)}" cy="${y}" r="10"/></g>
      <text class="rn-lab" x="${x(c.hit_rate)}" y="${y + 34}" text-anchor="middle">with the sign ${pc(c.hit_rate)}</text></svg>`;
  }

  function resultHTML(d) {
    const s = d.setup, k = d.scorecard, v = VKEY[k.verdict] || "trail";
    const c = { n: num(k.n_sign_present), hits: num(k.hits), base_rate: num(k.base_rate), hit_rate: num(k.hit_rate), ci_low: num(k.ci_low), ci_high: num(k.ci_high), lift: num(k.lift), min: num(k.min_n) || 30 };
    const has = v !== "trail" && c.hit_rate !== null && c.ci_low !== null;
    const baseN = num(s.days_total), baseRange = baseN && c.base_rate !== null ? wilson(Math.round(c.base_rate * baseN), baseN) : null;
    const diff = has ? Math.round((c.hit_rate - c.base_rate) * 100) : null;
    const rel = !has ? "" : c.ci_low > c.base_rate ? "sits wholly above" : c.ci_high < c.base_rate ? "sits wholly below" : "straddles";
    const hh = String(s.look_hour ?? 18).padStart(2, "0");
    return `
      <div class="rn-page"><div class="rn-in">
        <h3 class="rn-said">${esc(d.saying)}</h3>
        <p class="rn-src">${esc(d.source)}, tested on ${esc(s.place)} weather, ${s.years[0]}–${s.years[1]}</p>
        <div class="rn-hyp"><p><b>Sign we looked for:</b> ${esc(s.sign)}.</p><p><b>What had to follow:</b> ${esc(s.outcome)}.</p></div>
        ${has ? `<p class="rn-head">Rain followed the sign on <em>${pc(c.hit_rate)}</em> of ${c.n} days. On any day it rained ${pc(c.base_rate)}.</p>
          <div class="rn-chart">${chart(c, baseRange)}</div>
          <div class="rn-legend"><span class="k1">Observed rate and likely range (95%)</span><span class="k2">Baseline: how often it rained anyway</span></div>`
          : `<p class="rn-head">Only ${c.n} days showed the sign. A verdict needs ${c.min}.</p>`}
        <div class="rn-nums">
          <div><b>${c.n ?? "–"}</b><small>days with the sign</small></div>
          <div><b>${has ? pc(c.hit_rate) : "–"}</b><small>rain followed (${c.hits ?? "–"} days)</small></div>
          <div><b>${pc(c.base_rate)}</b><small>baseline, any day</small></div>
          <div><b>${has ? (diff >= 0 ? "+" : "") + diff + " pts" : "–"}</b><small>${has && c.lift ? `vs baseline, ×${c.lift.toFixed(2)}` : "vs baseline"}</small></div>
        </div>
        <div class="rn-verdict" data-v="${v}">${VLAB[v]}</div>
        ${has ? `<p>The likely range, ${pc(c.ci_low)} to ${pc(c.ci_high)}, ${rel} the ${pc(c.base_rate)} baseline.</p>` : ""}
        <div class="rn-two">
          <div><h4>What the evidence supports</h4><ul>${SUPPORTS[v].map((t) => `<li>${t}</li>`).join("")}</ul></div>
          <div><h4>What it can’t show</h4><ul>${CANT.map((t) => `<li>${t}</li>`).join("")}</ul></div>
        </div>
        <details class="rn-how"><summary>How this was tested</summary>
          <dl>
            <dt>Rule, fixed first</dt><dd>One sign, one outcome, written down before any data was opened. No tuning afterwards.</dd>
            <dt>The look</dt><dd>Each day at ${hh}:00.</dd>
            <dt>Rain counts as</dt><dd>${s.rain_mm ? `At least ${esc(s.rain_mm)} mm in the next ${esc(s.window_hours ?? 24)} hours.` : esc(s.outcome) + "."}</dd>
            <dt>Baseline</dt><dd>The share of all ${baseN ? baseN.toLocaleString() + " " : ""}days with that outcome, sign or not. The saying has to beat this, not 50%.</dd>
            <dt>Adjusted comparison</dt><dd>Difference in percentage points, and lift (observed rate divided by baseline).</dd>
            <dt>Likely range</dt><dd>95% Wilson interval on ${c.hits ?? "–"} of ${c.n ?? "–"} days. The shaded band on the chart is the same interval for the baseline.</dd>
            <dt>Verdict rule</dt><dd>Needs ${c.min} days with the sign. Promising: range wholly above baseline. Backfires: wholly below. Otherwise same as chance.</dd>
            <dt>Days overlap</dt><dd>Neighbouring days share weather, so the true uncertainty is a little wider than shown.</dd>
          </dl>
          <p class="rn-fine">Modelled weather from <a href="${esc(d.provenance.url)}">${esc(d.provenance.source)}</a>, fetched ${esc(d.provenance.generated)}. One place. A hint, not proof. Re-run it yourself with <code>python build_showcase.py</code>.</p>
        </details>
        <a class="rn-cta" href="#engine">Test your own family’s saying</a>
      </div></div>`;
  }

  const css = `
.rn-page{position:relative;max-width:860px;margin:0 auto;padding:1.5em 1.5em 1.4em 3.6em;color:#10291b;text-align:left;font:17px/1.55 var(--font-body,"Nunito","Segoe UI",system-ui,sans-serif);
  background:linear-gradient(90deg,transparent 2.8em,rgba(242,106,79,.55) 2.8em calc(2.8em + 2px),transparent calc(2.8em + 2px)),repeating-linear-gradient(180deg,transparent 0 1.7em,rgba(31,90,61,.14) 1.7em calc(1.7em + 1px)),#fffaf0;
  border:.12em solid #10291b;border-radius:.4em .9em .9em .4em;box-shadow:.4em .4em 0 rgba(0,0,0,.35)}
.rn-page::before{content:"";position:absolute;left:.75em;top:1.2em;bottom:1.2em;width:.9em;background:radial-gradient(circle,#10291b 38%,transparent 42%) 0 0/100% 2.6em repeat-y;opacity:.75}
.rn-page :where(h3,h4,p,ul,dl){max-width:none}
.rn-said{margin:0;font:400 clamp(1.9rem,5vw,2.9rem)/1.05 var(--font-display,"Caveat Brush","Chalkboard SE","Comic Sans MS",cursive)}
.rn-src{margin:.2em 0 0;font-size:.9rem;opacity:.85}
.rn-hyp{margin:1.1em 0 0;padding:.7em 1em;background:rgba(244,216,138,.55);border:.1em dashed #10291b;border-radius:.5em}
.rn-hyp p{margin:0}.rn-hyp p+p{margin-top:.3em}
.rn-head{margin:1.2em 0 .2em;font:800 clamp(1.2rem,2.6vw,1.5rem)/1.3 var(--font-body,"Nunito",system-ui,sans-serif)}
.rn-head em{font-style:normal;background:linear-gradient(transparent 60%,#f4d88a 60%)}
.rn-chart svg{display:block;width:100%;height:auto;overflow:visible}
.rn-ax{font:700 12px "Nunito",system-ui,sans-serif;fill:#10291b}
.rn-lab{font:400 19px var(--font-display,"Caveat Brush",cursive);fill:#10291b}
.rn-grid{stroke:rgba(16,41,27,.25)}
.rn-base{stroke:#f26a4f;stroke-width:2.5;stroke-dasharray:6 4}
.rn-band{fill:rgba(242,106,79,.2)}
.rn-whisk{stroke:#10291b;stroke-width:3;stroke-linecap:round}
.rn-dot{fill:#8aa863;stroke:#10291b;stroke-width:2.5}
.rn-legend{display:flex;flex-wrap:wrap;gap:.3em 1.4em;font-size:.88rem}
.rn-legend span::before{content:"";display:inline-block;width:1.1em;height:.55em;margin-right:.4em;vertical-align:middle;border-radius:.2em}
.rn-legend .k1::before{background:#8aa863;border:.1em solid #10291b}.rn-legend .k2::before{background:#f26a4f}
.rn-nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5em,1fr));gap:.7em;margin:1em 0 0}
.rn-nums div{padding:.5em .7em;border:.1em solid #10291b;border-radius:.5em;background:rgba(255,250,240,.9)}
.rn-nums b{display:block;font:400 2rem/1 var(--font-display,"Caveat Brush",cursive)}
.rn-nums small{display:block;font-size:.85rem;font-weight:600;line-height:1.3}
.rn-verdict{display:inline-block;margin:1.1em 0 .2em;padding:.1em .9em;font:400 1.7rem/1.3 var(--font-display,"Caveat Brush",cursive);background:#8aa863;border:.12em solid #10291b;border-radius:.5em;box-shadow:.15em .15em 0 #10291b;rotate:-1.2deg}
.rn-verdict[data-v=backfires]{background:#f3c4bb}.rn-verdict[data-v=chance]{background:#f4d88a}.rn-verdict[data-v=trail]{background:#d1dfbc}
.rn-two{display:grid;grid-template-columns:1fr 1fr;gap:1em 1.6em;margin:1em 0 0}
.rn-two h4{margin:0 0 .15em;font:400 1.3rem/1.2 var(--font-display,"Caveat Brush",cursive)}
.rn-two ul{margin:0;padding-left:1.1em;font-size:.95rem}.rn-two li+li{margin-top:.3em}
.rn-how{margin-top:1.3em;border-top:.1em dashed #10291b;padding-top:.7em}
.rn-how>summary{display:inline-block;min-height:44px;padding:.5em 1.1em;font-weight:800;cursor:pointer;list-style:none;background:#fbf6e6;border:.12em solid #10291b;border-radius:999px;box-shadow:.14em .14em 0 #10291b}
.rn-how>summary::-webkit-details-marker{display:none}.rn-how[open]>summary{background:#f4d88a}
.rn-how dl{display:grid;grid-template-columns:max-content 1fr;gap:.35em 1em;margin:.9em 0 0;font-size:.94rem}
.rn-how dt{font-weight:800}.rn-how dd{margin:0}
.rn-fine{margin:.9em 0 0;font-size:.85rem;opacity:.85}.rn-fine a{color:#10291b;font-weight:700}
.rn-cta{display:inline-flex;align-items:center;margin-top:1.2em;padding:.4em 1.3em;min-height:44px;font-weight:800;color:#10291b;text-decoration:none;background:#f26a4f;border:.12em solid #10291b;border-radius:999px;box-shadow:.16em .16em 0 #10291b}
.rn-page :where(a,summary):focus-visible{outline:3px solid #f4d88a;outline-offset:3px}
.rn-in .rn-obs{animation:rn-pop .7s .15s both cubic-bezier(.2,.9,.3,1.2);transform-box:fill-box;transform-origin:center}
@keyframes rn-pop{from{opacity:0;scale:.2}to{opacity:1;scale:1}}
@media (prefers-reduced-motion:reduce){.rn-in .rn-obs{animation:none}}
@media (max-width:620px){.rn-page{padding-left:3.1em}.rn-two{grid-template-columns:1fr}.rn-how dl{grid-template-columns:1fr}.rn-how dt{margin-top:.4em}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  fetch("assets/showcase.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => {
    const t = document.getElementById("sc-title"), lbl = document.getElementById("run-label"), s = d.setup;
    if (lbl) lbl.textContent = "A real result, real data";
    if (t) t.textContent = `“${d.saying.replace(/\.$/, "")}”: ${s.years[1] - s.years[0] + 1} years of ${s.place} weather say…`;
    body.innerHTML = resultHTML(d);
    if (sec) sec.hidden = false;
  }).catch((e) => console.warn("[showcase] couldn't load assets/showcase.json (run build_showcase.py, serve over http, keep it next to index.html):", e));
})();