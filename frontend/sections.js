/* Lore Lab · showcase.js (load after lore.js). Renders one finished experiment from assets/showcase.json.
   The file is written by build_showcase.py from real Open-Meteo data. No file, no section: nothing is invented here. */
(() => {
  /* Works on index.html (mounts in #showcase, uses LoreLab) and on how-it-works.html (mounts in #run, no lore.js needed). */
  let sec = document.getElementById("showcase"), body = document.getElementById("sc-body");
  if (!sec) { const wrap = document.querySelector("#run .run__wrap"); if (wrap) { body = document.createElement("div"); body.id = "sc-body"; body.className = "sc-in-run"; wrap.insertBefore(body, document.getElementById("run-strip")); } }
  if (!body) return console.warn("[showcase] no #showcase or #run section on this page");
  const LL = window.LoreLab || fallbackLL();
  function fallbackLL() {
    const n = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    const V = { on_the_trail: "trail", promising: "promising", same_as_chance: "chance", backfires: "backfires" };
    const L = { trail: "On the trail", promising: "Promising", chance: "Same as chance", backfires: "Backfires" };
    return {
      normCard: (c) => ({ n: n(c.n_sign_present), hits: n(c.hits), baseRate: n(c.base_rate), hitRate: n(c.hit_rate), lo: n(c.ci_low), hi: n(c.ci_high), lift: n(c.lift), verdict: V[c.verdict] || null, min: n(c.min_n), notes: c.notes || [] }),
      cardHTML: (c) => `<span class="lore-verdict" data-v="${c.verdict}"><span>${L[c.verdict]}</span></span>
        <div class="lore-nums"><div><b>${pct(c.hitRate)}</b><small>when the sign showed</small></div><div><b>${pct(c.baseRate)}</b><small>bar to beat</small></div>${c.lift !== null ? `<div><b>×${c.lift.toFixed(2)}</b><small>lift</small></div>` : ""}</div>
        ${c.lo !== null ? `<div class="lore-bar" role="img" aria-label="Likely range ${pct(c.lo)} to ${pct(c.hi)}, bar to beat ${pct(c.baseRate)}"><span class="ci" style="left:${c.lo * 100}%;width:${Math.max((c.hi - c.lo) * 100, 1)}%"></span><span class="base" style="left:${c.baseRate * 100}%"></span></div>` : ""}
        ${c.notes.map((t) => `<p class="dv-limits">${esc(t)}</p>`).join("")}`,
    };
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (v) => (v === null || v === undefined ? "–" : Math.round(v * 100) + "%");

  function chart(years) {
    const W = 640, H = 236, top = 14, ch = 160, slot = W / years.length, y = (v) => top + ch * (1 - v);
    const grid = [0, .5, 1].map((g) => `<line x1="0" x2="${W}" y1="${y(g)}" y2="${y(g)}" class="sc-grid"/><text x="0" y="${y(g) - 4}" class="sc-ax">${pct(g)}</text>`).join("");
    const cols = years.map((r, i) => {
      const x = i * slot + slot * 0.2, w = slot * 0.6, beat = r.hit_rate !== null && r.hit_rate > r.base_rate;
      const bar = r.hit_rate === null ? "" : `<rect x="${x}" y="${y(r.hit_rate)}" width="${w}" height="${Math.max(ch * r.hit_rate, 1)}" rx="4" class="sc-bar ${beat ? "is-beat" : "is-miss"}"/>`;
      return `${bar}<line x1="${x - 5}" x2="${x + w + 5}" y1="${y(r.base_rate)}" y2="${y(r.base_rate)}" class="sc-base"/>
        <text x="${x + w / 2}" y="${top + ch + 20}" class="sc-yr" text-anchor="middle">${r.year}</text>
        <text x="${x + w / 2}" y="${top + ch + 36}" class="sc-n" text-anchor="middle">${r.hit_rate === null ? "none" : "n=" + r.n}</text>`;
    }).join("");
    const beat = years.filter((r) => r.hit_rate !== null && r.hit_rate > r.base_rate).length, tot = years.filter((r) => r.hit_rate !== null).length;
    return { beat, tot, svg: `<svg viewBox="0 0 ${W} ${H}" class="sc-svg" role="img" aria-label="Per year: how often rain followed a falling glass, against how often it rained anyway. The saying beat the bar in ${beat} of ${tot} years.">${grid}${cols}</svg>` };
  }

  function conclusion(c, beat, tot) {
    const lead = { promising: "It held up.", chance: "It didn’t beat chance.", backfires: "It went the wrong way.", trail: "Too few days to say." }[c.verdict] || "Here are the numbers.";
    const core = c.verdict === "trail" ? `Only ${c.n} days showed the sign; a verdict needs ${c.min}.`
      : `Rain followed the sign on <b>${pct(c.hitRate)}</b> of ${c.n} days, against <b>${pct(c.baseRate)}</b> on any day (×${c.lift.toFixed(2)}). The likely range, ${pct(c.lo)} to ${pct(c.hi)}, ${c.lo > c.baseRate ? "sits wholly above" : c.hi < c.baseRate ? "sits wholly below" : "straddles"} that bar.`;
    const yrs = c.verdict === "trail" ? "" : ` In ${beat} of ${tot} years it beat that year’s own bar${beat === tot ? ", every time" : beat < tot * .7 ? ", so don’t lean on it" : ", so it’s a tendency, not a rule"}.`;
    return `<p class="sc-concl"><b>${lead}</b> ${core}${yrs}</p>`;
  }

  fetch("assets/showcase.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => {
    const c = LL.normCard(d.scorecard), s = d.setup, ch = chart(d.years);
    const t = document.getElementById("sc-title"), lbl = document.getElementById("run-label");
    if (lbl) lbl.textContent = "A real result, real data";
    if (t) t.textContent = `“${d.saying.replace(/\.$/, "")}”: ${s.years[1] - s.years[0] + 1} years of ${s.place} weather say…`;
    body.innerHTML = `
      <ol class="sc-steps">
        <li><b>The saying</b><span>“${esc(d.saying)}” (${esc(d.source)})</span></li>
        <li><b>Pinned down first</b><span>Sign: ${esc(s.sign)}.<br>Outcome: ${esc(s.outcome)}.</span></li>
        <li><b>Tested on</b><span>${s.days_total.toLocaleString()} days, ${s.years[0]}–${s.years[1]}, ${esc(s.place)}</span></li>
      </ol>
      <div class="sc-grid2"><div class="sc-card">${LL.cardHTML(c)}</div>
        <figure class="sc-fig"><figcaption>Year by year: bars show how often rain followed the sign; the coral tick is how often it rained that year anyway.</figcaption>${ch.svg}</figure></div>
      ${conclusion(c, ch.beat, ch.tot)}
      <p class="sc-limits">One place, modelled weather, one rule fixed in advance. A hint, not proof, and no tuning after the fact. Data: <a href="${esc(d.provenance.url)}">${esc(d.provenance.source)}</a>, fetched ${esc(d.provenance.generated)}. Re-run it yourself with <code>python build_showcase.py</code>.</p>
      <p class="sc-cta"><a class="lore-btn lore-btn--coral" href="#engine">Test your own family’s saying</a></p>`;
    if (sec) sec.hidden = false;
  }).catch((e) => console.warn("[showcase] couldn't load assets/showcase.json (run build_showcase.py, serve over http, keep it next to index.html):", e));
})();