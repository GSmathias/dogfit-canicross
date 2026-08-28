const $ = id => document.getElementById(id);
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;

const state = {
  meta: { partners: [], products: [] },
  dashboard: {},
  stock: [],
  remittances: [],
  movements: [],
  commissions: [],
  settlements: []
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function money(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function percentFromBps(value) {
  return (Number(value || 0) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function moneyInputToCents(value) {
  let text = String(value ?? "").trim().replace(/[^0-9,.-]/g, "");
  if (!text) return null;
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : null;
}

function percentToBps(value) {
  let text = String(value ?? "").trim().replace(/[^0-9,.-]/g, "");
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number * 100) : null;
}

function dateBR(value, withTime = false) {
  if (!value) return "—";
  const text = String(value);
  const normalized = text.length === 10 ? `${text}T12:00:00` : text.replace(" ", "T") + (text.includes("Z") || /[+-]\d\d:\d\d$/.test(text) ? "" : "Z");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return text;
  return withTime
    ? parsed.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : parsed.toLocaleDateString("pt-BR");
}

function toast(message, error = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast show${error ? " error" : ""}`;
  clearTimeout(window.__consignmentToast);
  window.__consignmentToast = setTimeout(() => el.className = "toast", 3000);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body instanceof FormData ? (options.headers || {}) : { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text || `Erro ${response.status}`;
    try { message = JSON.parse(text).error || message; } catch {}
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function partnerById(id) { return state.meta.partners.find(p => Number(p.id) === Number(id)); }
function productById(id) { return state.meta.products.find(p => Number(p.id) === Number(id)); }

function activePartners() { return state.meta.partners.filter(p => Number(p.active)); }
function activeProducts() { return state.meta.products.filter(p => Number(p.active)); }

function partnerOptions(includeAll = true) {
  const options = state.meta.partners.map(p => `<option value="${p.id}">${escapeHtml(p.name)}${p.active ? "" : " (inativo)"}</option>`).join("");
  return `${includeAll ? '<option value="">Todos os parceiros</option>' : '<option value="">Selecione</option>'}${options}`;
}

function productOptions(includeAll = true) {
  const options = state.meta.products.map(p => `<option value="${p.id}">${escapeHtml(p.name)}${p.active ? "" : " (inativo)"}</option>`).join("");
  return `${includeAll ? '<option value="">Todos os produtos</option>' : '<option value="">Selecione</option>'}${options}`;
}

function fillGlobalOptions() {
  ["stockPartnerFilter","remittancePartnerFilter","movementPartnerFilter","commissionPartnerFilter"].forEach(id => $(id).innerHTML = partnerOptions(true));
  ["stockProductFilter","movementProductFilter"].forEach(id => $(id).innerHTML = productOptions(true));
  $("remittancePartner").innerHTML = `<option value="">Selecione</option>${activePartners().map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}`;
  $("settlementPartner").innerHTML = `<option value="">Selecione</option>${state.meta.partners.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}`;
}

function switchView(name) {
  document.querySelectorAll(".consignment-view").forEach(view => view.classList.toggle("active", view.id === `${name}View`));
  document.querySelectorAll("[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === name));
  const titles = { overview: "Consignados", stock: "Estoque por Parceiro", remittances: "Remessas", movements: "Movimentações", commissions: "Comissões" };
  $("viewTitle").textContent = titles[name] || "Consignados";
  document.querySelector(".sidebar").classList.remove("open");
  if (name === "stock") loadStock();
  if (name === "remittances") loadRemittances();
  if (name === "movements") loadMovements();
  if (name === "commissions") loadCommissionsAndSettlements();
}

document.querySelectorAll("[data-view]").forEach(button => button.onclick = () => switchView(button.dataset.view));
$("mobileMenu").onclick = () => document.querySelector(".sidebar").classList.toggle("open");

document.querySelectorAll("[data-dialog-close]").forEach(button => button.onclick = () => $(button.dataset.dialogClose).close());

function movementLabel(type) {
  return { ENVIADO: "Enviado", VENDA: "Venda", REPOSICAO: "Reposição", DEVOLUCAO: "Devolução", AJUSTE: "Ajuste", ESTORNO_VENDA: "Estorno de venda" }[type] || type;
}

function movementPill(type) {
  const cls = type === "VENDA" ? "" : type === "DEVOLUCAO" || type === "ESTORNO_VENDA" ? "warn" : type === "AJUSTE" ? "info" : "info";
  return `<span class="status-pill ${cls}">${escapeHtml(movementLabel(type))}</span>`;
}

async function loadMeta() {
  state.meta = await request("/api/admin/consignments/meta");
  fillGlobalOptions();
}

async function loadDashboard() {
  state.dashboard = await request(`/api/admin/consignments/dashboard?from=${monthStart}&to=${today}`);
  $("statActivePartners").textContent = state.dashboard.active_partners || 0;
  $("statTotalUnits").textContent = state.dashboard.total_units || 0;
  $("statCurrentValue").textContent = money(state.dashboard.current_value_cents);
  $("statMonthSales").textContent = money(state.dashboard.sales_cents);
  $("statPendingCommission").textContent = money(state.dashboard.pending_commission_cents);
  $("statDogfitNet").textContent = money(state.dashboard.dogfit_net_cents);
  $("statLowStock").textContent = state.dashboard.low_stock_count || 0;
  renderAlerts();
}

function renderAlerts() {
  const box = $("stockAlerts");
  const alerts = state.dashboard.alerts || [];
  if (!alerts.length) {
    box.innerHTML = '<div class="empty-state">Nenhum produto precisa de reposição neste momento.</div>';
    return;
  }
  box.innerHTML = alerts.map(item => `
    <button class="stock-alert" type="button" data-alert-partner="${item.partner_id}">
      <div><strong>⚠ ${escapeHtml(item.product_name)}${item.variation ? ` · ${escapeHtml(item.variation)}` : ""}</strong><span>${escapeHtml(item.partner_name)} · mínimo configurado: ${Number(item.threshold || 0)}</span></div>
      <div class="stock-alert-count">${Number(item.stock || 0)} em loja</div>
    </button>
  `).join("");
  box.querySelectorAll("[data-alert-partner]").forEach(button => button.onclick = () => {
    switchView("stock");
    $("stockPartnerFilter").value = button.dataset.alertPartner;
    loadStock();
  });
}

async function loadStock() {
  const params = new URLSearchParams();
  if ($("stockPartnerFilter").value) params.set("partner_id", $("stockPartnerFilter").value);
  if ($("stockProductFilter").value) params.set("product_id", $("stockProductFilter").value);
  if ($("stockSearch").value.trim()) params.set("q", $("stockSearch").value.trim());
  state.stock = await request(`/api/admin/consignments/stock?${params}`);
  renderStock();
  await renderSelectedPartnerSummary();
}

function renderStock() {
  const table = $("stockTable");
  const cards = $("stockCards");
  if (!state.stock.length) {
    table.innerHTML = '<tr><td colspan="11">Nenhum estoque consignado encontrado.</td></tr>';
    cards.innerHTML = '<div class="empty-state">Nenhum estoque consignado encontrado.</div>';
    return;
  }
  table.innerHTML = state.stock.map(item => {
    const stock = Number(item.stock || 0);
    const threshold = Number(item.low_stock_threshold || 0);
    const stockClass = stock === 0 ? "zero" : stock <= threshold ? "low" : "";
    return `<tr>
      <td><button class="link-button" data-partner-overview="${item.partner_id}">${escapeHtml(item.partner_name)}</button></td>
      <td><strong>${escapeHtml(item.product_name)}</strong>${item.product_active ? "" : "<br><small>produto inativo</small>"}</td>
      <td>${escapeHtml(item.variation || "—")}</td><td>${Number(item.sent || 0)}</td><td>${Number(item.restocked || 0)}</td><td>${Number(item.sold || 0)}</td><td>${Number(item.returned || 0)}</td>
      <td><span class="stock-number ${stockClass}">${stock}</span><br><small>mín. ${threshold}</small></td>
      <td class="money-cell">${money(item.unit_price_cents)}</td><td>${percentFromBps(item.commission_bps)}%</td>
      <td><div class="table-actions"><button class="small-btn orange" data-stock-sale="${item.partner_id}|${item.product_id}|${encodeURIComponent(item.variation || "")}">Venda</button><button class="small-btn" data-stock-restock="${item.partner_id}|${item.product_id}|${encodeURIComponent(item.variation || "")}">Repor</button><button class="small-btn" data-stock-return="${item.partner_id}|${item.product_id}|${encodeURIComponent(item.variation || "")}">Devolver</button></div></td>
    </tr>`;
  }).join("");
  cards.innerHTML = state.stock.map(item => {
    const stock = Number(item.stock || 0), threshold = Number(item.low_stock_threshold || 0);
    return `<article class="mobile-stock-card"><div class="mobile-stock-card-head"><div><span class="partner">${escapeHtml(item.partner_name)}</span><span class="product">${escapeHtml(item.product_name)}</span><span class="variation">${escapeHtml(item.variation || "Sem variação")}</span></div><span class="stock-number ${stock === 0 ? "zero" : stock <= threshold ? "low" : ""}">${stock} em loja</span></div><div class="mobile-stock-grid"><div><span>Enviado</span><strong>${Number(item.sent||0)}</strong></div><div><span>Vendido</span><strong>${Number(item.sold||0)}</strong></div><div><span>Preço</span><strong>${money(item.unit_price_cents)}</strong></div><div><span>Comissão</span><strong>${percentFromBps(item.commission_bps)}%</strong></div></div><div class="mobile-card-actions"><button class="small-btn orange" data-stock-sale="${item.partner_id}|${item.product_id}|${encodeURIComponent(item.variation || "")}">Venda</button><button class="small-btn" data-stock-restock="${item.partner_id}|${item.product_id}|${encodeURIComponent(item.variation || "")}">Repor</button><button class="small-btn" data-stock-return="${item.partner_id}|${item.product_id}|${encodeURIComponent(item.variation || "")}">Devolver</button><button class="small-btn" data-partner-overview="${item.partner_id}">Ver parceiro</button></div></article>`;
  }).join("");
  bindStockActions(table); bindStockActions(cards);
}

function parseStockAction(value) {
  const [partnerId, productId, variation] = String(value).split("|");
  return { partnerId: Number(partnerId), productId: Number(productId), variation: decodeURIComponent(variation || "") };
}

function bindStockActions(root) {
  root.querySelectorAll("[data-stock-sale]").forEach(b => b.onclick = () => { const x=parseStockAction(b.dataset.stockSale); openMovement("sale", x); });
  root.querySelectorAll("[data-stock-restock]").forEach(b => b.onclick = () => { const x=parseStockAction(b.dataset.stockRestock); openMovement("restock", x); });
  root.querySelectorAll("[data-stock-return]").forEach(b => b.onclick = () => { const x=parseStockAction(b.dataset.stockReturn); openMovement("return", x); });
  root.querySelectorAll("[data-partner-overview]").forEach(b => b.onclick = () => openPartnerOverview(Number(b.dataset.partnerOverview)));
}

async function renderSelectedPartnerSummary() {
  const id = Number($("stockPartnerFilter").value || 0);
  const box = $("stockPartnerSummary");
  if (!id) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  try {
    const data = await request(`/api/admin/consignments/partners/${id}/overview`);
    const p = data.partner, f = data.financial || {};
    box.innerHTML = `<article class="partner-summary-card main"><span>Parceiro</span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.responsible_name || "Responsável não informado")} · Cupom ${escapeHtml(p.referral_code || "—")}</small></article><article class="partner-summary-card"><span>Total vendido</span><strong>${money(f.sold_cents)}</strong></article><article class="partner-summary-card"><span>Comissão pendente</span><strong>${money(f.commission_pending_cents)}</strong></article><article class="partner-summary-card"><span>Comissão paga</span><strong>${money(f.commission_paid_cents)}</strong></article>`;
    box.classList.remove("hidden");
  } catch { box.classList.add("hidden"); }
}

["stockPartnerFilter","stockProductFilter"].forEach(id => $(id).onchange = loadStock);
let stockTimer; $("stockSearch").oninput = () => { clearTimeout(stockTimer); stockTimer=setTimeout(loadStock,250); };

async function loadRemittances() {
  const params = new URLSearchParams();
  if ($("remittancePartnerFilter").value) params.set("partner_id", $("remittancePartnerFilter").value);
  if ($("remittanceStatusFilter").value) params.set("status", $("remittanceStatusFilter").value);
  if ($("remittanceFrom").value) params.set("from", $("remittanceFrom").value);
  if ($("remittanceTo").value) params.set("to", $("remittanceTo").value);
  if ($("remittanceSearch").value.trim()) params.set("q", $("remittanceSearch").value.trim());
  state.remittances = await request(`/api/admin/consignments/remittances?${params}`);
  const box = $("remittancesTable");
  if (!state.remittances.length) { box.innerHTML='<tr><td colspan="8">Nenhuma remessa encontrada.</td></tr>'; return; }
  box.innerHTML = state.remittances.map(item => `<tr><td><strong class="code-chip">${escapeHtml(item.code)}</strong></td><td>${dateBR(item.shipment_date)}</td><td>${escapeHtml(item.partner_name_snapshot)}</td><td>${Number(item.item_lines||0)}</td><td>${Number(item.total_units||0)}</td><td class="money-cell">${money(item.total_value_cents)}</td><td><span class="status-pill ${item.status==='ATIVA'?'':item.status==='CANCELADA'?'off':'warn'}">${escapeHtml(item.status)}</span></td><td><button class="small-btn" data-remittance-detail="${item.id}">Visualizar</button></td></tr>`).join("");
  box.querySelectorAll("[data-remittance-detail]").forEach(b => b.onclick=()=>openRemittanceDetail(Number(b.dataset.remittanceDetail)));
}

["remittancePartnerFilter","remittanceStatusFilter","remittanceFrom","remittanceTo"].forEach(id => $(id).onchange=loadRemittances);
let remitTimer; $("remittanceSearch").oninput=()=>{clearTimeout(remitTimer);remitTimer=setTimeout(loadRemittances,250)};

async function openRemittanceDetail(id) {
  try {
    const item = await request(`/api/admin/consignments/remittances/${id}`);
    $("remittanceDetailTitle").textContent = item.code;
    const total = item.items.reduce((sum,x)=>sum+Number(x.quantity_sent)*Number(x.unit_price_cents),0);
    $("remittanceDetailContent").innerHTML = `<div class="detail-hero"><div class="detail-card main"><span>Parceiro</span><strong>${escapeHtml(item.partner_name_snapshot)}</strong></div><div class="detail-card"><span>Data</span><strong>${dateBR(item.shipment_date)}</strong></div><div class="detail-card"><span>Unidades</span><strong>${item.items.reduce((s,x)=>s+Number(x.quantity_sent),0)}</strong></div><div class="detail-card"><span>Valor</span><strong>${money(total)}</strong></div></div><div class="table-scroll"><table class="detail-table"><thead><tr><th>Produto</th><th>Variação</th><th>Quantidade</th><th>Preço</th><th>Comissão</th><th>Mínimo</th></tr></thead><tbody>${item.items.map(x=>`<tr><td>${escapeHtml(x.product_name_snapshot)}</td><td>${escapeHtml(x.variation||'—')}</td><td>${x.quantity_sent}</td><td>${money(x.unit_price_cents)}</td><td>${percentFromBps(x.commission_bps)}%</td><td>${x.low_stock_threshold}</td></tr>`).join('')}</tbody></table></div>${item.notes?`<div class="detail-notes">${escapeHtml(item.notes)}</div>`:''}`;
    $("remittanceDetailDialog").showModal();
  } catch(error){toast(error.message,true)}
}

let remittanceItemSeq = 0;
function addRemittanceItem(prefill = {}) {
  const index = ++remittanceItemSeq;
  const partner = partnerById($("remittancePartner").value);
  const row = document.createElement("div"); row.className="remittance-item"; row.dataset.item=index;
  row.innerHTML = `<label><span>Produto</span><select data-ri="product" required><option value="">Selecione</option>${activeProducts().map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select></label><label><span>Variação</span><input data-ri="variation" maxlength="80" placeholder="P, M, G..."></label><label><span>Quantidade</span><input data-ri="quantity" type="number" min="1" value="${prefill.quantity||1}" required></label><label><span>Preço (R$)</span><input data-ri="price" inputmode="decimal" required></label><label><span>Comissão %</span><input data-ri="commission" inputmode="decimal" value="${percentFromBps(partner?.consignment_commission_bps ?? 3000)}" required></label><label><span>Alerta mín.</span><input data-ri="threshold" type="number" min="0" value="${Number(partner?.consignment_low_stock_threshold ?? 1)}"></label><button class="icon-btn remove-remittance-item" type="button" title="Remover">×</button>`;
  $("remittanceItems").appendChild(row);
  const productSelect=row.querySelector('[data-ri="product"]'), priceInput=row.querySelector('[data-ri="price"]');
  productSelect.onchange=()=>{const p=productById(productSelect.value);priceInput.value=p?.price!=null?Number(p.price).toFixed(2).replace('.',','):'';updateRemittanceTotal()};
  row.querySelectorAll('input').forEach(input=>input.oninput=updateRemittanceTotal);
  row.querySelector('.remove-remittance-item').onclick=()=>{row.remove();updateRemittanceTotal()};
  if(prefill.product_id){productSelect.value=prefill.product_id;productSelect.onchange()}
}

function updateRemittanceTotal(){let total=0;document.querySelectorAll('.remittance-item').forEach(row=>{const q=Number(row.querySelector('[data-ri="quantity"]').value||0);const p=moneyInputToCents(row.querySelector('[data-ri="price"]').value)||0;total+=q*p});$("remittanceTotal").textContent=money(total)}

function openRemittance() {
  $("remittanceForm").reset(); $("remittanceDate").value=today; $("remittanceItems").innerHTML=""; remittanceItemSeq=0; addRemittanceItem(); updateRemittanceTotal(); $("remittanceDialog").showModal();
}
$("addRemittanceItem").onclick=()=>addRemittanceItem();
$("remittancePartner").onchange=()=>{const p=partnerById($("remittancePartner").value);document.querySelectorAll('.remittance-item').forEach(row=>{row.querySelector('[data-ri="commission"]').value=percentFromBps(p?.consignment_commission_bps||3000);row.querySelector('[data-ri="threshold"]').value=Number(p?.consignment_low_stock_threshold??1)})};
$("remittanceForm").onsubmit=async event=>{event.preventDefault();const items=[...document.querySelectorAll('.remittance-item')].map(row=>({product_id:Number(row.querySelector('[data-ri="product"]').value),variation:row.querySelector('[data-ri="variation"]').value,quantity:Number(row.querySelector('[data-ri="quantity"]').value),unit_price_cents:moneyInputToCents(row.querySelector('[data-ri="price"]').value),commission_bps:percentToBps(row.querySelector('[data-ri="commission"]').value),low_stock_threshold:Number(row.querySelector('[data-ri="threshold"]').value||0)}));try{const result=await request('/api/admin/consignments/remittances',{method:'POST',body:JSON.stringify({partner_id:Number($("remittancePartner").value),shipment_date:$("remittanceDate").value,notes:$("remittanceNotes").value,items})});$("remittanceDialog").close();await refreshAll();toast(`Remessa ${result.code} criada com sucesso.`);switchView('remittances')}catch(error){toast(error.message,true)}};

function availableStockRows(partnerId, mode) {
  return state.stock.filter(x => Number(x.partner_id)===Number(partnerId) && (mode==='restock' || Number(x.stock)>0));
}

function populateMovementProducts(mode, preselectProduct = null, preselectVariation = "") {
  const partnerId=Number($("movementPartner").value||0);const rows=availableStockRows(partnerId,mode);const unique=[...new Map(rows.map(x=>[Number(x.product_id),x])).values()];
  $("movementProduct").innerHTML=`<option value="">Selecione</option>${unique.map(x=>`<option value="${x.product_id}">${escapeHtml(x.product_name)}</option>`).join('')}`;
  if(preselectProduct) $("movementProduct").value=String(preselectProduct);
  populateMovementVariations(mode,preselectVariation);
}
function populateMovementVariations(mode, preselect="") {const partnerId=Number($("movementPartner").value||0),productId=Number($("movementProduct").value||0);const rows=availableStockRows(partnerId,mode).filter(x=>Number(x.product_id)===productId);$("movementVariation").innerHTML=`<option value="">${rows.some(x=>!x.variation)?'Sem variação':'Selecione'}</option>${rows.filter(x=>x.variation).map(x=>`<option value="${escapeHtml(x.variation)}">${escapeHtml(x.variation)} · ${Number(x.stock)} em loja</option>`).join('')}`;if(rows.some(x=>String(x.variation)===String(preselect))) $("movementVariation").value=preselect;updateSaleCalculation()}
function selectedStockRow(){return state.stock.find(x=>Number(x.partner_id)===Number($("movementPartner").value)&&Number(x.product_id)===Number($("movementProduct").value)&&String(x.variation||'')===String($("movementVariation").value||''))}
function updateSaleCalculation(){if($("movementMode").value!=='sale')return;const row=selectedStockRow();const qty=Number($("movementQuantity").value||1);if(row&&!$("movementSaleValue").dataset.edited) $("movementSaleValue").value=((Number(row.unit_price_cents||0)*qty)/100).toFixed(2).replace('.',',');const gross=moneyInputToCents($("movementSaleValue").value)||0;const commission=Math.round(gross*Number(row?.commission_bps||0)/10000);$("saleCalculation").innerHTML=`<div class="sale-calc-card"><span>Venda</span><strong>${money(gross)}</strong></div><div class="sale-calc-card"><span>Parceiro ${percentFromBps(row?.commission_bps||0)}%</span><strong>${money(commission)}</strong></div><div class="sale-calc-card orange"><span>DOGFIT</span><strong>${money(gross-commission)}</strong></div>`;$("saleCalculation").classList.remove('hidden')}

async function ensureStockLoaded(){if(!state.stock.length) state.stock=await request('/api/admin/consignments/stock');}
async function openMovement(mode, prefill={}){try{await ensureStockLoaded();$("movementForm").reset();$("movementMode").value=mode;$("movementDate").value=today;$("movementQuantity").value=1;$("movementSaleValue").dataset.edited='';const title={sale:'Registrar venda',restock:'Repor estoque',return:'Registrar devolução'}[mode];$("movementDialogTitle").textContent=title;$("saleValueField").classList.toggle('hidden',mode!=='sale');$("saleCalculation").classList.toggle('hidden',mode!=='sale');$("movementNotesLabel").textContent=mode==='return'?'Motivo da devolução':'Observação';$("movementNotes").required=mode==='return';$("movementPartner").innerHTML=`<option value="">Selecione</option>${activePartners().map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}`;if(prefill.partnerId)$("movementPartner").value=String(prefill.partnerId);populateMovementProducts(mode,prefill.productId,prefill.variation);$("movementDialog").showModal()}catch(error){toast(error.message,true)}}
$("movementPartner").onchange=()=>populateMovementProducts($("movementMode").value);
$("movementProduct").onchange=()=>populateMovementVariations($("movementMode").value);
$("movementVariation").onchange=updateSaleCalculation;
$("movementQuantity").oninput=()=>{if($("movementMode").value==='sale'){$("movementSaleValue").dataset.edited='';updateSaleCalculation()}};
$("movementSaleValue").oninput=()=>{$("movementSaleValue").dataset.edited='1';updateSaleCalculation()};
$("movementForm").onsubmit=async event=>{event.preventDefault();const mode=$("movementMode").value;const base={partner_id:Number($("movementPartner").value),product_id:Number($("movementProduct").value),variation:$("movementVariation").value,quantity:Number($("movementQuantity").value),movement_date:$("movementDate").value,notes:$("movementNotes").value};let url;if(mode==='sale'){url='/api/admin/consignments/sales';base.gross_amount_cents=moneyInputToCents($("movementSaleValue").value)}else if(mode==='restock')url='/api/admin/consignments/restocks';else url='/api/admin/consignments/returns';try{await request(url,{method:'POST',body:JSON.stringify(base)});$("movementDialog").close();await refreshAll();toast(mode==='sale'?'Venda registrada e comissão calculada.':mode==='restock'?'Reposição registrada.':'Devolução registrada.')}catch(error){toast(error.message,true)}};

document.querySelectorAll('[data-action="new-remittance"]').forEach(b=>b.onclick=openRemittance);
document.querySelectorAll('[data-action="new-sale"]').forEach(b=>b.onclick=()=>openMovement('sale'));
document.querySelectorAll('[data-action="new-restock"]').forEach(b=>b.onclick=()=>openMovement('restock'));
document.querySelectorAll('[data-action="new-return"]').forEach(b=>b.onclick=()=>openMovement('return'));

async function loadMovements(){const params=new URLSearchParams();[['partner_id','movementPartnerFilter'],['product_id','movementProductFilter'],['type','movementTypeFilter'],['from','movementFrom'],['to','movementTo']].forEach(([key,id])=>{if($(id).value)params.set(key,$(id).value)});state.movements=await request(`/api/admin/consignments/movements?${params}`);const box=$("movementsTable");if(!state.movements.length){box.innerHTML='<tr><td colspan="11">Nenhuma movimentação encontrada.</td></tr>';return}box.innerHTML=state.movements.map(m=>`<tr><td>${dateBR(m.movement_date)}</td><td>${escapeHtml(m.partner_name)}</td><td><strong>${escapeHtml(m.product_name)}</strong></td><td>${escapeHtml(m.variation||'—')}</td><td>${movementPill(m.movement_type)}${m.movement_status==='ESTORNADA'?'<br><small>estornada</small>':''}</td><td>${Number(m.quantity)}</td><td class="money-cell">${m.movement_type==='VENDA'?money(m.gross_amount_cents):'—'}</td><td class="money-cell">${m.movement_type==='VENDA'?`${money(m.commission_amount_cents)}<br><small>${escapeHtml(m.commission_status)}</small>`:'—'}</td><td>${escapeHtml(m.responsible_user||'admin')}</td><td>${escapeHtml(m.notes||'—')}</td><td>${m.movement_type==='VENDA'&&m.movement_status==='ATIVA'?`<button class="small-btn danger" data-reverse-sale="${m.id}">Estornar</button>`:'—'}</td></tr>`).join('');box.querySelectorAll('[data-reverse-sale]').forEach(b=>b.onclick=()=>reverseSale(Number(b.dataset.reverseSale)))}
["movementPartnerFilter","movementProductFilter","movementTypeFilter","movementFrom","movementTo"].forEach(id=>$(id).onchange=loadMovements);
async function reverseSale(id){if(!confirm('Estornar esta venda? O produto voltará ao estoque, a comissão será cancelada e o histórico original será preservado.'))return;const notes=prompt('Motivo do estorno:','Venda cancelada / lançada incorretamente')||'';if(!notes.trim())return;try{await request(`/api/admin/consignments/sales/${id}/reverse`,{method:'POST',body:JSON.stringify({movement_date:today,notes})});await refreshAll();toast('Venda estornada com histórico preservado.')}catch(error){toast(error.message,true)}}

function adjustmentRows(partnerId){return state.stock.filter(x=>Number(x.partner_id)===Number(partnerId))}
function populateAdjustmentProducts(preProduct=null,preVariation=''){const partnerId=Number($("adjustmentPartner").value||0);const rows=adjustmentRows(partnerId);const unique=[...new Map(rows.map(x=>[Number(x.product_id),x])).values()];$("adjustmentProduct").innerHTML=`<option value="">Selecione</option>${unique.map(x=>`<option value="${x.product_id}">${escapeHtml(x.product_name)}</option>`).join('')}`;if(preProduct)$("adjustmentProduct").value=preProduct;populateAdjustmentVariations(preVariation)}
function populateAdjustmentVariations(pre=''){const partnerId=Number($("adjustmentPartner").value||0),productId=Number($("adjustmentProduct").value||0);const rows=adjustmentRows(partnerId).filter(x=>Number(x.product_id)===productId);$("adjustmentVariation").innerHTML=`<option value="">${rows.some(x=>!x.variation)?'Sem variação':'Selecione'}</option>${rows.filter(x=>x.variation).map(x=>`<option value="${escapeHtml(x.variation)}">${escapeHtml(x.variation)} · ${x.stock} em loja</option>`).join('')}`;if(rows.some(x=>x.variation===pre))$("adjustmentVariation").value=pre}
$("newAdjustmentBtn").onclick=async()=>{await ensureStockLoaded();$("adjustmentForm").reset();$("adjustmentDate").value=today;$("adjustmentPartner").innerHTML=`<option value="">Selecione</option>${state.meta.partners.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}`;populateAdjustmentProducts();$("adjustmentDialog").showModal()};
$("adjustmentPartner").onchange=()=>populateAdjustmentProducts();$("adjustmentProduct").onchange=()=>populateAdjustmentVariations();
$("adjustmentForm").onsubmit=async event=>{event.preventDefault();try{await request('/api/admin/consignments/adjustments',{method:'POST',body:JSON.stringify({partner_id:Number($("adjustmentPartner").value),product_id:Number($("adjustmentProduct").value),variation:$("adjustmentVariation").value,stock_delta:Number($("adjustmentDelta").value),movement_date:$("adjustmentDate").value,notes:$("adjustmentNotes").value})});$("adjustmentDialog").close();await refreshAll();toast('Ajuste registrado no histórico.')}catch(error){toast(error.message,true)}};

async function openPartnerSettings(id=null){const selected=Number(id||$("stockPartnerFilter").value||0);if(!selected){toast('Selecione um parceiro no filtro para configurar.',true);return}const p=partnerById(selected);if(!p)return;$("partnerSettingsId").value=p.id;$("partnerSettingsIdentity").innerHTML=`<strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.phone||'Sem telefone')} · ${escapeHtml(p.address||'Sem endereço')}</span><span>Cupom DOGFIT: <code>${escapeHtml(p.referral_code||'—')}</code></span>`;$("partnerResponsible").value=p.responsible_name||'';$("partnerCommission").value=percentFromBps(p.consignment_commission_bps??3000);$("partnerThreshold").value=Number(p.consignment_low_stock_threshold??1);$("partnerConsignmentEnabled").checked=Boolean(Number(p.consignment_enabled));$("partnerConsignmentNotes").value=p.consignment_notes||'';$("partnerSettingsDialog").showModal()}
$("partnerSettingsBtn").onclick=()=>openPartnerSettings();
$("partnerSettingsForm").onsubmit=async event=>{event.preventDefault();const id=Number($("partnerSettingsId").value);const commission=percentToBps($("partnerCommission").value);if(commission==null){toast('Informe uma comissão entre 0% e 100%.',true);return}try{await request(`/api/admin/consignments/partners/${id}/settings`,{method:'PUT',body:JSON.stringify({responsible_name:$("partnerResponsible").value,consignment_enabled:$("partnerConsignmentEnabled").checked,consignment_commission_bps:commission,consignment_low_stock_threshold:Number($("partnerThreshold").value||0),consignment_notes:$("partnerConsignmentNotes").value})});$("partnerSettingsDialog").close();await loadMeta();await refreshAll(false);toast('Configuração do parceiro salva.')}catch(error){toast(error.message,true)}};

async function openPartnerOverview(id){try{const data=await request(`/api/admin/consignments/partners/${id}/overview`);const p=data.partner,f=data.financial||{};$("partnerOverviewTitle").textContent=p.name;$("partnerOverviewContent").innerHTML=`<div class="partner-overview-finance"><div class="detail-card"><span>Total vendido</span><strong>${money(f.sold_cents)}</strong></div><div class="detail-card"><span>Comissão total</span><strong>${money(f.commission_total_cents)}</strong></div><div class="detail-card"><span>Pendente</span><strong>${money(f.commission_pending_cents)}</strong></div><div class="detail-card"><span>Já pago</span><strong>${money(f.commission_paid_cents)}</strong></div><div class="detail-card"><span>Líquido DOGFIT</span><strong>${money(f.dogfit_net_cents)}</strong></div></div><h4 class="subheading">Estoque</h4><div class="table-scroll"><table class="detail-table"><thead><tr><th>Produto</th><th>Variação</th><th>Enviado</th><th>Reposto</th><th>Vendido</th><th>Devolvido</th><th>Em loja</th><th>Preço</th></tr></thead><tbody>${data.stock.length?data.stock.map(x=>`<tr><td>${escapeHtml(x.product_name)}</td><td>${escapeHtml(x.variation||'—')}</td><td>${x.sent}</td><td>${x.restocked}</td><td>${x.sold}</td><td>${x.returned}</td><td><strong>${x.stock}</strong></td><td>${money(x.unit_price_cents)}</td></tr>`).join(''):'<tr><td colspan="8">Sem estoque.</td></tr>'}</tbody></table></div><h4 class="subheading">Últimas movimentações</h4><div class="table-scroll"><table class="detail-table"><thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Qtd.</th><th>Valor</th></tr></thead><tbody>${data.movements.length?data.movements.slice(0,20).map(x=>`<tr><td>${dateBR(x.movement_date)}</td><td>${escapeHtml(x.product_name)}</td><td>${escapeHtml(movementLabel(x.movement_type))}</td><td>${x.quantity}</td><td>${x.movement_type==='VENDA'?money(x.gross_amount_cents):'—'}</td></tr>`).join(''):'<tr><td colspan="5">Sem movimentações.</td></tr>'}</tbody></table></div>`;$("partnerOverviewDialog").showModal()}catch(error){toast(error.message,true)}}

async function loadCommissionsAndSettlements(){const params=new URLSearchParams();if($("commissionPartnerFilter").value)params.set('partner_id',$("commissionPartnerFilter").value);params.set('from',$("commissionFrom").value||monthStart);params.set('to',$("commissionTo").value||today);const settlementParams=new URLSearchParams(params);if($("settlementStatusFilter").value)settlementParams.set('status',$("settlementStatusFilter").value);const [summary,settlements]=await Promise.all([request(`/api/admin/consignments/commissions?${params}`),request(`/api/admin/consignments/settlements?${settlementParams}`)]);state.commissions=summary.results||[];state.settlements=settlements;renderCommissions();renderSettlements()}
function renderCommissions(){const box=$("commissionSummaryTable");if(!state.commissions.length){box.innerHTML='<tr><td colspan="8">Nenhuma venda no período.</td></tr>';return}box.innerHTML=state.commissions.map(x=>`<tr><td><strong>${escapeHtml(x.partner_name)}</strong></td><td>${x.sales_count} venda(s) · ${x.units_sold} un.</td><td class="money-cell">${money(x.gross_sales_cents)}</td><td>${percentFromBps(x.effective_commission_bps)}%</td><td class="money-cell">${money(x.total_commission_cents)}</td><td class="money-cell">${money(x.pending_commission_cents)}</td><td class="money-cell">${money(x.paid_commission_cents)}</td><td class="money-cell">${money(x.dogfit_net_cents)}</td></tr>`).join('')}
function renderSettlements(){const box=$("settlementsTable");if(!state.settlements.length){box.innerHTML='<tr><td colspan="10">Nenhum fechamento gerado.</td></tr>';return}box.innerHTML=state.settlements.map(x=>`<tr><td><strong class="code-chip">${escapeHtml(x.code)}</strong></td><td>${escapeHtml(x.partner_name_snapshot)}</td><td>${dateBR(x.period_start)} → ${dateBR(x.period_end)}</td><td>${x.sales_count}</td><td class="money-cell">${money(x.gross_sales_cents)}</td><td class="money-cell">${money(x.commission_cents)}</td><td class="money-cell">${money(x.dogfit_net_cents)}</td><td><span class="status-pill ${x.status==='PAGO'?'':x.status==='CANCELADO'?'off':'warn'}">${escapeHtml(x.status)}</span></td><td>${x.paid_at?dateBR(x.paid_at):'—'}</td><td><div class="table-actions">${x.status==='PENDENTE'?`<button class="small-btn orange" data-pay-settlement="${x.id}">Marcar pago</button><button class="small-btn danger" data-cancel-settlement="${x.id}">Cancelar</button>`:'—'}</div></td></tr>`).join('');box.querySelectorAll('[data-pay-settlement]').forEach(b=>b.onclick=()=>openPayment(Number(b.dataset.paySettlement)));box.querySelectorAll('[data-cancel-settlement]').forEach(b=>b.onclick=()=>cancelSettlement(Number(b.dataset.cancelSettlement)))}
["commissionPartnerFilter","commissionFrom","commissionTo","settlementStatusFilter"].forEach(id=>$(id).onchange=loadCommissionsAndSettlements);
$("generateSettlementBtn").onclick=()=>{$("settlementForm").reset();$("settlementPartner").value=$("commissionPartnerFilter").value||'';$("settlementStart").value=$("commissionFrom").value||monthStart;$("settlementEnd").value=$("commissionTo").value||today;$("settlementDialog").showModal()};
$("settlementForm").onsubmit=async event=>{event.preventDefault();try{const result=await request('/api/admin/consignments/settlements',{method:'POST',body:JSON.stringify({partner_id:Number($("settlementPartner").value),period_start:$("settlementStart").value,period_end:$("settlementEnd").value,notes:$("settlementNotes").value})});$("settlementDialog").close();await loadCommissionsAndSettlements();toast(`Fechamento ${result.code} gerado. Faça o Pix e marque como pago.`)}catch(error){toast(error.message,true)}};
function openPayment(id){const x=state.settlements.find(s=>Number(s.id)===id);if(!x)return;$("paymentSettlementId").value=id;$("paymentDate").value=today;$("paymentNotes").value='';$("paymentSummary").innerHTML=`<div><span>Vendido</span><strong>${money(x.gross_sales_cents)}</strong></div><div class="commission"><span>Comissão a pagar</span><strong>${money(x.commission_cents)}</strong></div><div><span>DOGFIT</span><strong>${money(x.dogfit_net_cents)}</strong></div>`;$("paymentDialog").showModal()}
$("paymentForm").onsubmit=async event=>{event.preventDefault();const id=Number($("paymentSettlementId").value);if(!confirm('Confirma que o Pix desta comissão já foi realizado?'))return;try{await request(`/api/admin/consignments/settlements/${id}/pay`,{method:'PUT',body:JSON.stringify({paid_on:$("paymentDate").value,notes:$("paymentNotes").value})});$("paymentDialog").close();await refreshAll();toast('Comissão marcada como paga e data registrada.')}catch(error){toast(error.message,true)}};
async function cancelSettlement(id){const reason=prompt('Informe o motivo do cancelamento do fechamento:','Período ou valores precisam ser corrigidos')||'';if(!reason.trim())return;try{await request(`/api/admin/consignments/settlements/${id}/cancel`,{method:'PUT',body:JSON.stringify({notes:reason})});await loadCommissionsAndSettlements();toast('Fechamento cancelado. As comissões voltaram a ficar disponíveis para novo fechamento.')}catch(error){toast(error.message,true)}}

async function refreshAll(reloadMeta=false){try{if(reloadMeta)await loadMeta();state.stock=await request('/api/admin/consignments/stock');await Promise.all([loadDashboard(),loadRemittances(),loadMovements(),loadCommissionsAndSettlements()]);renderStock();await renderSelectedPartnerSummary()}catch(error){console.error(error);toast(error.message,true)}}

async function init(){try{$("remittanceFrom").value=monthStart;$("remittanceTo").value=today;$("movementFrom").value=monthStart;$("movementTo").value=today;$("commissionFrom").value=monthStart;$("commissionTo").value=today;await loadMeta();state.stock=await request('/api/admin/consignments/stock');renderStock();await Promise.all([loadDashboard(),loadRemittances(),loadMovements(),loadCommissionsAndSettlements()])}catch(error){console.error(error);toast(error.message,true)}}
init();
