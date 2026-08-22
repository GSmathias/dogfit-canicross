const WHATSAPP_NUMBER = "5562994431333"; 

const menuButton = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
const siteHeader = document.querySelector(".site-header");

menuButton?.addEventListener("click", () => {
  const isOpen = mainNav.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
});

document.querySelectorAll(".main-nav a").forEach((link) => {
  link.addEventListener("click", () => {
    mainNav.classList.remove("open");
    menuButton?.setAttribute("aria-expanded", "false");
  });
});

function bindWhatsappLinks() {
  document.querySelectorAll(".whatsapp-link").forEach((link) => {
    const message =
      link.dataset.message ||
      "Olá! Vim pelo site da DOGFIT CANICROSS.";

    link.href =
      `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

    link.target = "_blank";
    link.rel = "noopener";
  });
}

function setupRevealAnimations() {
  const elements = document.querySelectorAll(".reveal:not([data-reveal-ready])");

  if (!("IntersectionObserver" in window)) {
    elements.forEach(el => el.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        obs.unobserve(entry.target);
      });
    },
    {
      threshold: 0.08,
      rootMargin: "0px 0px -35px 0px"
    }
  );

  elements.forEach((el, index) => {
    el.dataset.revealReady = "1";
    el.style.transitionDelay = `${Math.min(index % 4, 3) * 55}ms`;
    observer.observe(el);
  });
}

function updateHeader() {
  siteHeader?.classList.toggle("scrolled", window.scrollY > 15);
}

function setupActiveNavigation() {
  const navLinks = [...document.querySelectorAll(".main-nav a[href^='#']")];
  const sections = navLinks
    .map(link => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  if (!("IntersectionObserver" in window)) return;

  const sectionObserver = new IntersectionObserver(
    entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) return;

      navLinks.forEach(link => {
        link.classList.toggle(
          "active",
          link.getAttribute("href") === `#${visible.target.id}`
        );
      });
    },
    {
      rootMargin: "-25% 0px -62% 0px",
      threshold: [0.05, 0.2, 0.5]
    }
  );

  sections.forEach(section => sectionObserver.observe(section));
}

function refreshDynamicUI() {
  bindWhatsappLinks();
  setupRevealAnimations();
}

bindWhatsappLinks();
setupRevealAnimations();
setupActiveNavigation();
updateHeader();

window.addEventListener("scroll", updateHeader, { passive: true });

document.addEventListener("dogfit:data-ready", refreshDynamicUI);

const year = document.getElementById("year");
if (year) year.textContent = new Date().getFullYear();
