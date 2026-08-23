const $ = id => document.getElementById(id);
const STORAGE_KEY = "dogfit_partner_session";
let session = null;
let currentMember = null;

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dateBR(value) {
  if (!value) return "—";
  const parsed = new Date(value.replace(" ", "T") + (value.includes("T") ? "" : "Z"));
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function parseMoney(value) {
  const number = Number(String(value || "0").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && url !== "/api/partner/login") {
    clearSession();
    throw new Error("Sua sessão expirou. Entre novamente.");
  }
  if (!response.ok) {
    const text = await response.text();
    try { throw new Error(JSON.parse(text).error || text); }
    catch (error) { if (error instanceof SyntaxError) throw new Error(text || `Erro ${response.status}`); throw error; }
  }
  return response.status === 204 ? null : response.json();
}

function saveSession(value) {
  session = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  showPortal();
}

function clearSession() {
  session = null;
  currentMember = null;
  localStorage.removeItem(STORAGE_KEY);
  $("loginView").classList.remove("hidden");
  $("portalView").classList.add("hidden");
  $("logoutBtn").classList.add("hidden");
  $("partnerName").textContent = "";
}

function showPortal() {
  $("loginView").classList.add("hidden");
  $("portalView").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
  $("partnerName").textContent = session?.partner?.name || "Parceiro DOGFIT";
  loadHistory();
}

$("loginForm").onsubmit = async event => {
  event.preventDefault();
  $("loginMessage").textContent = "Entrando...";
  try {
    const result = await request("/api/partner/login", { method: "POST", body: JSON.stringify({ email: $("loginEmail").value, access_code: $("loginCode").value }) });
    $("loginMessage").textContent = "";
    saveSession(result);
  } catch (error) { $("loginMessage").textContent = error.message; }
};

$("logoutBtn").onclick = async () => {
  try { await request("/api/partner/logout", { method: "POST" }); } catch {}
  clearSession();
};

function benefitRemaining(item) {
  if (item.remaining == null) return "Disponível";
  return `${item.remaining} de ${item.usage_limit} restante(s)`;
}

function renderMember(data) {
  currentMember = data.member;
  const box = $("memberResult");
  if (!data.member.active) {
    box.innerHTML = `<article class="member-card"><div class="member-head"><div><h2>${escapeHtml(data.member.name)}</h2><div class="member-code">${escapeHtml(data.member.member_code)}</div></div><span class="status off">Associação inativa</span></div><p class="lead">Não aplique descontos. Oriente o cliente a regularizar a situação diretamente com a DOGFIT.</p></article>`;
    return;
  }
  const items = [
    ...data.benefits.map(item => ({ ...item, kind: "benefit", label: benefitRemaining(item), enabled: item.remaining == null || item.remaining > 0 })),
    ...data.coupons.map(item => ({ ...item, kind: "coupon", label: item.available ? `Cupom ${item.code}` : "Já utilizado", enabled: item.available }))
  ];
  box.innerHTML = `
    <article class="member-card">
      <div class="member-head"><div><h2>${escapeHtml(data.member.name)}</h2><div class="member-code">${escapeHtml(data.member.member_code)}</div></div><span class="status">Associação ativa</span></div>
      <div class="member-meta"><span>Cão: <strong>${escapeHtml(data.member.dog_name || "Não informado")}</strong></span><span>Validade: <strong>${escapeHtml(data.member.valid_until ? new Date(`${data.member.valid_until}T00:00:00`).toLocaleDateString("pt-BR") : "Sem prazo")}</strong></span></div>
      <div><h3 class="section-title">Benefícios disponíveis</h3><div class="benefit-grid">${items.length ? items.map(item => `
        <div class="benefit"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description || "")}</p><div class="benefit-foot"><span class="remaining">${escapeHtml(item.label)}</span><button class="btn ${item.enabled ? "btn-primary" : "btn-ghost"}" data-redeem-kind="${item.kind}" data-redeem-id="${item.id}" data-redeem-title="${escapeHtml(item.title)}" ${item.enabled ? "" : "disabled"}>Usar</button></div></div>
      `).join("") : '<div class="empty">Nenhum benefício deste parceiro disponível.</div>'}</div></div>
    </article>`;
  box.querySelectorAll("[data-redeem-kind]").forEach(button => button.onclick = () => openRedeem(button.dataset.redeemKind, Number(button.dataset.redeemId), button.dataset.redeemTitle));
}

$("memberSearchForm").onsubmit = async event => {
  event.preventDefault();
  $("memberResult").innerHTML = '<div class="empty">Consultando...</div>';
  try { renderMember(await request(`/api/partner/member?code=${encodeURIComponent($("memberCode").value.trim())}`)); }
  catch (error) { $("memberResult").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
};

function openRedeem(kind, id, title) {
  $("redeemForm").reset();
  $("redeemKind").value = kind; $("redeemItemId").value = id; $("redeemMemberId").value = currentMember.id; $("redeemTitle").textContent = title; $("redeemResult").innerHTML = "";
  $("redeemDialog").showModal();
}

$("cancelRedeem").onclick = () => $("redeemDialog").close();
$("redeemForm").onsubmit = async event => {
  event.preventDefault();
  try {
    const result = await request("/api/partner/redeem", { method: "POST", body: JSON.stringify({ kind: $("redeemKind").value, item_id: Number($("redeemItemId").value), member_id: Number($("redeemMemberId").value), amount_before: parseMoney($("redeemAmount").value), notes: $("redeemNotes").value }) });
    $("redeemResult").innerHTML = `<div class="success-box">Registrado! Desconto: ${escapeHtml(money(result.discount_amount))} · Total final: ${escapeHtml(money(result.final_amount))}</div>`;
    setTimeout(async () => { $("redeemDialog").close(); await Promise.all([reloadCurrentMember(), loadHistory()]); }, 1600);
  } catch (error) { $("redeemResult").innerHTML = `<div class="message">${escapeHtml(error.message)}</div>`; }
};

async function reloadCurrentMember() {
  if (!currentMember?.member_code) return;
  renderMember(await request(`/api/partner/member?code=${encodeURIComponent(currentMember.member_code)}`));
}

async function loadHistory() {
  try {
    const items = await request("/api/partner/redemptions");
    $("partnerHistory").innerHTML = items.length ? items.slice(0, 30).map(item => `<div class="history-row"><div><strong>${escapeHtml(item.full_name)}</strong><br><span>${escapeHtml(item.benefit_title || item.coupon_title || "Benefício")}</span></div><div><strong>${escapeHtml(money(item.discount_amount))}</strong><br><span>${escapeHtml(dateBR(item.redeemed_at))}</span></div></div>`).join("") : '<div class="empty">Nenhuma utilização registrada.</div>';
  } catch (error) { $("partnerHistory").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
}

$("refreshHistory").onclick = loadHistory;

try {
  session = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (session?.token) request("/api/partner/me").then(showPortal).catch(clearSession);
  else clearSession();
} catch { clearSession(); }
