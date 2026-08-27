const $ = id => document.getElementById(id);
const today = new Date().toISOString().slice(0, 10);

const state = {
  dashboard: {},
  members: [],
  partners: [],
  benefits: [],
  coupons: [],
  redemptions: [],
  referralConfigs: [],
  referrals: []
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function number(value) {
  if (value === "" || value == null) return null;
  let normalized = String(value).trim().replace(/[^0-9,.-]/g, "");
  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function money(value) {
  if (value == null) return "—";
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dateBR(value, withTime = false) {
  if (!value) return "Sem prazo";
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + (value.length === 10 ? "T00:00:00" : "Z");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return withTime
    ? parsed.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : parsed.toLocaleDateString("pt-BR", { dateStyle: "short" });
}

function toast(message, error = false) {
  const element = $("toast");
  element.textContent = message;
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(window.__clubToast);
  window.__clubToast = setTimeout(() => element.className = "toast", 2600);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) {
    const text = await response.text();
    try { throw new Error(JSON.parse(text).error || text); }
    catch (error) { if (error instanceof SyntaxError) throw new Error(text || `Erro ${response.status}`); throw error; }
  }
  return response.status === 204 ? null : response.json();
}

async function removeRecord(url, confirmation, successMessage, refresh) {
  if (!window.confirm(confirmation)) return;
  try {
    await request(url, { method: "DELETE" });
    await refresh();
    toast(successMessage);
  } catch (error) {
    toast(error.message, true);
  }
}

function switchView(name) {
  document.querySelectorAll(".club-view").forEach(view => view.classList.toggle("active", view.id === `${name}View`));
  document.querySelectorAll("[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === name));
  const titles = { overview: "Gestão do Clube", members: "Associados", partners: "Parceiros", benefits: "Benefícios", coupons: "Cupons do Clube", referrals: "Indicações de pet shops", redemptions: "Utilizações" };
  $("viewTitle").textContent = titles[name] || "Gestão do Clube";
  document.querySelector(".sidebar").classList.remove("open");
}

function openEditor(id) {
  $(id).classList.remove("hidden");
  $(id).scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor(id) {
  $(id).classList.add("hidden");
}

document.querySelectorAll("[data-view]").forEach(button => button.onclick = () => switchView(button.dataset.view));
document.querySelectorAll("[data-go]").forEach(button => button.onclick = () => switchView(button.dataset.go));
document.querySelectorAll("[data-close]").forEach(button => button.onclick = () => closeEditor(button.dataset.close));
$("mobileMenu").onclick = () => document.querySelector(".sidebar").classList.toggle("open");

function statusLabel(member) {
  if (member.membership_active) return '<span class="status-pill">Ativo</span>';
  if (member.status === "inactive") return '<span class="status-pill off">Inativo</span>';
  return `<span class="status-pill warn">${member.payment_status === "overdue" ? "Atrasado" : "Pendente"}</span>`;
}

function renderDashboard() {
  $("statMembers").textContent = state.dashboard.members || 0;
  $("statActiveMembers").textContent = state.dashboard.active_members || 0;
  $("statPartners").textContent = state.dashboard.partners || 0;
  $("statRedemptions").textContent = state.dashboard.monthly_redemptions || 0;
}

function renderMembers() {
  const box = $("membersList");
  if (!state.members.length) {
    box.innerHTML = '<div class="empty-state">Nenhum associado encontrado.</div>';
    return;
  }
  box.innerHTML = state.members.map(member => `
    <article class="data-row">
      <div class="data-primary">
        <strong>${escapeHtml(member.full_name)}</strong>
        <span>${escapeHtml(member.dog_name ? `Cão: ${member.dog_name}` : "Cão não informado")}</span>
      </div>
      <div class="data-secondary"><strong class="code-chip">${escapeHtml(member.member_code)}</strong><span>Válido até ${escapeHtml(dateBR(member.valid_until))}</span></div>
      <div class="data-secondary">${statusLabel(member)}<span>${escapeHtml(money(member.monthly_fee))}/mês</span></div>
      <div class="data-actions">
        <button class="small-btn orange" data-use-member="${member.id}">Registrar uso</button>
        <button class="small-btn" data-card="${escapeHtml(member.public_token)}">Carteirinha</button>
        <button class="small-btn" data-edit-member="${member.id}">Editar</button>
        <button class="small-btn danger" data-delete-member="${member.id}">Excluir</button>
      </div>
    </article>
  `).join("");
  box.querySelectorAll("[data-edit-member]").forEach(button => button.onclick = () => editMember(Number(button.dataset.editMember)));
  box.querySelectorAll("[data-card]").forEach(button => button.onclick = () => window.open(`/clube/${button.dataset.card}`, "_blank", "noopener"));
  box.querySelectorAll("[data-use-member]").forEach(button => button.onclick = () => openRedemption(Number(button.dataset.useMember)));
  box.querySelectorAll("[data-delete-member]").forEach(button => button.onclick = () => {
    const member = state.members.find(item => item.id === Number(button.dataset.deleteMember));
    removeRecord(
      `/api/admin/club/members/${button.dataset.deleteMember}`,
      `Excluir definitivamente ${member?.full_name || "este associado"}? Cupons individuais e utilizações vinculadas também poderão ser removidos.`,
      "Associado excluído.",
      async () => {
        await Promise.all([loadMembers(), loadCoupons(), loadRedemptions(), loadDashboard()]);
        fillMemberOptions();
        fillRedemptionItems();
      }
    );
  });
}

function resetMemberForm() {
  $("memberForm").reset();
  $("memberId").value = "";
  $("memberCode").value = "";
  $("memberPlan").value = "Clube DOGFIT CANICROSS";
  $("memberFee").value = "79,90";
  $("memberJoined").value = today;
  $("memberPayment").value = "paid";
  $("memberStatus").value = "active";
  $("memberReferralCode").value = "";
  $("memberReferralCode").readOnly = false;
  $("memberReferralCode").title = "";
  $("memberEditorTitle").textContent = "Novo associado";
}

function editMember(id) {
  const member = state.members.find(item => item.id === id);
  if (!member) return;
  $("memberId").value = member.id;
  $("memberName").value = member.full_name || "";
  $("memberWhatsapp").value = member.whatsapp || "";
  $("memberEmail").value = member.email || "";
  $("memberDog").value = member.dog_name || "";
  $("memberCode").value = member.member_code || "";
  $("memberPlan").value = member.plan_name || "Clube DOGFIT CANICROSS";
  $("memberFee").value = Number(member.monthly_fee || 0).toFixed(2).replace(".", ",");
  $("memberJoined").value = member.joined_on || "";
  $("memberValidUntil").value = member.valid_until || "";
  $("memberPayment").value = member.payment_status || "pending";
  $("memberStatus").value = member.status || "inactive";
  $("memberReferralCode").value = member.referral_code || "";
  $("memberReferralCode").readOnly = Boolean(member.referral_code);
  $("memberReferralCode").title = member.referral_code ? "O cupom já registrado é preservado para manter o histórico financeiro." : "";
  $("memberNotes").value = member.notes || "";
  $("memberEditorTitle").textContent = "Editar associado";
  openEditor("memberEditor");
}

$("newMemberBtn").onclick = () => { resetMemberForm(); openEditor("memberEditor"); };
$("memberForm").onsubmit = async event => {
  event.preventDefault();
  const id = $("memberId").value;
  const data = {
    full_name: $("memberName").value,
    whatsapp: $("memberWhatsapp").value,
    email: $("memberEmail").value,
    dog_name: $("memberDog").value,
    member_code: $("memberCode").value,
    plan_name: $("memberPlan").value,
    monthly_fee: number($("memberFee").value),
    joined_on: $("memberJoined").value,
    valid_until: $("memberValidUntil").value,
    payment_status: $("memberPayment").value,
    status: $("memberStatus").value,
    referral_code: $("memberReferralCode").value,
    notes: $("memberNotes").value
  };
  try {
    const result = await request(id ? `/api/admin/club/members/${id}` : "/api/admin/club/members", { method: id ? "PUT" : "POST", body: JSON.stringify(data) });
    closeEditor("memberEditor");
    await Promise.all([loadMembers(), loadDashboard(), loadReferralConfigs(), loadReferrals()]);
    fillMemberOptions();
    renderReferralTotals();
    toast(result.referral_warning || (id ? "Associado atualizado." : "Associado cadastrado."), Boolean(result.referral_warning));
  } catch (error) { toast(error.message, true); }
};

let searchTimer;
$("memberSearch").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadMembers($("memberSearch").value), 250);
};

function renderPartners() {
  const box = $("partnersList");
  if (!state.partners.length) {
    box.innerHTML = '<div class="empty-state">Nenhuma empresa parceira cadastrada.</div>';
    return;
  }
  box.innerHTML = state.partners.map(partner => `
    <article class="data-row">
      <div class="data-primary"><strong>${escapeHtml(partner.name)}</strong><span>${escapeHtml(partner.category || "Parceiro")} · ${escapeHtml(partner.email)}</span></div>
      <div class="data-secondary"><strong>${Number(partner.redemptions || 0)}</strong><span>utilizações registradas</span></div>
      <div class="data-secondary"><span class="status-pill${partner.active ? "" : " off"}">${partner.active ? "Acesso ativo" : "Desativado"}</span></div>
      <div class="data-actions"><button class="small-btn" data-edit-partner="${partner.id}">Editar</button><button class="small-btn danger" data-delete-partner="${partner.id}">Excluir</button></div>
    </article>
  `).join("");
  box.querySelectorAll("[data-edit-partner]").forEach(button => button.onclick = () => editPartner(Number(button.dataset.editPartner)));
  box.querySelectorAll("[data-delete-partner]").forEach(button => button.onclick = () => {
    const partner = state.partners.find(item => item.id === Number(button.dataset.deletePartner));
    removeRecord(
      `/api/admin/club/partners/${button.dataset.deletePartner}`,
      `Remover ${partner?.name || "este parceiro"}? Se houver histórico de utilizações, indicações ou comissões, o parceiro será apenas desativado para preservar a auditoria financeira.`,
      "Parceiro removido ou desativado com histórico preservado.",
      async () => {
        await Promise.all([loadPartners(), loadBenefits(), loadCoupons(), loadRedemptions(), loadDashboard(), loadReferralConfigs(), loadReferrals()]);
        fillPartnerOptions();
        fillReferralOptions();
        fillRedemptionItems();
        renderReferralTotals();
      }
    );
  });
}

function resetPartnerForm() {
  $("partnerForm").reset();
  $("partnerId").value = "";
  $("partnerActive").checked = true;
  $("partnerPublicVisible").checked = true;
  $("partnerAccessCode").required = true;
  $("partnerPasswordHint").textContent = "mínimo 6 caracteres";
  $("partnerEditorTitle").textContent = "Novo parceiro";
}

function editPartner(id) {
  const partner = state.partners.find(item => item.id === id);
  if (!partner) return;
  $("partnerId").value = partner.id;
  $("partnerName").value = partner.name || "";
  $("partnerEmail").value = partner.email || "";
  $("partnerAccessCode").value = "";
  $("partnerAccessCode").required = false;
  $("partnerActive").checked = Boolean(partner.active);
  $("partnerCategory").value = partner.category || "Pet shop";
  $("partnerPhone").value = partner.phone || "";
  $("partnerAddress").value = partner.address || "";
  $("partnerInstagram").value = partner.instagram || "";
  $("partnerDescription").value = partner.description || "";
  $("partnerPublicVisible").checked = Boolean(partner.public_visible);
  $("partnerPasswordHint").textContent = "deixe em branco para manter";
  $("partnerEditorTitle").textContent = "Editar parceiro";
  openEditor("partnerEditor");
}

$("partnerPortalUrl").textContent = `${location.origin}/parceiro`;
$("newPartnerBtn").onclick = () => { resetPartnerForm(); openEditor("partnerEditor"); };
$("partnerForm").onsubmit = async event => {
  event.preventDefault();
  const id = $("partnerId").value;
  const data = {
    name: $("partnerName").value,
    email: $("partnerEmail").value,
    access_code: $("partnerAccessCode").value,
    active: $("partnerActive").checked,
    category: $("partnerCategory").value,
    phone: $("partnerPhone").value,
    address: $("partnerAddress").value,
    instagram: $("partnerInstagram").value,
    description: $("partnerDescription").value,
    public_visible: $("partnerPublicVisible").checked
  };
  try {
    await request(id ? `/api/admin/club/partners/${id}` : "/api/admin/club/partners", { method: id ? "PUT" : "POST", body: JSON.stringify(data) });
    closeEditor("partnerEditor");
    await Promise.all([loadPartners(), loadDashboard(), loadReferralConfigs()]);
    fillPartnerOptions();
    fillReferralOptions();
    toast(id ? "Parceiro atualizado." : "Parceiro cadastrado.");
  } catch (error) { toast(error.message, true); }
};

function benefitValue(item) {
  if (item.benefit_type === "percentage") return `${item.value}%`;
  if (item.benefit_type === "fixed") return money(item.value);
  if (item.benefit_type === "credit") return "Grátis";
  return "Item";
}

function periodLabel(period) {
  return ({ monthly: "por mês", annual: "por ano", once: "uma vez", unlimited: "sem limite" })[period] || period;
}

function renderBenefits() {
  const box = $("benefitsList");
  if (!state.benefits.length) { box.innerHTML = '<div class="empty-state">Nenhum benefício cadastrado.</div>'; return; }
  box.innerHTML = state.benefits.map(item => `
    <article class="data-row">
      <div class="data-primary"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.description || "Sem descrição")}</span></div>
      <div class="data-secondary"><strong>${escapeHtml(item.partner_name || "DOGFIT")}</strong><span>${escapeHtml(item.usage_limit ? `${item.usage_limit} ${periodLabel(item.period)}` : periodLabel(item.period))}</span></div>
      <div class="data-secondary"><strong class="value-highlight">${escapeHtml(benefitValue(item))}</strong><span class="status-pill${item.active ? "" : " off"}">${item.active ? "Ativo" : "Inativo"}</span></div>
      <div class="data-actions"><button class="small-btn" data-edit-benefit="${item.id}">Editar</button><button class="small-btn danger" data-delete-benefit="${item.id}">Excluir</button></div>
    </article>
  `).join("");
  box.querySelectorAll("[data-edit-benefit]").forEach(button => button.onclick = () => editBenefit(Number(button.dataset.editBenefit)));
  box.querySelectorAll("[data-delete-benefit]").forEach(button => button.onclick = () => {
    const item = state.benefits.find(value => value.id === Number(button.dataset.deleteBenefit));
    removeRecord(
      `/api/admin/club/benefits/${button.dataset.deleteBenefit}`,
      `Excluir definitivamente o benefício “${item?.title || "selecionado"}”?`,
      "Benefício excluído.",
      async () => { await Promise.all([loadBenefits(), loadRedemptions()]); fillRedemptionItems(); }
    );
  });
}

function resetBenefitForm() {
  $("benefitForm").reset(); $("benefitId").value = ""; $("benefitValue").value = "0"; $("benefitPeriod").value = "unlimited"; $("benefitActive").checked = true; $("benefitEditorTitle").textContent = "Novo benefício";
}

function editBenefit(id) {
  const item = state.benefits.find(value => value.id === id); if (!item) return;
  $("benefitId").value = item.id; $("benefitTitle").value = item.title || ""; $("benefitDescription").value = item.description || ""; $("benefitPartner").value = item.partner_id || ""; $("benefitType").value = item.benefit_type; $("benefitValue").value = item.value ?? 0; $("benefitPeriod").value = item.period; $("benefitLimit").value = item.usage_limit ?? ""; $("benefitStart").value = item.starts_on || ""; $("benefitEnd").value = item.ends_on || ""; $("benefitActive").checked = Boolean(item.active); $("benefitEditorTitle").textContent = "Editar benefício"; openEditor("benefitEditor");
}

$("newBenefitBtn").onclick = () => { resetBenefitForm(); openEditor("benefitEditor"); };
$("benefitForm").onsubmit = async event => {
  event.preventDefault(); const id = $("benefitId").value;
  const data = { title: $("benefitTitle").value, description: $("benefitDescription").value, partner_id: $("benefitPartner").value || null, benefit_type: $("benefitType").value, value: number($("benefitValue").value) || 0, period: $("benefitPeriod").value, usage_limit: $("benefitLimit").value || null, starts_on: $("benefitStart").value, ends_on: $("benefitEnd").value, active: $("benefitActive").checked };
  try { await request(id ? `/api/admin/club/benefits/${id}` : "/api/admin/club/benefits", { method: id ? "PUT" : "POST", body: JSON.stringify(data) }); closeEditor("benefitEditor"); await loadBenefits(); fillRedemptionItems(); toast("Benefício salvo."); } catch (error) { toast(error.message, true); }
};

function renderCoupons() {
  const box = $("couponsList");
  if (!state.coupons.length) { box.innerHTML = '<div class="empty-state">Nenhum cupom cadastrado.</div>'; return; }
  box.innerHTML = state.coupons.map(item => `
    <article class="data-row">
      <div class="data-primary"><strong>${escapeHtml(item.title)}</strong><span class="code-chip">${escapeHtml(item.code)}</span></div>
      <div class="data-secondary"><strong>${escapeHtml(item.partner_name || "DOGFIT")}</strong><span>${escapeHtml(item.member_name || "Todos os associados")}</span></div>
      <div class="data-secondary"><strong class="value-highlight">${item.discount_type === "percentage" ? `${item.discount_value}%` : money(item.discount_value)}</strong><span>${Number(item.uses || 0)} uso(s) · ${item.active ? "ativo" : "inativo"}</span></div>
      <div class="data-actions"><button class="small-btn" data-edit-coupon="${item.id}">Editar</button><button class="small-btn danger" data-delete-coupon="${item.id}">Excluir</button></div>
    </article>
  `).join("");
  box.querySelectorAll("[data-edit-coupon]").forEach(button => button.onclick = () => editCoupon(Number(button.dataset.editCoupon)));
  box.querySelectorAll("[data-delete-coupon]").forEach(button => button.onclick = () => {
    const item = state.coupons.find(value => value.id === Number(button.dataset.deleteCoupon));
    removeRecord(
      `/api/admin/club/coupons/${button.dataset.deleteCoupon}`,
      `Excluir definitivamente o cupom “${item?.code || "selecionado"}”?`,
      "Cupom excluído.",
      async () => { await Promise.all([loadCoupons(), loadRedemptions(), loadDashboard()]); fillRedemptionItems(); }
    );
  });
}

function resetCouponForm() {
  $("couponForm").reset(); $("couponId").value = ""; $("couponMemberLimit").value = "1"; $("couponActive").checked = true; $("couponEditorTitle").textContent = "Novo cupom";
}

function editCoupon(id) {
  const item = state.coupons.find(value => value.id === id); if (!item) return;
  $("couponId").value = item.id; $("couponCode").value = item.code || ""; $("couponTitle").value = item.title || ""; $("couponDescription").value = item.description || ""; $("couponPartner").value = item.partner_id || ""; $("couponMember").value = item.member_id || ""; $("couponType").value = item.discount_type; $("couponValue").value = item.discount_value ?? ""; $("couponTotalLimit").value = item.total_limit ?? ""; $("couponMemberLimit").value = item.per_member_limit ?? 1; $("couponStart").value = item.starts_on || ""; $("couponEnd").value = item.ends_on || ""; $("couponActive").checked = Boolean(item.active); $("couponEditorTitle").textContent = "Editar cupom"; openEditor("couponEditor");
}

$("newCouponBtn").onclick = () => { resetCouponForm(); openEditor("couponEditor"); };
$("couponForm").onsubmit = async event => {
  event.preventDefault(); const id = $("couponId").value;
  const data = { code: $("couponCode").value, title: $("couponTitle").value, description: $("couponDescription").value, partner_id: $("couponPartner").value || null, member_id: $("couponMember").value || null, discount_type: $("couponType").value, discount_value: number($("couponValue").value), total_limit: $("couponTotalLimit").value || null, per_member_limit: $("couponMemberLimit").value || 1, starts_on: $("couponStart").value, ends_on: $("couponEnd").value, active: $("couponActive").checked };
  try { await request(id ? `/api/admin/club/coupons/${id}` : "/api/admin/club/coupons", { method: id ? "PUT" : "POST", body: JSON.stringify(data) }); closeEditor("couponEditor"); await Promise.all([loadCoupons(), loadDashboard()]); fillRedemptionItems(); toast("Cupom salvo."); } catch (error) { toast(error.message, true); }
};

function renderRedemptions() {
  const box = $("redemptionsList");
  if (!state.redemptions.length) { box.innerHTML = '<div class="empty-state">Nenhuma utilização registrada.</div>'; return; }
  box.innerHTML = state.redemptions.map(item => `
    <article class="data-row">
      <div class="data-primary"><strong>${escapeHtml(item.full_name)}</strong><span class="code-chip">${escapeHtml(item.member_code)}</span></div>
      <div class="data-secondary"><strong>${escapeHtml(item.benefit_title || item.coupon_title || "Benefício")}</strong><span>${escapeHtml(item.coupon_code || item.partner_name || "DOGFIT")}</span></div>
      <div class="data-secondary"><strong>${escapeHtml(item.partner_name || "DOGFIT")}</strong><span>${escapeHtml(dateBR(item.redeemed_at, true))}</span></div>
      <div class="data-actions"><span class="value-highlight">${escapeHtml(money(item.discount_amount))}</span><button class="small-btn danger" data-delete-redemption="${item.id}">Excluir</button></div>
    </article>
  `).join("");
  box.querySelectorAll("[data-delete-redemption]").forEach(button => button.onclick = () => {
    removeRecord(
      `/api/admin/club/redemptions/${button.dataset.deleteRedemption}`,
      "Excluir definitivamente este registro de utilização?",
      "Utilização excluída.",
      async () => { await Promise.all([loadRedemptions(), loadDashboard()]); }
    );
  });
}

$("redemptionSearch").oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadRedemptions($("redemptionSearch").value), 250); };

function fillPartnerOptions() {
  const options = state.partners.filter(item => item.active).map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
  $("benefitPartner").innerHTML = `<option value="">DOGFIT (sem parceiro)</option>${options}`;
  $("couponPartner").innerHTML = `<option value="">DOGFIT (sem parceiro)</option>${options}`;
}

function fillMemberOptions() {
  const options = state.members.map(item => `<option value="${item.id}">${escapeHtml(item.full_name)} · ${escapeHtml(item.member_code)}</option>`).join("");
  $("couponMember").innerHTML = '<option value="">Todos os associados</option>' + options;
  $("redemptionMember").innerHTML = '<option value="">Selecione</option>' + options;
}

function fillRedemptionItems(options = null) {
  if (!options) {
    $("redemptionItem").innerHTML = '<option value="">Selecione primeiro um associado</option>';
    $("redemptionItem").disabled = true;
    return;
  }

  const benefits = (options.benefits || [])
    .filter(item => item.remaining == null || Number(item.remaining) > 0)
    .map(item => {
      const remaining = item.remaining == null
        ? "disponível"
        : `${item.remaining} de ${item.usage_limit} restante(s)`;
      return `<option value="benefit:${item.id}">Benefício · ${escapeHtml(item.title)}${item.partner_name ? ` (${escapeHtml(item.partner_name)})` : ""} · ${escapeHtml(remaining)}</option>`;
    }).join("");

  const coupons = (options.coupons || [])
    .filter(item => item.available)
    .map(item => `<option value="coupon:${item.id}">Cupom · ${escapeHtml(item.code)} · ${escapeHtml(item.title)}</option>`)
    .join("");

  $("redemptionItem").innerHTML = `<option value="">Selecione</option><optgroup label="Benefícios disponíveis">${benefits || '<option disabled>Nenhum benefício disponível</option>'}</optgroup><optgroup label="Cupons disponíveis">${coupons || '<option disabled>Nenhum cupom disponível</option>'}</optgroup>`;
  $("redemptionItem").disabled = false;
}

async function loadRedemptionOptions(memberId) {
  const id = Number(memberId);
  if (!Number.isInteger(id) || id <= 0) {
    fillRedemptionItems(null);
    return null;
  }

  $("redemptionItem").disabled = true;
  $("redemptionItem").innerHTML = '<option value="">Carregando benefícios...</option>';
  try {
    const options = await request(`/api/admin/club/redemption-options?member_id=${id}`);
    fillRedemptionItems(options);
    return options;
  } catch (error) {
    $("redemptionItem").innerHTML = `<option value="">${escapeHtml(error.message)}</option>`;
    $("redemptionItem").disabled = true;
    toast(error.message, true);
    return null;
  }
}

async function openRedemption(memberId = null) {
  $("redemptionForm").reset();
  switchView("redemptions");
  openEditor("redemptionEditor");
  fillRedemptionItems(null);
  if (memberId) {
    $("redemptionMember").value = String(memberId);
    await loadRedemptionOptions(memberId);
  }
}

$("newRedemptionBtn").onclick = () => openRedemption();
$("redemptionMember").onchange = () => loadRedemptionOptions($("redemptionMember").value);
$("redemptionForm").onsubmit = async event => {
  event.preventDefault();
  const memberId = Number($("redemptionMember").value);
  const selected = $("redemptionItem").value;
  if (!Number.isInteger(memberId) || memberId <= 0) return toast("Selecione um associado.", true);
  if (!selected.includes(":")) return toast("Selecione um benefício ou cupom disponível.", true);

  const [kind, itemId] = selected.split(":");
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  try {
    const result = await request("/api/admin/club/redemptions", {
      method: "POST",
      body: JSON.stringify({
        member_id: memberId,
        kind,
        item_id: Number(itemId),
        amount_before: number($("redemptionAmount").value) || 0,
        notes: $("redemptionNotes").value
      })
    });
    closeEditor("redemptionEditor");
    await Promise.all([loadRedemptions(), loadDashboard()]);
    toast(`Utilização registrada. Desconto: ${money(result.discount_amount)}.`);
  } catch (error) {
    toast(error.message, true);
    await loadRedemptionOptions(memberId);
  } finally {
    if (submit) submit.disabled = false;
  }
};


function moneyCents(value) {
  return (Number(value || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function referralSourceLabel(value) {
  return ({ event: "Evento", club: "Clube", product: "Produto" })[value] || value || "—";
}

function referralPaymentLabel(value) {
  return ({ pending: "Pendente", approved: "Aprovado", cancelled: "Cancelado", refunded: "Reembolsado" })[value] || value || "—";
}

function referralCommissionLabel(value) {
  return ({ pending: "Pendente", released: "Liberada", paid: "Paga", cancelled: "Cancelada" })[value] || value || "—";
}

function referralStatusClass(value) {
  if (["approved", "released", "paid"].includes(value)) return "";
  if (["cancelled", "refunded"].includes(value)) return " off";
  return " warn";
}

function referralLink(item) {
  return `${location.origin}/pre-inscricao?ref=${encodeURIComponent(item.code || "")}`;
}

async function copyText(value, success = "Link copiado.") {
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
  toast(success);
}

function renderReferralTotals() {
  const configs = state.referralConfigs || [];
  const totals = configs.reduce((acc, item) => {
    acc.referrals += Number(item.referral_count || 0);
    acc.approved += Number(item.approved_count || 0);
    acc.sales += Number(item.total_sold_cents || 0);
    acc.pending += Number(item.pending_commission_cents || 0);
    acc.paid += Number(item.paid_commission_cents || 0);
    return acc;
  }, { referrals: 0, approved: 0, sales: 0, pending: 0, paid: 0 });
  $("referralStatTotal").textContent = totals.referrals;
  $("referralStatApproved").textContent = totals.approved;
  $("referralStatSales").textContent = moneyCents(totals.sales);
  $("referralStatPending").textContent = moneyCents(totals.pending);
  $("referralStatPaid").textContent = moneyCents(totals.paid);
}

function referralConfigPayload(item, overrides = {}) {
  return {
    partner_id: item.partner_id,
    code: item.code,
    active: Boolean(Number(item.active)),
    customer_discount_type: item.customer_discount_type,
    customer_discount_value: Number(item.customer_discount_value || 0),
    event_commission: Number(item.event_commission || 0),
    club_commission: Number(item.club_commission || 0),
    product_commission_percent: Number(item.product_commission_percent || 0),
    per_customer_limit: Number(item.per_customer_limit || 1),
    allow_stacking: Boolean(Number(item.allow_stacking)),
    valid_until: item.valid_until || "",
    ...overrides
  };
}

function referralConfigStatus(item) {
  const expired = item.valid_until && item.valid_until < today;
  if (!Number(item.partner_active)) return { label: "Parceiro inativo", className: " off" };
  if (!Number(item.active)) return { label: "Desativado", className: " off" };
  if (expired) return { label: "Vencido", className: " warn" };
  return { label: "Ativo", className: "" };
}

function renderReferralConfigs() {
  const tbody = $("referralPartnersTable");
  if (!state.referralConfigs.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state">Nenhum cupom de indicação configurado.</div></td></tr>';
    renderReferralTotals();
    return;
  }
  tbody.innerHTML = state.referralConfigs.map(item => {
    const status = referralConfigStatus(item);
    return `
      <tr>
        <td><strong>${escapeHtml(item.partner_name)}</strong></td>
        <td><span class="code-chip">${escapeHtml(item.code)}</span></td>
        <td>${Number(item.referral_count || 0)}</td>
        <td>${Number(item.approved_count || 0)}</td>
        <td>${escapeHtml(moneyCents(item.total_sold_cents))}</td>
        <td>${escapeHtml(moneyCents(item.pending_commission_cents))}</td>
        <td>${escapeHtml(moneyCents(item.paid_commission_cents))}</td>
        <td><span class="status-pill${status.className}">${escapeHtml(status.label)}</span></td>
        <td class="table-actions">
          <button class="small-btn" data-referral-config-view="${item.id}">Visualizar</button>
          <button class="small-btn" data-referral-config-edit="${item.id}">Editar</button>
          <button class="small-btn" data-referral-config-copy="${item.id}">Copiar link</button>
          <button class="small-btn" data-referral-config-qr="${item.id}">QR Code</button>
          <button class="small-btn danger" data-referral-config-toggle="${item.id}">${Number(item.active) ? "Desativar" : "Ativar"}</button>
        </td>
      </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-referral-config-edit]").forEach(button => button.onclick = () => editReferralConfig(Number(button.dataset.referralConfigEdit)));
  tbody.querySelectorAll("[data-referral-config-copy]").forEach(button => button.onclick = () => {
    const item = state.referralConfigs.find(value => value.id === Number(button.dataset.referralConfigCopy));
    if (item) copyText(referralLink(item));
  });
  tbody.querySelectorAll("[data-referral-config-qr]").forEach(button => button.onclick = () => {
    const item = state.referralConfigs.find(value => value.id === Number(button.dataset.referralConfigQr));
    if (item) openReferralQr(item);
  });
  tbody.querySelectorAll("[data-referral-config-view]").forEach(button => button.onclick = async () => {
    const item = state.referralConfigs.find(value => value.id === Number(button.dataset.referralConfigView));
    if (!item) return;
    $("referralFilterPartner").value = String(item.partner_id);
    await loadReferrals();
    document.querySelector(".referral-history-head")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  tbody.querySelectorAll("[data-referral-config-toggle]").forEach(button => button.onclick = async () => {
    const item = state.referralConfigs.find(value => value.id === Number(button.dataset.referralConfigToggle));
    if (!item) return;
    const active = !Number(item.active);
    if (!active && !window.confirm(`Desativar o código ${item.code}? O histórico e as comissões serão preservados.`)) return;
    try {
      await request(`/api/admin/club/referral-configs/${item.id}`, { method: "PUT", body: JSON.stringify(referralConfigPayload(item, { active })) });
      await loadReferralConfigs();
      fillReferralOptions();
      toast(active ? "Cupom de indicação ativado." : "Cupom desativado. Histórico preservado.");
    } catch (error) { toast(error.message, true); }
  });
  renderReferralTotals();
}

function fillReferralOptions() {
  const partnerOptions = state.partners.map(item => `<option value="${item.id}">${escapeHtml(item.name)}${item.active ? "" : " (inativo)"}</option>`).join("");
  $("referralConfigPartner").innerHTML = '<option value="">Selecione</option>' + partnerOptions;
  $("referralFilterPartner").innerHTML = '<option value="">Todos os parceiros</option>' + partnerOptions;
  const activeConfigs = state.referralConfigs.filter(item => item.active_effective);
  $("manualReferralSetting").innerHTML = activeConfigs.length
    ? activeConfigs.map(item => `<option value="${item.id}">${escapeHtml(item.partner_name)} · ${escapeHtml(item.code)}</option>`).join("")
    : '<option value="">Nenhum cupom ativo</option>';
}

function resetReferralConfigForm() {
  $("referralConfigForm").reset();
  $("referralConfigId").value = "";
  $("referralConfigCode").value = "";
  $("referralDiscountType").value = "percentage";
  $("referralDiscountValue").value = "5";
  $("referralEventCommission").value = "5,00";
  $("referralClubCommission").value = "10,00";
  $("referralProductCommission").value = "10";
  $("referralCustomerLimit").value = "1";
  $("referralStacking").checked = false;
  $("referralConfigActive").checked = true;
  $("referralConfigEditorTitle").textContent = "Novo cupom de indicação";
}

function editReferralConfig(id) {
  const item = state.referralConfigs.find(value => value.id === id);
  if (!item) return;
  $("referralConfigId").value = item.id;
  $("referralConfigPartner").value = item.partner_id;
  $("referralConfigCode").value = item.code || "";
  $("referralDiscountType").value = item.customer_discount_type || "percentage";
  $("referralDiscountValue").value = String(item.customer_discount_value ?? 0).replace(".", ",");
  $("referralEventCommission").value = Number(item.event_commission || 0).toFixed(2).replace(".", ",");
  $("referralClubCommission").value = Number(item.club_commission || 0).toFixed(2).replace(".", ",");
  $("referralProductCommission").value = String(item.product_commission_percent ?? 0).replace(".", ",");
  $("referralCustomerLimit").value = item.per_customer_limit || 1;
  $("referralValidUntil").value = item.valid_until || "";
  $("referralStacking").checked = Boolean(Number(item.allow_stacking));
  $("referralConfigActive").checked = Boolean(Number(item.active));
  $("referralConfigEditorTitle").textContent = `Editar ${item.code}`;
  openEditor("referralConfigEditor");
}

$("newReferralConfigBtn").onclick = () => { resetReferralConfigForm(); openEditor("referralConfigEditor"); };
$("newReferralPartnerBtn").onclick = () => { switchView("partners"); resetPartnerForm(); openEditor("partnerEditor"); };
$("referralConfigCode").oninput = () => {
  $("referralConfigCode").value = $("referralConfigCode").value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
};
$("referralConfigForm").onsubmit = async event => {
  event.preventDefault();
  const id = $("referralConfigId").value;
  const data = {
    partner_id: Number($("referralConfigPartner").value),
    code: $("referralConfigCode").value,
    active: $("referralConfigActive").checked,
    customer_discount_type: $("referralDiscountType").value,
    customer_discount_value: number($("referralDiscountValue").value) || 0,
    event_commission: number($("referralEventCommission").value) || 0,
    club_commission: number($("referralClubCommission").value) || 0,
    product_commission_percent: number($("referralProductCommission").value) || 0,
    per_customer_limit: Number($("referralCustomerLimit").value || 1),
    allow_stacking: $("referralStacking").checked,
    valid_until: $("referralValidUntil").value
  };
  try {
    await request(id ? `/api/admin/club/referral-configs/${id}` : "/api/admin/club/referral-configs", {
      method: id ? "PUT" : "POST", body: JSON.stringify(data)
    });
    closeEditor("referralConfigEditor");
    await Promise.all([loadReferralConfigs(), loadReferrals()]);
    fillReferralOptions();
    toast(id ? "Cupom de indicação atualizado." : "Cupom de indicação criado.");
  } catch (error) { toast(error.message, true); }
};

function currentReferralFilters() {
  const params = new URLSearchParams();
  const fields = {
    partner_id: $("referralFilterPartner").value,
    source_type: $("referralFilterSource").value,
    payment_status: $("referralFilterPayment").value,
    commission_status: $("referralFilterCommission").value,
    from: $("referralFilterFrom").value,
    to: $("referralFilterTo").value,
    q: $("referralFilterQuery").value.trim()
  };
  Object.entries(fields).forEach(([key, value]) => { if (value) params.set(key, value); });
  return params;
}

function renderReferralRecords() {
  const tbody = $("referralRecordsTable");
  if (!state.referrals.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state">Nenhuma indicação encontrada com estes filtros.</div></td></tr>';
    $("referralSelectionInfo").textContent = "0 selecionadas";
    return;
  }
  tbody.innerHTML = state.referrals.map(item => {
    const customer = item.customer_name || item.customer_email || item.customer_phone || "Cliente não identificado";
    const selectable = item.payment_status === "approved" && item.commission_status === "released";
    return `
      <tr>
        <td>${selectable ? `<input class="referral-select" type="checkbox" value="${item.id}" aria-label="Selecionar comissão">` : ""}</td>
        <td>${escapeHtml(dateBR(item.referred_at, true))}</td>
        <td><strong>${escapeHtml(item.partner_name)}</strong><br><span class="code-chip">${escapeHtml(item.code_snapshot)}</span></td>
        <td>${escapeHtml(referralSourceLabel(item.source_type))}<br><small>${escapeHtml(item.source_reference)}</small></td>
        <td>${escapeHtml(customer)}</td>
        <td><strong>${escapeHtml(moneyCents(item.final_amount_cents))}</strong></td>
        <td><span class="status-pill${referralStatusClass(item.payment_status)}">${escapeHtml(referralPaymentLabel(item.payment_status))}</span></td>
        <td><strong>${escapeHtml(moneyCents(item.commission_amount_cents))}</strong><br><span class="status-pill${referralStatusClass(item.commission_status)}">${escapeHtml(referralCommissionLabel(item.commission_status))}</span>${item.commission_paid_at ? `<br><small>${escapeHtml(dateBR(item.commission_paid_at, true))}</small>` : ""}</td>
        <td class="table-actions">
          <button class="small-btn" data-referral-detail="${item.id}">Detalhes</button>
          ${item.payment_status === "pending" ? `<button class="small-btn orange" data-referral-approve="${item.id}">Confirmar pagamento</button>` : ""}
          ${item.payment_status === "approved" ? `<button class="small-btn danger" data-referral-refund="${item.id}">Reembolsar</button>` : ""}
        </td>
      </tr>`;
  }).join("");
  tbody.querySelectorAll(".referral-select").forEach(input => input.onchange = updateReferralSelectionInfo);
  tbody.querySelectorAll("[data-referral-detail]").forEach(button => button.onclick = () => openReferralDetail(Number(button.dataset.referralDetail)));
  tbody.querySelectorAll("[data-referral-approve]").forEach(button => button.onclick = () => updateReferralPaymentStatus(Number(button.dataset.referralApprove), "approved"));
  tbody.querySelectorAll("[data-referral-refund]").forEach(button => button.onclick = () => updateReferralPaymentStatus(Number(button.dataset.referralRefund), "refunded"));
  $("referralSelectAll").checked = false;
  updateReferralSelectionInfo();
}

function updateReferralSelectionInfo() {
  const checked = [...document.querySelectorAll(".referral-select:checked")];
  $("referralSelectionInfo").textContent = `${checked.length} selecionada${checked.length === 1 ? "" : "s"}`;
}

$("referralSelectAll").onchange = () => {
  document.querySelectorAll(".referral-select").forEach(input => input.checked = $("referralSelectAll").checked);
  updateReferralSelectionInfo();
};
$("referralFilterApply").onclick = () => loadReferrals();
$("referralFilterQuery").addEventListener("keydown", event => { if (event.key === "Enter") loadReferrals(); });
["referralFilterPartner", "referralFilterSource", "referralFilterPayment", "referralFilterCommission"].forEach(id => {
  $(id).addEventListener("change", () => loadReferrals());
});

async function updateReferralPaymentStatus(id, paymentStatus) {
  const label = paymentStatus === "approved" ? "confirmar este pagamento" : "registrar este pagamento como reembolsado";
  if (!window.confirm(`Deseja ${label}? A comissão será atualizada pela mesma regra central do Mercado Pago.`)) return;
  try {
    await request(`/api/admin/club/referrals/${id}/payment`, { method: "PUT", body: JSON.stringify({ payment_status: paymentStatus }) });
    await Promise.all([loadReferrals(), loadReferralConfigs()]);
    toast(paymentStatus === "approved" ? "Pagamento confirmado e comissão liberada." : "Pagamento reembolsado e comissão cancelada.");
  } catch (error) { toast(error.message, true); }
}

$("markReferralPaidBtn").onclick = async () => {
  const ids = [...document.querySelectorAll(".referral-select:checked")].map(input => Number(input.value));
  if (!ids.length) return toast("Selecione ao menos uma comissão liberada.", true);
  if (!window.confirm(`Marcar ${ids.length} comissão(ões) como paga(s)?`)) return;
  try {
    const result = await request("/api/admin/club/referrals/mark-paid", { method: "POST", body: JSON.stringify({ ids }) });
    await Promise.all([loadReferrals(), loadReferralConfigs()]);
    toast(`${result.paid} comissão(ões) marcada(s) como paga(s).`);
  } catch (error) { toast(error.message, true); }
};

async function openReferralDetail(id) {
  try {
    const item = await request(`/api/admin/club/referrals/${id}`);
    const rows = [
      ["Pet shop", item.partner_name_snapshot || item.partner_name],
      ["Código", item.code_snapshot],
      ["Origem", referralSourceLabel(item.source_type)],
      ["Referência", item.source_reference],
      ["Cliente", item.customer_name || item.member_name || item.customer_email || "—"],
      ["E-mail", item.customer_email || "—"],
      ["Telefone", item.customer_phone || "—"],
      ["Valor original", moneyCents(item.original_amount_cents)],
      ["Outro desconto", moneyCents(item.other_discount_amount_cents)],
      ["Desconto de indicação", moneyCents(item.discount_amount_cents)],
      ["Valor final", moneyCents(item.final_amount_cents)],
      ["Pagamento", referralPaymentLabel(item.payment_status)],
      ["Transação", item.payment_transaction_id || "—"],
      ["Comissão", moneyCents(item.commission_amount_cents)],
      ["Status da comissão", referralCommissionLabel(item.commission_status)],
      ["Indicação", dateBR(item.referred_at, true)],
      ["Pagamento confirmado", item.payment_confirmed_at ? dateBR(item.payment_confirmed_at, true) : "—"],
      ["Comissão paga", item.commission_paid_at ? dateBR(item.commission_paid_at, true) : "—"]
    ];
    $("referralDetailContent").innerHTML = `<dl class="detail-grid">${rows.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
    $("referralDetailDialog").showModal();
  } catch (error) { toast(error.message, true); }
}
$("referralDetailClose").onclick = () => $("referralDetailDialog").close();

let currentQrConfig = null;
function openReferralQr(item) {
  currentQrConfig = item;
  const link = referralLink(item);
  $("referralQrTitle").textContent = `${item.partner_name} · ${item.code}`;
  $("referralQrLink").value = link;
  const box = $("referralQrCode");
  box.innerHTML = "";
  if (window.QRCode) {
    new QRCode(box, { text: link, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
  } else {
    box.innerHTML = '<p class="empty-state">Biblioteca de QR Code indisponível. Copie o link e tente novamente com conexão à internet.</p>';
  }
  $("referralQrDialog").showModal();
}
$("referralQrClose").onclick = () => $("referralQrDialog").close();
$("referralQrCopy").onclick = () => copyText($("referralQrLink").value);
$("referralQrDownload").onclick = () => {
  const box = $("referralQrCode");
  const canvas = box.querySelector("canvas");
  const image = box.querySelector("img");
  const url = canvas?.toDataURL("image/png") || image?.src;
  if (!url) return toast("QR Code ainda não foi gerado.", true);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dogfit-indicacao-${(currentQrConfig?.code || "parceiro").toLowerCase()}.png`;
  link.click();
};

$("newManualReferralBtn").onclick = () => {
  $("manualReferralForm").reset();
  $("manualReferralOtherDiscount").value = "0,00";
  openEditor("manualReferralEditor");
};
$("manualReferralForm").onsubmit = async event => {
  event.preventDefault();
  const data = {
    referral_setting_id: Number($("manualReferralSetting").value),
    source_type: $("manualReferralSource").value,
    customer_email: $("manualReferralEmail").value,
    customer_phone: $("manualReferralPhone").value,
    original_amount: number($("manualReferralOriginal").value) || 0,
    other_discount: number($("manualReferralOtherDiscount").value) || 0,
    source_reference: $("manualReferralReference").value,
    payment_status: $("manualReferralPayment").value
  };
  try {
    await request("/api/admin/club/referrals/manual", { method: "POST", body: JSON.stringify(data) });
    closeEditor("manualReferralEditor");
    await Promise.all([loadReferrals(), loadReferralConfigs()]);
    toast("Indicação registrada. A comissão segue o status do pagamento informado.");
  } catch (error) { toast(error.message, true); }
};

async function loadReferralConfigs() {
  state.referralConfigs = await request("/api/admin/club/referral-configs");
  renderReferralConfigs();
}
async function loadReferrals() {
  const params = currentReferralFilters();
  state.referrals = await request(`/api/admin/club/referrals${params.toString() ? `?${params}` : ""}`);
  renderReferralRecords();
}

async function loadDashboard() { state.dashboard = await request("/api/admin/club/dashboard"); renderDashboard(); }
async function loadMembers(q = "") { state.members = await request(`/api/admin/club/members?q=${encodeURIComponent(q)}`); renderMembers(); }
async function loadPartners() { state.partners = await request("/api/admin/club/partners"); renderPartners(); }
async function loadBenefits() { state.benefits = await request("/api/admin/club/benefits"); renderBenefits(); }
async function loadCoupons() { state.coupons = await request("/api/admin/club/coupons"); renderCoupons(); }
async function loadRedemptions(q = "") { state.redemptions = await request(`/api/admin/club/redemptions?q=${encodeURIComponent(q)}`); renderRedemptions(); }

async function init() {
  $("memberJoined").value = today;
  try {
    await Promise.all([loadDashboard(), loadMembers(), loadPartners(), loadBenefits(), loadCoupons(), loadRedemptions()]);
    fillPartnerOptions(); fillMemberOptions(); fillRedemptionItems();
    await Promise.all([loadReferralConfigs(), loadReferrals()]);
    fillReferralOptions();
    renderReferralTotals();
  } catch (error) {
    console.error(error); toast("Não foi possível carregar o módulo. A migration 0010 de indicações já foi aplicada?", true);
  }
}

init();
