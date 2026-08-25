const $ = selector => document.querySelector(selector);
let registrations = [];
let selectedId = null;
let timer;
const escapeHtml = value => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const dateBR = value => {
  if (!value) return "A definir";
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value.replace(" ", "T") + (value.includes("Z") ? "" : "Z");
  return new Date(normalized).toLocaleDateString("pt-BR", { dateStyle: "short" });
};
const statusLabel = value => ({pending:"Aguardando PIX",paid:"Pagamento confirmado",cancelled:"Cancelada"}[value] || value);
function toast(message){const box=$("#adminToast");box.textContent=message;box.classList.add("show");setTimeout(()=>box.classList.remove("show"),2400)}
async function request(url,options={}){const response=await fetch(url,{headers:{"content-type":"application/json"},...options});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"Erro ao carregar.");return result}
function render(){
  $("#statTotal").textContent=registrations.length;$("#statPending").textContent=registrations.filter(i=>i.payment_status==="pending").length;$("#statPaid").textContent=registrations.filter(i=>i.payment_status==="paid").length;$("#statDogs").textContent=registrations.reduce((sum,i)=>sum+Number(i.dog_count||0),0);
  const box=$("#adminRegistrations");
  if(!registrations.length){box.innerHTML='<div class="empty">Nenhuma pré-inscrição encontrada.</div>';return}
  box.innerHTML=registrations.map(item=>`<article class="registration-row"><div><span class="code">${escapeHtml(item.registration_code)}</span><strong>${escapeHtml(item.full_name)}</strong><small>${escapeHtml(item.email)} · ${escapeHtml(item.phone)}</small></div><div><strong>${escapeHtml(item.dog_name)}</strong><span>${escapeHtml(item.dog_breed)} · ${item.dog_count} cão(ães)</span></div><div><span class="status ${escapeHtml(item.payment_status)}">${escapeHtml(statusLabel(item.payment_status))}</span><small>${dateBR(item.created_at)}</small></div><button class="details-button" data-id="${item.id}" type="button">Detalhes</button></article>`).join("");
  box.querySelectorAll("[data-id]").forEach(button=>button.onclick=()=>openEditor(Number(button.dataset.id)));
}
async function load(){const q=$("#registrationSearch").value;const status=$("#registrationStatus").value;registrations=await request(`/api/admin/registrations?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`);render()}
function openEditor(id){const item=registrations.find(value=>value.id===id);if(!item)return;selectedId=id;$("#editorTitle").textContent=item.full_name;$("#editorDetails").innerHTML=`<div><small>Código</small><strong>${escapeHtml(item.registration_code)}</strong></div><div><small>Evento</small><strong>${escapeHtml(item.event_title)}</strong></div><div><small>Data/local</small><strong>${dateBR(item.event_date)} · ${escapeHtml(item.event_time||"")}<br>${escapeHtml(item.event_location)}</strong></div><div><small>Contato</small><strong>${escapeHtml(item.phone)}<br>${escapeHtml(item.email)}</strong></div><div><small>Cão</small><strong>${escapeHtml(item.dog_name)} · ${escapeHtml(item.dog_breed)}</strong></div><div><small>Sociabilidade</small><strong>${escapeHtml(item.sociability)} · ${item.dog_count} cão(ães)</strong></div><div><small>Termos</small><strong>Recreativo: sim · Focinheira: sim · Privacidade: sim</strong></div><div><small>Valor informado</small><strong>${escapeHtml(item.event_price||"Consulte")}</strong></div>`;const form=$("#registrationStatusForm");form.elements.payment_status.value=item.payment_status;form.elements.notes.value=item.notes||"";$("#registrationEditor").hidden=false}
document.querySelectorAll("[data-close]").forEach(button=>button.onclick=()=>$("#registrationEditor").hidden=true);
$("#registrationStatusForm").onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;await request(`/api/admin/registrations/${selectedId}`,{method:"PUT",body:JSON.stringify({payment_status:form.elements.payment_status.value,notes:form.elements.notes.value})});$("#registrationEditor").hidden=true;await load();toast("Inscrição atualizada.")};
$("#registrationSearch").oninput=()=>{clearTimeout(timer);timer=setTimeout(load,250)};$("#registrationStatus").onchange=load;
$("#exportCsv").onclick=()=>{const headers=["Código","Nome","Nascimento","Contato","E-mail","Cão","Raça","Quantidade","Sociabilidade","Evento","Data","Horário","Local","Status","Criado em"];const rows=registrations.map(i=>[i.registration_code,i.full_name,i.birth_date,i.phone,i.email,i.dog_name,i.dog_breed,i.dog_count,i.sociability,i.event_title,i.event_date,i.event_time,i.event_location,statusLabel(i.payment_status),i.created_at]);const csv=[headers,...rows].map(row=>row.map(value=>`"${String(value??"").replaceAll('"','""')}"`).join(";")).join("\n");const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="inscricoes-dogfit.csv";link.click();URL.revokeObjectURL(link.href)};
load().catch(error=>toast(error.message));
