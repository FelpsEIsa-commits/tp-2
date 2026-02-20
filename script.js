/* =========================================================
   [Equipe da Esther | Dev #17]
   Centro de controle do movimento: scroll, menu, spotlight, GSAP.
   ========================================================= */

const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => [...el.querySelectorAll(q)];

/* ==========================
   Loader
========================== */
window.addEventListener('load', () => {
  const loader = $('.loader');
  if (!loader) return;

  // [Equipe da Esther | Dev #18] Loader suave e curto
  gsap.to(loader, {
    opacity: 0,
    duration: 0.55,
    delay: 1.05,
    ease: 'power2.out',
    onComplete: () => loader.remove()
  });
});

/* ==========================
   Smooth Scroll (com offset do header)
========================== */
function smoothScrollTo(target) {
  const header = $('.header');
  const offset = header ? header.offsetHeight + 14 : 90;
  const y = target.getBoundingClientRect().top + window.pageYOffset - offset;
  window.scrollTo({ top: y, behavior: 'smooth' });
}

$$('a[data-scroll]').forEach(link => {
  link.addEventListener('click', (e) => {
    const href = link.getAttribute('href');
    if (!href || !href.startsWith('#')) return;

    const target = document.querySelector(href);
    if (!target) return;

    e.preventDefault();
    smoothScrollTo(target);
    closeDrawer();
  });
});

/* ==========================
   Scroll progress
========================== */
const progress = $('.scroll-progress');
function updateProgress() {
  if (!progress) return;
  const max = document.body.scrollHeight - window.innerHeight;
  const pct = max > 0 ? (window.scrollY / max) * 100 : 0;
  progress.style.width = `${pct}%`;
}
window.addEventListener('scroll', updateProgress, { passive: true });
updateProgress();

/* ==========================
   Mobile drawer
========================== */
const menuBtn = $('.menu-btn');
const drawer = $('.drawer');

function openDrawer() {
  if (!drawer || !menuBtn) return;
  drawer.classList.add('open');
  menuBtn.setAttribute('aria-expanded', 'true');
  drawer.setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
  if (!drawer || !menuBtn) return;
  drawer.classList.remove('open');
  menuBtn.setAttribute('aria-expanded', 'false');
  drawer.setAttribute('aria-hidden', 'true');
}

menuBtn?.addEventListener('click', () => {
  drawer.classList.contains('open') ? closeDrawer() : openDrawer();
});

document.addEventListener('click', (e) => {
  if (!drawer || !menuBtn) return;
  const clickedInside = drawer.contains(e.target) || menuBtn.contains(e.target);
  if (!clickedInside) closeDrawer();
});

/* ==========================
   Spotlight (luz seguindo mouse)
========================== */
function attachSpotlight(elements) {
  elements.forEach(el => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * 100;
      const my = ((e.clientY - r.top) / r.height) * 100;
      el.style.setProperty('--mx', `${mx}%`);
      el.style.setProperty('--my', `${my}%`);
    });
  });
}
attachSpotlight($$('.card'));
attachSpotlight($$('.feature'));
attachSpotlight($$('.hero-card'));
attachSpotlight($$('.profile-card'));
attachSpotlight($$('.contact-card'));

/* ==========================
   Magnetic CTA (sutil)
========================== */
$$('.cta').forEach(btn => {
  btn.addEventListener('pointermove', (e) => {
    const r = btn.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    btn.style.transform = `translate(${x * 0.12}px, ${y * 0.12}px) translateY(-2px)`;
  });
  btn.addEventListener('pointerleave', () => {
    btn.style.transform = '';
  });
});

/* =========================================================
   [Equipe da Esther | Dev #19]
   GSAP + ScrollTrigger (Nike-style motion)
   ========================================================= */
gsap.registerPlugin(ScrollTrigger);

/* ==========================
   Split words (CORRIGIDO)
   - Não usa espaço dentro do span.
   - Insere espaço real entre spans.
   => Isso evita letras/palavras grudadas.
========================== */
function splitWordsSafe(el) {
  const raw = el.textContent.trim();
  if (!raw) return;

  const words = raw.split(/\s+/);
  const wrapper = document.createElement('span');
  wrapper.className = 'split';
  wrapper.setAttribute('aria-label', raw);

  words.forEach((w, i) => {
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = w;
    wrapper.appendChild(span);

    // [Equipe da Esther | Dev #20] espaço real entre spans
    if (i < words.length - 1) wrapper.appendChild(document.createTextNode(' '));
  });

  el.textContent = '';
  el.appendChild(wrapper);
}

$$('[data-split="words"]').forEach(el => splitWordsSafe(el));

/* ==========================
   HERO word reveal
========================== */
gsap.to('.hero .headline .w', {
  y: 0,
  opacity: 1,
  duration: 1.0,
  ease: 'power4.out',
  stagger: 0.06,
  delay: 0.15
});

gsap.to('.hero .reveal', {
  y: 0,
  opacity: 1,
  duration: 0.9,
  ease: 'power3.out',
  stagger: 0.08,
  delay: 0.35
});

/* ==========================
   Titles (Manifesto/Sections/Contato)
========================== */
$$('.split-target').forEach((title) => {
  const words = title.querySelectorAll('.w');
  if (!words.length) return;

  gsap.to(words, {
    scrollTrigger: {
      trigger: title,
      start: 'top 80%',
      toggleActions: 'play none none reverse'
    },
    y: 0,
    opacity: 1,
    duration: 0.9,
    ease: 'power4.out',
    stagger: 0.045
  });
});

/* ==========================
   Generic reveals
========================== */
gsap.utils.toArray('.reveal').forEach((el) => {
  gsap.to(el, {
    scrollTrigger: {
      trigger: el,
      start: 'top 82%',
      toggleActions: 'play none none reverse'
    },
    y: 0,
    opacity: 1,
    duration: 0.85,
    ease: 'power3.out'
  });
});

/* ==========================
   Parallax blobs (scrub)
========================== */
gsap.to('.blob-1', { y: 140, scrollTrigger: { scrub: true } });
gsap.to('.blob-2', { y: 220, scrollTrigger: { scrub: true } });
gsap.to('.blob-3', { y: 120, scrollTrigger: { scrub: true } });

/* ==========================
   Manifesto pin + scrub (Nike keynote vibe)
========================== */
const manifesto = document.querySelector('.manifesto');
if (manifesto) {
  gsap.to('.manifesto-inner', {
    scrollTrigger: {
      trigger: manifesto,
      start: 'top top',
      end: '+=520',
      pin: true,
      scrub: true
    },
    scale: 1.03,
    ease: 'none'
  });
}
