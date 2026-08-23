const box = document.getElementById("cardContent");

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function dateBR(value) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR") : "Sem prazo";
}

function remaining(item) {
  if (item.remaining == null) return "";
  return ` · ${item.remaining} de ${item.usage_limit} restante(s)`;
}

async function init() {
  const token = location.pathname.split("/").filter(Boolean).at(-1) || "";
  try {
    const response = await fetch(`/api/club/card/${encodeURIComponent(token)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Carteirinha não encontrada.");
    const member = data.member;
    const qrUrl = `https://quickchart.io/qr?size=220&margin=1&text=${encodeURIComponent(location.href)}`;
    box.innerHTML = `
      <div class="identity">
        <div>
          <p class="eyebrow">CARTEIRINHA DIGITAL</p>
          <h1>${escapeHtml(member.name)}</h1>
          <div class="member-code">${escapeHtml(member.member_code)}</div>
          <p class="lead">${escapeHtml(member.plan_name)}</p>
          <div class="member-meta"><span>Cão: <strong>${escapeHtml(member.dog_name || "Não informado")}</strong></span><span>Validade: <strong>${escapeHtml(dateBR(member.valid_until))}</strong></span></div>
          <p><span class="status${member.active ? "" : " off"}">${member.active ? "Associação ativa" : "Associação inativa"}</span></p>
        </div>
        <div class="qr-box"><img src="${qrUrl}" alt="QR Code para validar a carteirinha" width="170" height="170"></div>
      </div>
      <h3 class="section-title">Benefícios do Clube</h3>
      <div class="benefit-list">${data.benefits.length ? data.benefits.map(item => `<div class="benefit-line"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.description)}${escapeHtml(remaining(item))}${item.partner_name ? ` · Em ${escapeHtml(item.partner_name)}` : ""}</span></div>`).join("") : '<div class="empty">Nenhum benefício ativo.</div>'}</div>
      <p class="privacy">Para sua segurança, esta carteirinha não exibe telefone, e-mail nem dados de pagamento. A validação deve ser feita pelo portal oficial do parceiro DOGFIT.</p>
    `;
  } catch (error) {
    box.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

init();
