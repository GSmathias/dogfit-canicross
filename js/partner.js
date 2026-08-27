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

function moneyCents(value) {
  return (Number(value || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dateBR(value) {
  if (!value) return "—";
  const parsed = new Date(value.replace(" ", "T") + (value.includes("T") ? "" : "Z"));
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function parseMoney(value) {
  let normalized = String(value || "0").trim().replace(/[^0-9,.-]/g, "");
  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }
  const number = Number(normalized);
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
  Promise.all([loadHistory(), loadPartnerReferrals()]).catch(() => {});
}


async function copyPartnerReferralLink(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  const button = $("partnerReferralCopy");
  if (button) {
    const old = button.textContent;
    button.textContent = "Link copiado!";
    setTimeout(() => button.textContent = old, 1600);
  }
}

function renderPartnerReferral(data) {
  const box = $("partnerReferralContent");
  const status = $("partnerReferralStatus");
  if (!data?.configured) {
    status.textContent = "Não configurado";
    status.className = "status off";
    box.innerHTML = '<div class="empty">A DOGFIT ainda não configurou um cupom de indicação para este parceiro.</div>';
    return;
  }
  const active = Boolean(data.setting?.active_effective) && (!data.setting.valid_until || data.setting.valid_until >= new Date().toISOString().slice(0, 10));
  status.textContent = active ? "Código ativo" : "Código indisponível";
  status.className = `status${active ? "" : " off"}`;
  box.innerHTML = `
    <div class="referral-partner-layout">
      <div>
        <div class="referral-code-display"><small>SEU CÓDIGO</small><strong>${escapeHtml(data.setting.code)}</strong></div>
        <label class="referral-link-field"><span>Link exclusivo</span><input id="partnerReferralLink" readonly value="${escapeHtml(data.link)}"></label>
        <div class="referral-actions"><button class="btn btn-primary" id="partnerReferralCopy" type="button">Copiar link</button><button class="btn btn-ghost" id="partnerReferralDownload" type="button">Baixar QR Code</button></div>
      </div>
      <div id="partnerReferralQr" class="partner-referral-qr"></div>
    </div>
    <div class="partner-referral-stats">
      <div><span>Indicações</span><strong>${Number(data.stats?.referrals || 0)}</strong></div>
      <div><span>Pagamentos aprovados</span><strong>${Number(data.stats?.approved || 0)}</strong></div>
      <div><span>Total vendido</span><strong>${escapeHtml(moneyCents(data.stats?.total_sold_cents))}</strong></div>
      <div><span>Comissões pendentes</span><strong>${escapeHtml(moneyCents(data.stats?.pending_commission_cents))}</strong></div>
      <div><span>Comissões pagas</span><strong>${escapeHtml(moneyCents(data.stats?.paid_commission_cents))}</strong></div>
    </div>
    <p class="referral-privacy-note">Este portal mostra somente os resultados do seu próprio código. A DOGFIT é a única responsável por confirmar pagamentos e marcar comissões como pagas.</p>`;
  $("partnerReferralCopy").onclick = () => copyPartnerReferralLink(data.link);
  const qrBox = $("partnerReferralQr");
  if (window.QRCode) {
    new QRCode(qrBox, { text: data.link, width: 190, height: 190, correctLevel: QRCode.CorrectLevel.M });
  } else {
    qrBox.innerHTML = '<div class="empty">QR Code indisponível.</div>';
  }
  $("partnerReferralDownload").onclick = () => {
    const canvas = qrBox.querySelector("canvas");
    const image = qrBox.querySelector("img");
    const url = canvas?.toDataURL("image/png") || image?.src;
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = `dogfit-${String(data.setting.code || "indicacao").toLowerCase()}.png`;
    link.click();
  };
}

async function loadPartnerReferrals() {
  try {
    renderPartnerReferral(await request("/api/partner/referrals"));
  } catch (error) {
    $("partnerReferralContent").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    $("partnerReferralStatus").textContent = "Erro";
    $("partnerReferralStatus").className = "status off";
  }
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
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  $("redeemResult").innerHTML = '<div class="message">Registrando utilização...</div>';
  try {
    const result = await request("/api/partner/redeem", {
      method: "POST",
      body: JSON.stringify({
        kind: $("redeemKind").value,
        item_id: Number($("redeemItemId").value),
        member_id: Number($("redeemMemberId").value),
        amount_before: parseMoney($("redeemAmount").value),
        notes: $("redeemNotes").value
      })
    });
    $("redeemResult").innerHTML = `<div class="success-box">Registrado! Desconto: ${escapeHtml(money(result.discount_amount))} · Total final: ${escapeHtml(money(result.final_amount))}</div>`;
    setTimeout(async () => {
      $("redeemDialog").close();
      await Promise.all([reloadCurrentMember(), loadHistory()]);
      if (submit) submit.disabled = false;
    }, 1200);
  } catch (error) {
    $("redeemResult").innerHTML = `<div class="message">${escapeHtml(error.message)}</div>`;
    if (submit) submit.disabled = false;
    await reloadCurrentMember().catch(() => {});
  }
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
