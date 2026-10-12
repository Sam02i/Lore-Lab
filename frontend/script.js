const header = document.querySelector(".header");
const heroBg = document.querySelector(".hero__bg");
const progress = document.querySelector(".header__progress");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const links = [...document.querySelectorAll(".header__nav a")]
  .filter((a) => (a.getAttribute("href") || "").startsWith("#"))
  .map((a) => ({ a, t: document.querySelector(a.getAttribute("href")) }))
  .filter((l) => l.t);

// one rAF-throttled scroll handler: header shadow, progress line, hero parallax, active nav link
let ticking = false;
function update() {
  ticking = false;
  const y = window.scrollY;
  header.classList.toggle("is-scrolled", y > 10);
  const max = document.documentElement.scrollHeight - window.innerHeight;
  progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
  if (!reduce && heroBg) heroBg.style.transform = `translateY(${Math.min(y * 0.2, window.innerHeight * 0.08)}px)`;
  let cur = null, best = -Infinity;
  const line = window.innerHeight * 0.4;
  for (const l of links) {
    const top = l.t.getBoundingClientRect().top;
    if (top <= line && top > best) { best = top; cur = l; }
  }
  links.forEach((l) => l.a.classList.toggle("is-active", l === cur));
}
window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
window.addEventListener("resize", update);
update();

// Scroll reveal: staggered within each parent
const revealEls = document.querySelectorAll(".reveal");
revealEls.forEach((el) => {
  const sibs = [...el.parentElement.querySelectorAll(":scope > .reveal")];
  const i = sibs.indexOf(el);
  const step = el.parentElement.classList.contains("grid") ? i % 2 : Math.min(i, 9);
  el.style.setProperty("--delay", `${step * 0.1}s`);
});
document.querySelectorAll(".tally .dot--on").forEach((d, i) => d.style.setProperty("--i", i));

if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); } });
  }, { threshold: 0.15 });
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("is-visible"));
}

// Draggable illustrations: load play.js on first touch/pointer, or when idle
let playLoaded = false;
function loadPlay() {
  if (playLoaded || reduce) return;
  playLoaded = true;
  const s = document.createElement("script");
  s.src = "play.js";
  document.body.appendChild(s);
}
["pointerdown", "pointermove", "touchstart", "keydown"].forEach((ev) =>
  window.addEventListener(ev, loadPlay, { once: true, passive: true }));
(window.requestIdleCallback || ((f) => setTimeout(f, 3000)))(loadPlay, { timeout: 4000 });

// Offline support: lets the browser show offline.html when there is no connection
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}