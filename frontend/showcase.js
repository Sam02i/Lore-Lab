/* Lore Lab · showcase.js (load after lore.js). Renders one finished experiment from assets/showcase.json.
   The file is written by build_showcase.py from real Open-Meteo data. No file, no section: nothing is invented here. */
(() => {
  const LL = window.LoreLab, sec = document.getElementById("showcase"), body = document.getElementById("sc-body");
  if (!LL || !sec || !body) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (v) => Math.round(v * 100) + "%";

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
    document.getElementById("sc-title").textContent = `“${d.saying.replace(/\.$/, "")}”: ${s.years[1] - s.years[0] + 1} years of ${s.place} weather say…`;
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
    sec.hidden = false;
  }).catch(() => { /* no real result generated yet: section stays hidden */ });
})();
