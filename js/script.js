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
const registrationVerifyView = document.getElementById("registrationVerifyView");
const registrationVerifyForm = document.getElementById("registrationVerifyForm");
const registrationVerifyEmail = document.getElementById("registrationVerifyEmail");
const registrationVerifyError = document.getElementById("registrationVerifyError");
const registrationVerifySubmit = document.getElementById("registrationVerifySubmit");
const registrationResendCode = document.getElementById("registrationResendCode");
const registrationBackToForm = document.getElementById("registrationBackToForm");
const registrationSuccess = document.getElementById("registrationSuccess");
const registrationError = document.getElementById("registrationError");
const registrationSubmit = document.getElementById("registrationSubmit");
const registrationPasswordField = document.getElementById("registrationPasswordField");
const registrationReferralCode = document.getElementById("registrationReferralCode");
const registrationReferralApply = document.getElementById("registrationReferralApply");
const registrationReferralMessage = document.getElementById("registrationReferralMessage");
const registrationReferralSummary = document.getElementById("registrationReferralSummary");
const registrationReferralPartner = document.getElementById("registrationReferralPartner");
const registrationReferralAppliedCode = document.getElementById("registrationReferralAppliedCode");
const registrationReferralRule = document.getElementById("registrationReferralRule");
const registrationReferralOriginal = document.getElementById("registrationReferralOriginal");
const registrationReferralDiscount = document.getElementById("registrationReferralDiscount");
const registrationReferralFinal = document.getElementById("registrationReferralFinal");
const registrationReferralSuccess = document.getElementById("registrationReferralSuccess");
let registrationAuthenticated = false;
let pendingRegistrationData = null;
let registrationReferralPreview = null;

function setRegistrationOpen(open) {
  if (!registrationModal) return;
  registrationModal.classList.toggle("is-open", open);
  registrationModal.setAttribute("aria-hidden", String(!open));
  document.body.classList.toggle("modal-open", open);
  if (open) {
    registrationModal.querySelector("input:not([type='hidden'])")?.focus();
  } else {
    document.getElementById("openRegistration")?.focus();
  }
}

function showRegistrationView(view) {
  if (registrationFormView) registrationFormView.hidden = view !== "form";
  if (registrationVerifyView) registrationVerifyView.hidden = view !== "verify";
  if (registrationSuccess) registrationSuccess.hidden = view !== "success";
}

function setRegistrationAuthenticated(authenticated) {
  registrationAuthenticated = Boolean(authenticated);
  const password = registrationForm?.elements?.password;
  const email = registrationForm?.elements?.email;
  if (registrationPasswordField) registrationPasswordField.hidden = registrationAuthenticated;
  if (password) {
    password.required = !registrationAuthenticated;
    if (registrationAuthenticated) password.value = "";
  }
  if (email) email.readOnly = registrationAuthenticated;
}

function referralMoney(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function normalizeReferralInput(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}

function clearRegistrationReferral(message = "", error = false) {
  registrationReferralPreview = null;
  if (registrationReferralSummary) registrationReferralSummary.hidden = true;
  if (registrationReferralMessage) {
    registrationReferralMessage.textContent = message;
    registrationReferralMessage.classList.toggle("is-error", error);
    registrationReferralMessage.classList.remove("is-success");
  }
}

async function validateRegistrationReferral({ quietEmpty = false } = {}) {
  if (!registrationReferralCode) return null;
  const code = normalizeReferralInput(registrationReferralCode.value);
  registrationReferralCode.value = code;
  if (!code) {
    clearRegistrationReferral(quietEmpty ? "" : "Digite um código para validar.", !quietEmpty);
    return null;
  }

  if (registrationReferralApply) {
    registrationReferralApply.disabled = true;
    registrationReferralApply.textContent = "VALIDANDO...";
  }
  if (registrationReferralMessage) {
    registrationReferralMessage.textContent = "Validando cupom de indicação...";
    registrationReferralMessage.classList.remove("is-error", "is-success");
  }

  try {
    const result = await registrationRequest("/api/referrals/validate", {
      method: "POST",
      body: JSON.stringify({
        code,
        source_type: "event",
        email: registrationForm?.elements?.email?.value || "",
        phone: registrationForm?.elements?.phone?.value || ""
      })
    });

    if (!result.valid) {
      clearRegistrationReferral(result.message || "Cupom inválido ou indisponível. Verifique o código informado.", true);
      return result;
    }

    registrationReferralPreview = result;
    if (registrationReferralPartner) registrationReferralPartner.textContent = result.partner_name || "Parceiro DOGFIT";
    if (registrationReferralAppliedCode) registrationReferralAppliedCode.textContent = result.code || code;
    if (registrationReferralRule) {
      registrationReferralRule.textContent = result.discount_type === "percentage"
        ? `${Number(result.discount_percentage || 0).toLocaleString("pt-BR")}%`
        : referralMoney(result.discount_fixed_cents);
    }
    if (registrationReferralOriginal) registrationReferralOriginal.textContent = referralMoney(result.original_amount_cents);
    if (registrationReferralDiscount) registrationReferralDiscount.textContent = `- ${referralMoney(result.discount_amount_cents)}`;
    if (registrationReferralFinal) registrationReferralFinal.textContent = referralMoney(result.final_amount_cents);
    if (registrationReferralSummary) registrationReferralSummary.hidden = false;
    if (registrationReferralMessage) {
      registrationReferralMessage.textContent = result.message || `Cupom ${code} aplicado.`;
      registrationReferralMessage.classList.remove("is-error");
      registrationReferralMessage.classList.add("is-success");
    }
    try { sessionStorage.setItem("dogfit_referral_code", result.code || code); } catch {}
    return result;
  } catch (caught) {
    clearRegistrationReferral("Não foi possível validar o cupom agora. Você ainda pode continuar a pré-inscrição sem ele.", true);
    return null;
  } finally {
    if (registrationReferralApply) {
      registrationReferralApply.disabled = false;
      registrationReferralApply.textContent = "APLICAR";
    }
  }
}

async function registrationRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const caught = new Error(result.error || "Não foi possível continuar.");
    caught.code = result.code || "";
    caught.status = response.status;
    throw caught;
  }
  return result;
}

async function prefillRegistration() {
  if (!registrationForm) return;
  try {
    const session = await registrationRequest("/api/client/session");
    setRegistrationAuthenticated(session.authenticated);
    if (!session.authenticated) return;
    const { customer } = await registrationRequest("/api/client/dashboard");
    ["full_name", "birth_date", "phone", "email", "dog_name", "dog_breed", "dog_count", "sociability"]
      .forEach(name => {
        const field = registrationForm.elements[name];
        if (field && customer[name] != null) field.value = customer[name];
      });
  } catch {
    setRegistrationAuthenticated(false);
  }
}

function registrationPayload() {
  const data = Object.fromEntries(new FormData(registrationForm).entries());
  data.dog_count = Number(data.dog_count || 1);
  data.recreational_terms_accepted = registrationForm.elements.recreational_terms_accepted.checked;
  data.muzzle_terms_accepted = registrationForm.elements.muzzle_terms_accepted.checked;
  data.privacy_accepted = registrationForm.elements.privacy_accepted.checked;
  return data;
}

async function finishEventRegistration(data) {
  const result = await registrationRequest("/api/events/register", {
    method: "POST",
    body: JSON.stringify(data)
  });
  if (!result.payment_url) throw new Error("O pagamento não foi disponibilizado. Tente novamente.");
  document.getElementById("registrationCode").textContent = result.registration_code;
  document.getElementById("registrationPaymentLink").href = result.payment_url;
  if (registrationReferralSuccess) {
    if (result.referral?.applied) {
      registrationReferralSuccess.hidden = false;
      registrationReferralSuccess.textContent = `Cupom ${result.referral.code} aplicado por ${result.referral.partner_name}: ${referralMoney(result.referral.discount_amount_cents)} de desconto. Valor final ${referralMoney(result.referral.final_amount_cents)}. A comissão do parceiro será contabilizada após a confirmação do pagamento.`;
    } else if (result.referral?.warning) {
      registrationReferralSuccess.hidden = false;
      registrationReferralSuccess.textContent = result.referral.warning;
    } else {
      registrationReferralSuccess.hidden = true;
      registrationReferralSuccess.textContent = "";
    }
  }
  showRegistrationView("success");
  registrationSuccess?.scrollIntoView({ block: "start" });
  pendingRegistrationData = null;
  registrationForm.reset();
  registrationReferralPreview = null;
  try { sessionStorage.removeItem("dogfit_referral_code"); } catch {}
  setTimeout(() => location.assign(result.payment_url), 1200);
}

async function ensureRegistrationAccount(data) {
  if (registrationAuthenticated) return true;
  const password = String(data.password || "");
  if (password.length < 8) throw new Error("Crie uma senha com pelo menos 8 caracteres para sua conta DOGFIT.");

  const accountData = {
    full_name: data.full_name,
    birth_date: data.birth_date,
    phone: data.phone,
    email: data.email,
    dog_name: data.dog_name,
    dog_breed: data.dog_breed,
    dog_count: data.dog_count,
    sociability: data.sociability,
    password,
    privacy_accepted: data.privacy_accepted
  };

  try {
    const result = await registrationRequest("/api/client/register", {
      method: "POST",
      body: JSON.stringify(accountData)
    });
    if (result.verification_required) {
      pendingRegistrationData = { ...data };
      delete pendingRegistrationData.password;
      if (registrationVerifyEmail) registrationVerifyEmail.textContent = data.email;
      if (registrationVerifyError) registrationVerifyError.textContent = result.message || "";
      showRegistrationView("verify");
      registrationVerifyForm?.elements?.code?.focus();
      return false;
    }
  } catch (caught) {
    if (caught.code !== "EMAIL_EXISTS") throw caught;
    // O e-mail já pertence a uma conta confirmada. A própria senha informada
    // no formulário funciona como login, sem tirar o cliente da pré-inscrição.
    try {
      await registrationRequest("/api/client/login", {
        method: "POST",
        body: JSON.stringify({ email: data.email, password })
      });
      setRegistrationAuthenticated(true);
      return true;
    } catch (loginError) {
      if (loginError.code === "EMAIL_NOT_VERIFIED") {
        pendingRegistrationData = { ...data };
        delete pendingRegistrationData.password;
        if (registrationVerifyEmail) registrationVerifyEmail.textContent = data.email;
        if (registrationVerifyError) registrationVerifyError.textContent = loginError.message;
        showRegistrationView("verify");
        return false;
      }
      if (loginError.status === 401) {
        throw new Error("Este e-mail já possui uma conta DOGFIT. Informe a senha dessa conta para continuar a pré-inscrição.");
      }
      throw loginError;
    }
  }
  return false;
}

async function openRegistrationFlow() {
  showRegistrationView("form");
  if (registrationError) registrationError.textContent = "";
  if (registrationVerifyError) registrationVerifyError.textContent = "";
  setRegistrationOpen(true);
  await prefillRegistration();
  if (registrationReferralCode?.value) await validateRegistrationReferral({ quietEmpty: true });
}

document.getElementById("openRegistration")?.addEventListener("click", openRegistrationFlow);

document.querySelectorAll("[data-close-registration]").forEach(button => {
  button.addEventListener("click", () => setRegistrationOpen(false));
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && registrationModal?.classList.contains("is-open")) {
    setRegistrationOpen(false);
  }
});

registrationReferralCode?.addEventListener("input", () => {
  const normalized = normalizeReferralInput(registrationReferralCode.value);
  if (registrationReferralCode.value !== normalized) registrationReferralCode.value = normalized;
  if (registrationReferralPreview?.code !== normalized) clearRegistrationReferral();
});

registrationReferralApply?.addEventListener("click", () => validateRegistrationReferral());

registrationReferralCode?.addEventListener("blur", () => {
  if (registrationReferralCode.value && !registrationReferralPreview) {
    validateRegistrationReferral({ quietEmpty: true });
  }
});

registrationForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const data = registrationPayload();
  registrationError.textContent = "";
  registrationSubmit.disabled = true;
  registrationSubmit.textContent = registrationAuthenticated ? "ENVIANDO..." : "CRIANDO ACESSO SEGURO...";

  try {
    const ready = await ensureRegistrationAccount(data);
    if (!ready) return;
    const registrationData = { ...data };
    delete registrationData.password;
    await finishEventRegistration(registrationData);
  } catch (caught) {
    registrationError.textContent = caught.message;
  } finally {
    registrationSubmit.disabled = false;
    registrationSubmit.innerHTML = 'ENVIAR PRÉ-INSCRIÇÃO <span>→</span>';
  }
});

registrationVerifyForm?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!pendingRegistrationData) {
    showRegistrationView("form");
    return;
  }
  const code = String(new FormData(registrationVerifyForm).get("code") || "").replace(/\D/g, "").slice(0, 6);
  registrationVerifyError.textContent = "";
  registrationVerifySubmit.disabled = true;
  registrationVerifySubmit.textContent = "CONFIRMANDO...";
  try {
    await registrationRequest("/api/client/verify-email", {
      method: "POST",
      body: JSON.stringify({ email: pendingRegistrationData.email, code })
    });
    setRegistrationAuthenticated(true);
    await finishEventRegistration(pendingRegistrationData);
  } catch (caught) {
    registrationVerifyError.textContent = caught.message;
  } finally {
    registrationVerifySubmit.disabled = false;
    registrationVerifySubmit.innerHTML = 'CONFIRMAR E CONCLUIR <span>→</span>';
  }
});

registrationResendCode?.addEventListener("click", async () => {
  if (!pendingRegistrationData?.email) return;
  registrationVerifyError.textContent = "";
  registrationResendCode.disabled = true;
  registrationResendCode.textContent = "REENVIANDO...";
  try {
    const result = await registrationRequest("/api/client/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email: pendingRegistrationData.email })
    });
    registrationVerifyError.textContent = result.message || "Novo código enviado.";
  } catch (caught) {
    registrationVerifyError.textContent = caught.message;
  } finally {
    registrationResendCode.disabled = false;
    registrationResendCode.textContent = "REENVIAR CÓDIGO";
  }
});

registrationBackToForm?.addEventListener("click", () => {
  showRegistrationView("form");
  registrationError.textContent = "Confira seus dados e envie novamente quando estiver pronto.";
});

async function initializeRegistrationFlow() {
  const params = new URLSearchParams(location.search);
  const urlReferral = normalizeReferralInput(params.get("ref"));
  let savedReferral = "";
  try { savedReferral = normalizeReferralInput(sessionStorage.getItem("dogfit_referral_code")); } catch {}
  const initialReferral = urlReferral || savedReferral;
  if (registrationReferralCode && initialReferral) registrationReferralCode.value = initialReferral;

  const shouldOpen = location.pathname.replace(/\/+$/, "") === "/pre-inscricao" || Boolean(urlReferral);
  if (shouldOpen) {
    await openRegistrationFlow();
  } else {
    await prefillRegistration();
  }
}

initializeRegistrationFlow();
