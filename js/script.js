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

const mobileTabs = [...document.querySelectorAll("[data-site-tab]")];
const mobilePanels = [...document.querySelectorAll("[data-site-panel]")];
const mobileTabsBar = document.querySelector(".mobile-section-tabs");

function mobileLayout() {
  return window.matchMedia("(max-width: 700px)").matches;
}

function activateSitePanel(panelName, options = {}) {
  const panel = document.querySelector(`[data-site-panel="${panelName}"]`);
  if (!panel) return;

  mobileTabs.forEach(tab => {
    const active = tab.dataset.siteTab === panelName;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    if (active) tab.scrollIntoView({ inline: "center", block: "nearest" });
  });
  mobilePanels.forEach(item => item.classList.toggle("is-active", item === panel));

  if (options.updateHash !== false) {
    history.replaceState(null, "", `#${panelName}`);
  }
  if (options.scroll !== false && mobileLayout()) {
    mobileTabsBar?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

mobileTabs.forEach(tab => {
  tab.addEventListener("click", () => activateSitePanel(tab.dataset.siteTab));
});

document.querySelectorAll('a[href^="#"]').forEach(link => {
  const name = link.getAttribute("href").slice(1);
  if (!mobilePanels.some(panel => panel.dataset.sitePanel === name)) return;
  link.addEventListener("click", event => {
    if (!mobileLayout()) return;
    event.preventDefault();
    activateSitePanel(name);
  });
});

const initialPanel = location.hash.slice(1);
if (mobilePanels.some(panel => panel.dataset.sitePanel === initialPanel)) {
  activateSitePanel(initialPanel, { updateHash: false, scroll: false });
}

const registrationModal = document.getElementById("registrationModal");
const registrationForm = document.getElementById("eventRegistrationForm");
const registrationFormView = document.getElementById("registrationFormView");
const registrationSuccess = document.getElementById("registrationSuccess");
const registrationError = document.getElementById("registrationError");
const registrationSubmit = document.getElementById("registrationSubmit");

function setRegistrationOpen(open) {
  if (!registrationModal) return;
  registrationModal.classList.toggle("is-open", open);
  registrationModal.setAttribute("aria-hidden", String(!open));
  document.body.classList.toggle("modal-open", open);
  if (open) {
    registrationModal.querySelector("input")?.focus();
  } else {
    document.getElementById("openRegistration")?.focus();
  }
}

document.getElementById("openRegistration")?.addEventListener("click", () => {
  registrationFormView.hidden = false;
  registrationSuccess.hidden = true;
  if (registrationError) registrationError.textContent = "";
  setRegistrationOpen(true);
});

document.querySelectorAll("[data-close-registration]").forEach(button => {
  button.addEventListener("click", () => setRegistrationOpen(false));
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && registrationModal?.classList.contains("is-open")) {
    setRegistrationOpen(false);
  }
});

async function prefillRegistration() {
  if (!registrationForm) return;
  try {
    const response = await fetch("/api/client/dashboard", { credentials: "same-origin" });
    if (!response.ok) return;
    const { customer } = await response.json();
    ["full_name", "birth_date", "phone", "email", "dog_name", "dog_breed", "dog_count", "sociability"]
      .forEach(name => {
        const field = registrationForm.elements[name];
        if (field && customer[name] != null) field.value = customer[name];
      });
  } catch {
    // A pré-inscrição continua disponível sem login.
  }
}

registrationForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(registrationForm).entries());
  data.dog_count = Number(data.dog_count || 1);
  data.recreational_terms_accepted = registrationForm.elements.recreational_terms_accepted.checked;
  data.muzzle_terms_accepted = registrationForm.elements.muzzle_terms_accepted.checked;
  data.privacy_accepted = registrationForm.elements.privacy_accepted.checked;
  registrationError.textContent = "";
  registrationSubmit.disabled = true;
  registrationSubmit.textContent = "ENVIANDO...";

  try {
    const response = await fetch("/api/events/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(data)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Não foi possível realizar a pré-inscrição.");
    if (!result.payment_url) throw new Error("O pagamento não foi disponibilizado. Tente novamente.");
    document.getElementById("registrationCode").textContent = result.registration_code;
    document.getElementById("registrationPaymentLink").href = result.payment_url;
    registrationFormView.hidden = true;
    registrationSuccess.hidden = false;
    registrationSuccess.scrollIntoView({ block: "start" });
    registrationForm.reset();
    setTimeout(() => location.assign(result.payment_url), 1200);
  } catch (caught) {
    registrationError.textContent = caught.message;
  } finally {
    registrationSubmit.disabled = false;
    registrationSubmit.innerHTML = 'ENVIAR PRÉ-INSCRIÇÃO <span>→</span>';
  }
});

prefillRegistration();
