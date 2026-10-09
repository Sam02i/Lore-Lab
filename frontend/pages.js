// Shared by architecture.html + ending.html (script.js is hero-specific, so it isn't loaded here)
const header = document.querySelector(".header");
const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 10);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

const revealEls = document.querySelectorAll(".reveal");
revealEls.forEach((el, i) => el.style.setProperty("--delay", `${(i % 3) * 0.12}s`));
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  revealEls.forEach((el) => io.observe(el));
} else revealEls.forEach((el) => el.classList.add("is-visible"));

const signup = document.getElementById("signup");
if (signup) {
  const input = signup.querySelector(".signup__input");
  const msg = document.getElementById("signup-msg");
  signup.addEventListener("submit", (e) => {
    e.preventDefault();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
    msg.classList.toggle("is-error", !ok);
    if (!ok) { msg.textContent = "That email doesn't look right. Try again?"; input.focus(); return; }
    // TODO: send input.value to your mailing-list service here
    msg.textContent = "You're on the list. We'll send updates, then you go touch grass.";
    input.value = "";
  });
}
