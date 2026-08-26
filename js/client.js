const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let dashboardData = null;
const accountPath = "/minha-conta";

const escapeHtml = value => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function dateBR(value, withTime = false) {
  if (!value) return "A definir";
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T12:00:00`
    : value.replace(" ", "T") + (value.includes("Z") ? "" : "Z");
  const date = new Date(normalized);
  return date.toLocaleDateString("pt-BR", withTime ? { dateStyle: "short", timeStyle: "short" } : undefined);
}

function toast(message, isError = false) {
  const element = $("#clientToast");
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2800);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || "Não foi possível concluir."), { status: response.status, code: result.code || "" });
  return result;
}

$$('[data-auth]').forEach(button => button.onclick = () => {
  $$('[data-auth]').forEach(item => item.classList.toggle("active", item === button));
  $$('.auth-form').forEach(form => form.classList.toggle("active", form.id.toLowerCase().startsWith(button.dataset.auth)));
});

$$('[data-view]').forEach(button => button.onclick = () => {
  $$('[data-view]').forEach(item => item.classList.toggle("active", item === button));
  $$('[data-dashboard-view]').forEach(view => view.classList.toggle("active", view.dataset.dashboardView === button.dataset.view));
});

function formObject(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  data.dog_count = Number(data.dog_count || 1);
  if (form.elements.privacy_accepted) {
    data.privacy_accepted = form.elements.privacy_accepted.checked;
  }
  return data;
}

function fillForm(form, customer) {
  Object.entries(customer).forEach(([name, value]) => {
    const field = form.elements[name];
    if (field) field.value = value ?? "";
  });
}

function showVerification(email, message = "") {
  $$('[data-auth]').forEach(item => item.classList.remove("active"));
  $$('.auth-form').forEach(form => form.classList.remove("active"));
  const form = $("#verifyForm");
  if (!form) return;
  form.classList.add("active");
  form.elements.email.value = String(email || "").trim().toLowerCase();
  form.elements.code.value = "";
  const copy = $("#verificationMessage");
  if (copy) copy.textContent = message || "Enviamos um código de 6 dígitos. Ele expira em 15 minutos.";
  $('[data-error="verify"]').textContent = "";
  form.elements.code.focus();
}

function showLogin() {
  $$('[data-auth]').forEach(item => item.classList.toggle("active", item.dataset.auth === "login"));
  $$('.auth-form').forEach(form => form.classList.toggle("active", form.id === "loginForm"));
  $('[data-error="login"]').textContent = "";
}

function paymentLabel(status) {
  return { pending: "Aguardando PIX", paid: "Pagamento confirmado", cancelled: "Cancelada" }[status] || status;
}

function renderRegistrations(items) {
  const box = $("#registrationsList");
  if (!items.length) {
    box.innerHTML = '<div class="empty-card"><strong>Nenhuma pré-inscrição ainda.</strong>Quando você se inscrever em um evento usando este e-mail, ela aparecerá aqui.</div>';
    return;
  }
  box.innerHTML = items.map(item => `
    <article class="data-card">
      <div><span class="data-code">${escapeHtml(item.registration_code)}</span><strong>${escapeHtml(item.event_title)}</strong><small>${escapeHtml(item.event_location)} · ${dateBR(item.event_date)} ${escapeHtml(item.event_time || "")}</small></div>
      <div><strong>${escapeHtml(item.dog_name)}</strong><span>${Number(item.dog_count)} cão(ães)</span></div>
      <span class="status ${escapeHtml(item.payment_status)}">${escapeHtml(paymentLabel(item.payment_status))}</span>
    </article>`).join("");
}

function renderMember(member) {
  const box = $("#memberArea");
  if (!member) {
    box.innerHTML = '<div class="empty-card"><strong>Conta ainda não vinculada ao Clube.</strong>Se você já é associado, confira se o e-mail deste cadastro é igual ao informado à DOGFIT.</div>';
    return;
  }
  box.innerHTML = `
    <article class="member-card">
      <div><p class="eyebrow">${member.active ? "MEMBRO ATIVO" : "CADASTRO LOCALIZADO"}</p><h3>${escapeHtml(member.full_name)}</h3><p>${escapeHtml(member.member_code)} · ${escapeHtml(member.plan_name)}<br>Cão: ${escapeHtml(member.dog_name || "Não informado")} · Válido até: ${dateBR(member.valid_until)}</p></div>
      <a class="primary-button" href="${escapeHtml(member.card_url)}" target="_blank" rel="noopener">ABRIR CARTEIRINHA →</a>
    </article>`;
}

function renderPartners(items) {
  const box = $("#partnersList");
  if (!items.length) {
    box.innerHTML = `<div class="empty-card"><strong>Área exclusiva para membros ativos.</strong>${dashboardData?.member ? "Regularize seu cadastro com a DOGFIT para liberar a rede credenciada." : "Ao entrar para o Clube DOGFIT, os pet shops, clínicas e benefícios credenciados aparecerão aqui."}</div>`;
    return;
  }
  box.innerHTML = items.map(item => {
    const instagram = String(item.instagram || "").replace(/^@/, "");
    return `<article class="partner-card">
      <span class="category">${escapeHtml(item.category || "PARCEIRO")}</span>
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.description || "Empresa credenciada ao Clube DOGFIT CANICROSS.")}</p>
      <div class="partner-meta">${item.address ? `<span>📍 ${escapeHtml(item.address)}</span>` : ""}${item.phone ? `<span>☎ ${escapeHtml(item.phone)}</span>` : ""}${instagram ? `<a href="https://instagram.com/${encodeURIComponent(instagram)}" target="_blank" rel="noopener">@${escapeHtml(instagram)}</a>` : ""}</div>
      ${item.benefits ? `<p class="partner-benefit"><strong>Benefícios:</strong> ${escapeHtml(item.benefits)}</p>` : ""}
    </article>`;
  }).join("");
}

function renderDashboard(data) {
  dashboardData = data;
  $("#welcomeName").textContent = `OLÁ, ${data.customer.full_name.split(/\s+/)[0]}`;
  $("#summaryRegistrations").textContent = data.registrations.length;
  $("#summaryPaid").textContent = data.registrations.filter(item => item.payment_status === "paid").length;
  $("#summaryClub").textContent = data.member?.active ? "ATIVO" : data.member ? "PENDENTE" : "NÃO";
  $("#summaryClubText").textContent = data.member?.active ? "carteirinha liberada" : data.member ? "consulte a DOGFIT" : "não vinculado";
  fillForm($("#profileForm"), data.customer);
  renderRegistrations(data.registrations);
  renderMember(data.member);
  renderPartners(data.partners);
}

async function loadDashboard() {
  const data = await request("/api/client/dashboard");
  renderDashboard(data);
}

const loginForm = $("#loginForm");
if (loginForm) loginForm.onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.elements.email?.value || "";
  const error = $('[data-error="login"]'); error.textContent = "";
  try {
    await request("/api/client/login", {
      method: "POST",
      body: JSON.stringify(formObject(form))
    });
    location.assign(accountPath);
  }
  catch (caught) {
    if (caught.code === "EMAIL_NOT_VERIFIED") {
      showVerification(email, caught.message);
      return;
    }
    error.textContent = caught.message;
  }
};

const registerForm = $("#registerForm");
if (registerForm) registerForm.onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.elements.email?.value || "";
  const error = $('[data-error="register"]'); error.textContent = "";
  try {
    const result = await request("/api/client/register", {
      method: "POST",
      body: JSON.stringify(formObject(form))
    });
    if (result.verification_required) {
      showVerification(result.email, result.message);
      return;
    }
    location.assign(accountPath);
  }
  catch (caught) {
    if (caught.code === "EMAIL_PENDING") {
      showVerification(email, "Este e-mail já foi cadastrado e ainda precisa ser confirmado. Digite o código que enviamos ou solicite um novo abaixo.");
      return;
    }
    error.textContent = caught.message;
  }
};

const verifyForm = $("#verifyForm");
if (verifyForm) verifyForm.onsubmit = async event => {
  event.preventDefault();
  const error = $('[data-error="verify"]'); error.textContent = "";
  try {
    await request("/api/client/verify-email", {
      method: "POST",
      body: JSON.stringify({
        email: event.currentTarget.elements.email.value,
        code: event.currentTarget.elements.code.value
      })
    });
    location.assign(accountPath);
  } catch (caught) {
    error.textContent = caught.message;
  }
};

const resendVerification = $("#resendVerification");
if (resendVerification) resendVerification.onclick = async () => {
  const error = $('[data-error="verify"]'); error.textContent = "";
  resendVerification.disabled = true;
  try {
    const result = await request("/api/client/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email: verifyForm.elements.email.value })
    });
    toast(result.message || "Novo código enviado.");
  } catch (caught) {
    error.textContent = caught.message;
  } finally {
    resendVerification.disabled = false;
  }
};

const backToLogin = $("#backToLogin");
if (backToLogin) backToLogin.onclick = showLogin;

const profileForm = $("#profileForm");
if (profileForm) profileForm.onsubmit = async event => {
  event.preventDefault();
  const error = $('[data-error="profile"]'); error.textContent = "";
  try { await request("/api/client/me", { method: "PUT", body: JSON.stringify(formObject(event.currentTarget)) }); await loadDashboard(); toast("Dados atualizados."); }
  catch (caught) { error.textContent = caught.message; }
};

const logoutButton = $("#logoutButton");
if (logoutButton) logoutButton.onclick = async () => {
  try { await request("/api/client/logout", { method: "POST" }); } catch {}
  location.assign("/cliente");
};

const normalizedPath = location.pathname.replace(/\/+$/, "") || "/";
const onAccountPage = normalizedPath === accountPath;

async function initClientArea() {
  if (onAccountPage) {
    try {
      await loadDashboard();
    } catch (caught) {
      if (caught.status === 401) {
        location.replace("/cliente");
        return;
      }
      toast(caught.message, true);
    }
    return;
  }

  try {
    const session = await request("/api/client/session");
    if (session.authenticated) location.replace(accountPath);
  } catch (caught) {
    toast(caught.message, true);
  }
}

initClientArea();
