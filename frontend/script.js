const header = document.querySelector(".header");
const heroBg = document.querySelector(".hero__bg");
const progress = document.querySelector(".header__progress");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const links = [...document.querySelectorAll(".header__nav a")]
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
  if (!reduce) heroBg.style.transform = `translateY(${Math.min(y * 0.2, window.innerHeight * 0.08)}px)`;
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

// Playful hero illustrations: jelly wobble on hover, drag them around, they spring back
if (!reduce) {
document.querySelectorAll(".hero__apple, .hero__girl, .end__sticker, .play").forEach(makePlayful);
}

function makePlayful(el) {
const K = 170, C = 11; // spring stiffness / damping (lower C = bouncier)
const s = { x: 0, y: 0, r: 0, k: 1, j: 0 }; // position, rotation, scale, jelly
const v = { x: 0, y: 0, r: 0, k: 0, j: 0 }; // velocities
const t = { x: 0, y: 0, r: 0, k: 1, j: 0 }; // targets
let hovering = false, dragging = false, grabX = 0, grabY = 0, running = false, last = 0;

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function start() {
if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
}

function frame(now) {
const dt = Math.min((now - last) / 1000, 1 / 30);
last = now;

// while carried, the picture swings like a pendulum based on how fast it moves
if (dragging) t.r = clamp(v.x * 0.02, -25, 25);

let settled = true;
for (const p in s) {
    v[p] += (-K * (s[p] - t[p]) - C * v[p]) * dt;
    s[p] += v[p] * dt;
    if (Math.abs(v[p]) > 0.02 || Math.abs(s[p] - t[p]) > 0.01) settled = false;
}

// squash & stretch: jelly wobble + a little stretch when moving fast
const speed = Math.hypot(v.x, v.y);
const sq = s.j * 0.2 + clamp(speed / 6000, 0, 0.15);
el.style.transform =
    `translate(${s.x}px, ${s.y}px) rotate(${s.r}deg) scale(${s.k * (1 + sq)}, ${s.k * (1 - sq)})`;

if (settled && !dragging) {
    running = false;
    el.style.zIndex = "";
} else {
    requestAnimationFrame(frame);
}
}

el.addEventListener("pointerenter", () => {
hovering = true;
t.k = 1.06;
v.j += 9;                                    // jelly kick
v.r += (Math.random() < 0.5 ? -1 : 1) * 140; // random wiggle
start();
});

el.addEventListener("pointermove", (e) => {
if (dragging) {
t.x = e.clientX - grabX;
t.y = e.clientY - grabY;
} else {
    // tilt toward the cursor
const b = el.getBoundingClientRect();
    t.r = ((e.clientX - (b.left + b.width / 2)) / (b.width / 2)) * 10;
}
start();
});

el.addEventListener("pointerleave", () => {
hovering = false;
if (!dragging) { t.k = 1; t.r = 0; start(); }
});

el.addEventListener("pointerdown", (e) => {
dragging = true;
el.setPointerCapture(e.pointerId);
el.classList.add("is-dragging");
el.style.zIndex = 20;
grabX = e.clientX - s.x;
grabY = e.clientY - s.y;
t.k = 1.12;
v.j += 6;
start();
});

const release = () => {
if (!dragging) return;
dragging = false;
el.classList.remove("is-dragging");
t.x = 0; t.y = 0; t.r = 0;
t.k = hovering ? 1.06 : 1;
v.j -= 6; // squish on landing
start();
};
el.addEventListener("pointerup", release);
el.addEventListener("pointercancel", release);
el.addEventListener("dragstart", (e) => e.preventDefault());
}


// Email signup forms (hero + closing): front-end only for now
document.querySelectorAll(".signup").forEach((form) => {
  const input = form.querySelector(".signup__input");
  const msg = form.querySelector(".signup__msg");
form.addEventListener("submit", (e) => {
    e.preventDefault();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
    msg.classList.toggle("is-error", !ok);
    if (!ok) { msg.textContent = "That email doesn't look right. Try again?"; input.focus(); return; }
    // TODO: send input.value to your mailing-list service here
    msg.textContent = "You're on the list. We'll send updates, then you go touch grass.";
    input.value = "";
  });
});