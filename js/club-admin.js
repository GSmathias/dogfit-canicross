const $ = id => document.getElementById(id);
const today = new Date().toISOString().slice(0, 10);

const state = {
  dashboard: {},
  members: [],
  partners: [],
  benefits: [],
  coupons: [],
  redemptions: []
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
  const result = Number(String(value).replace(/\./g, "").replace(",", "."));
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
  return parsed.toLocaleDateString("pt-BR", withTime ? { dateStyle: "short", timeStyle: "short" } : undefined);
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

function switchView(name) {
  document.querySelectorAll(".club-view").forEach(view => view.classList.toggle("active", view.id === `${name}View`));
  document.querySelectorAll("[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === name));
  const titles = { overview: "Gestão do Clube", members: "Associados", partners: "Parceiros", benefits: "Benefícios", coupons: "Cupons", redemptions: "Utilizações" };
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
      </div>
    </article>
  `).join("");
  box.querySelectorAll("[data-edit-member]").forEach(button => button.onclick = () => editMember(Number(button.dataset.editMember)));
  box.querySelectorAll("[data-card]").forEach(button => button.onclick = () => window.open(`/clube/${button.dataset.card}`, "_blank", "noopener"));
  box.querySelectorAll("[data-use-member]").forEach(button => button.onclick = () => openRedemption(Number(button.dataset.useMember)));
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
    notes: $("memberNotes").value
  };
  try {
    await request(id ? `/api/admin/club/members/${id}` : "/api/admin/club/members", { method: id ? "PUT" : "POST", body: JSON.stringify(data) });
    closeEditor("memberEditor");
    await loadMembers();
    await loadDashboard();
    fillMemberOptions();
    toast(id ? "Associado atualizado." : "Associado cadastrado.");
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
      <div class="data-actions"><button class="small-btn" data-edit-partner="${partner.id}">Editar</button></div>
    </article>
  `).join("");
  box.querySelectorAll("[data-edit-partner]").forEach(button => button.onclick = () => editPartner(Number(button.dataset.editPartner)));
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
    await Promise.all([loadPartners(), loadDashboard()]);
    fillPartnerOptions();
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
      <div class="data-actions"><button class="small-btn" data-edit-benefit="${item.id}">Editar</button></div>
    </article>
  `).join("");
  box.querySelectorAll("[data-edit-benefit]").forEach(button => button.onclick = () => editBenefit(Number(button.dataset.editBenefit)));
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
      <div class="data-actions"><button class="small-btn" data-edit-coupon="${item.id}">Editar</button></div>
    </article>
  `).join("");
  box.querySelectorAll("[data-edit-coupon]").forEach(button => button.onclick = () => editCoupon(Number(button.dataset.editCoupon)));
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
      <div class="data-actions"><span class="value-highlight">${escapeHtml(money(item.discount_amount))}</span></div>
    </article>
  `).join("");
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

function fillRedemptionItems() {
  const benefits = state.benefits.filter(item => item.active).map(item => `<option value="benefit:${item.id}">Benefício · ${escapeHtml(item.title)}${item.partner_name ? ` (${escapeHtml(item.partner_name)})` : ""}</option>`).join("");
  const coupons = state.coupons.filter(item => item.active).map(item => `<option value="coupon:${item.id}">Cupom · ${escapeHtml(item.code)} · ${escapeHtml(item.title)}</option>`).join("");
  $("redemptionItem").innerHTML = `<option value="">Selecione</option><optgroup label="Benefícios">${benefits}</optgroup><optgroup label="Cupons">${coupons}</optgroup>`;
}

function openRedemption(memberId = null) {
  $("redemptionForm").reset();
  if (memberId) $("redemptionMember").value = String(memberId);
  switchView("redemptions");
  openEditor("redemptionEditor");
}

$("newRedemptionBtn").onclick = () => openRedemption();
$("redemptionForm").onsubmit = async event => {
  event.preventDefault();
  const [kind, itemId] = $("redemptionItem").value.split(":");
  try {
    const result = await request("/api/admin/club/redemptions", {
      method: "POST",
      body: JSON.stringify({
        member_id: Number($("redemptionMember").value),
        kind,
        item_id: Number(itemId),
        amount_before: number($("redemptionAmount").value) || 0,
        notes: $("redemptionNotes").value
      })
    });
    closeEditor("redemptionEditor");
    await Promise.all([loadRedemptions(), loadDashboard()]);
    toast(`Utilização registrada. Desconto: ${money(result.discount_amount)}.`);
  } catch (error) { toast(error.message, true); }
};

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
  } catch (error) {
    console.error(error); toast("Não foi possível carregar o módulo. A migração do banco já foi aplicada?", true);
  }
}

init();
