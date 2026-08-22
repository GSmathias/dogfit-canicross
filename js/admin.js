const LOCAL_MODE =
  location.protocol === "file:" ||
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  /^\d{1,3}(\.\d{1,3}){3}$/.test(location.hostname) ||
  location.hostname.endsWith(".local");

const KEYS = {
  products: "dogfit_admin_products_v1",
  gallery: "dogfit_admin_gallery_v1",
  content: "dogfit_admin_content_v1"
};

const DEFAULT_CONTENT = {
  hero_eyebrow: "CANICROSS • AVENTURA • PERFORMANCE",
  hero_title: "VOCÊ E SEU CÃO FORAM FEITOS PARA IR MAIS LONGE.",
  hero_text: "Experiências esportivas, trilhas, equipamentos e atividades para fortalecer a conexão entre você e seu cão.",
  hero_image_url: "",
  hero_side_image_url: "",
  about_text: "A DOGFIT CANICROSS nasceu para aproximar tutores e cães através de experiências esportivas, atividades ao ar livre e equipamentos pensados para movimento.",
  club_title: "MAIS EXPERIÊNCIAS. MAIS BENEFÍCIOS.",
  club_text: "Um clube para quem quer viver a DOGFIT durante o ano todo, com benefícios exclusivos em eventos, produtos e experiências.",
  club_benefits: "Condições especiais em eventos\nDescontos em produtos DOGFIT\nVantagens exclusivas para membros\nComunidade de tutores e cães ativos",
  club_image_url: "",
  event_title: "DOGFIT CANICROSS EXPERIENCE",
  event_location: "Anápolis - GO",
  event_date: "",
  event_time: "",
  event_slots: "18",
  event_price: "",
  event_status: "open",
  event_whatsapp_message: "Olá! Quero saber mais sobre o próximo evento da DOGFIT CANICROSS.",
  event_image_url: "",

  performance_title: "A MELHOR VERSÃO DO SEU CÃO.",
  performance_text: "Atividades estruturadas envolvendo corrida, tração e exercícios físicos, com acompanhamento, registros e evolução.",
  performance_activities: "CORRIDA\nTRAÇÃO\nSALTOS",
  performance_note: "Avaliação física veterinária pode ser exigida conforme a atividade.",
  performance_whatsapp_message: "Olá! Quero saber mais sobre a DOGFIT PERFORMANCE.",
  performance_image_url: "",
  performance_active: "1",

  walker_title: "ENERGIA GASTA. ROTINA MAIS LEVE.",
  walker_text: "Passeios individuais pensados para proporcionar atividade, estímulo e bem-estar ao seu cão.",
  walker_image_url: "",
  walker_note: "Consulte disponibilidade de horários e região de atendimento.",
  walker_whatsapp_message: "Olá! Quero saber mais sobre o serviço de Passeador de Cães da DOGFIT.",
  walker_active: "1",
  walker_plans: JSON.stringify([
    { name: "Passeio avulso", detail: "40 minutos", price: "40,00" },
    { name: "Plano 8 passeios", detail: "8 passeios por mês", price: "280,00" },
    { name: "Plano 12 passeios", detail: "12 passeios por mês", price: "390,00" },
    { name: "Plano 16 passeios", detail: "16 passeios por mês", price: "480,00" }
  ])
};

let products = [];
let gallery = [];
let content = { ...DEFAULT_CONTENT };
let currentProductId = null;
let walkerPlans = [];

const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseMoney(value) {
  if (value === "" || value == null) return null;
  const normalized = String(value).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function moneyBR(value) {
  const n = Number(value || 0);
  return n ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "Consulte";
}

function toast(message, error = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast show${error ? " error" : ""}`;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.className = "toast", 2300);
}

function localRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function localWrite(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: options.body instanceof FormData
      ? options.headers
      : { "Content-Type": "application/json", ...(options.headers || {}) }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Erro ${res.status}`);
  }

  return res.status === 204 ? null : res.json();
}

function normalizeProduct(p) {
  return {
    ...p,
    category: p.category || "Outros",
    stock_status: p.stock_status || "available",
    badge: p.badge || "",
    featured: Boolean(p.featured),
    active: p.active !== false && p.active !== 0,
    sort_order: Number(p.sort_order || 0),
    club_price: p.club_price ?? null
  };
}

async function compressImage(file, maxWidth = 1100, quality = 0.76) {
  if (!file.type.startsWith("image/")) throw new Error("Arquivo inválido.");

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise(resolve =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );

  bitmap.close();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ url: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const api = {
  async products() {
    if (LOCAL_MODE) return localRead(KEYS.products, []).map(normalizeProduct);
    return (await request("/api/admin/products")).map(normalizeProduct);
  },

  async createProduct(data) {
    if (LOCAL_MODE) {
      const list = localRead(KEYS.products, []);
      const item = {
        ...data,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString()
      };
      list.unshift(item);
      localWrite(KEYS.products, list);
      return item;
    }
    return request("/api/admin/products", {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  async updateProduct(id, data) {
    if (LOCAL_MODE) {
      const list = localRead(KEYS.products, []).map(p =>
        String(p.id) === String(id) ? { ...p, ...data } : p
      );
      localWrite(KEYS.products, list);
      return list.find(p => String(p.id) === String(id));
    }
    return request(`/api/admin/products/${id}`, {
      method: "PUT",
      body: JSON.stringify(data)
    });
  },

  async deleteProduct(id) {
    if (LOCAL_MODE) {
      localWrite(
        KEYS.products,
        localRead(KEYS.products, []).filter(p => String(p.id) !== String(id))
      );
      return;
    }
    return request(`/api/admin/products/${id}`, { method: "DELETE" });
  },

  async content() {
    if (LOCAL_MODE) {
      return { ...DEFAULT_CONTENT, ...localRead(KEYS.content, {}) };
    }
    return request("/api/admin/content");
  },

  async saveContent(data) {
    if (LOCAL_MODE) {
      const merged = { ...localRead(KEYS.content, {}), ...data };
      localWrite(KEYS.content, merged);
      return merged;
    }
    return request("/api/admin/content", {
      method: "PUT",
      body: JSON.stringify(data)
    });
  },

  async gallery() {
    if (LOCAL_MODE) return localRead(KEYS.gallery, []);
    return request("/api/admin/gallery");
  },

  async addGallery(data) {
    if (LOCAL_MODE) {
      const list = localRead(KEYS.gallery, []);
      const item = {
        ...data,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString()
      };
      list.unshift(item);
      localWrite(KEYS.gallery, list);
      return item;
    }
    return request("/api/admin/gallery", {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  async deleteGallery(id) {
    if (LOCAL_MODE) {
      localWrite(
        KEYS.gallery,
        localRead(KEYS.gallery, []).filter(x => String(x.id) !== String(id))
      );
      return;
    }
    return request(`/api/admin/gallery/${id}`, { method: "DELETE" });
  },

  async upload(file) {
    if (LOCAL_MODE) return compressImage(file);

    const fd = new FormData();
    fd.append("file", file);

    return request("/api/admin/upload", {
      method: "POST",
      body: fd
    });
  }
};

const views = {
  dashboard: $("dashboardView"),
  products: $("productsView"),
  event: $("eventView"),
  home: $("homeView"),
  performance: $("performanceView"),
  walker: $("walkerView"),
  gallery: $("galleryView"),
  preview: $("previewView")
};

const titles = {
  dashboard: "Visão geral",
  products: "Produtos",
  event: "Próximo evento",
  home: "Home e Clube",
  performance: "DOGFIT Performance",
  walker: "Passeador de Cães",
  gallery: "Galeria",
  preview: "Prévia do site"
};

function refreshPreview() {
  const iframe = $("sitePreview");
  if (!iframe) return;
  iframe.src = `index.html?preview=${Date.now()}`;
}

function switchView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle("active", key === name);
  });

  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });

  $("viewTitle").textContent = titles[name] || "Admin";
  document.querySelector(".sidebar").classList.remove("open");

  if (name === "preview") refreshPreview();
}

document.querySelectorAll(".nav-item").forEach(btn =>
  btn.addEventListener("click", () => switchView(btn.dataset.view))
);

document.querySelectorAll("[data-go]").forEach(btn =>
  btn.addEventListener("click", () => switchView(btn.dataset.go))
);

$("mobileMenu").addEventListener("click", () =>
  document.querySelector(".sidebar").classList.toggle("open")
);

$("refreshPreview").addEventListener("click", refreshPreview);

function renderDashboard() {
  $("statProducts").textContent = products.length;
  $("statFeatured").textContent = products.filter(p => p.featured).length;
  $("statGallery").textContent = gallery.length;
  $("statEvent").textContent = content.event_title || "—";
  $("statEventDate").textContent = content.event_date
    ? new Date(`${content.event_date}T12:00:00`).toLocaleDateString("pt-BR")
    : "sem data";
}

function stockLabel(value) {
  return {
    available: "Disponível",
    preorder: "Sob encomenda",
    soldout: "Esgotado"
  }[value] || "Disponível";
}

function getFilteredProducts() {
  const term = $("productSearch").value.trim().toLowerCase();
  const category = $("categoryFilter").value;

  return products
    .filter(p => {
      const searchable = `${p.name || ""} ${p.description || ""}`.toLowerCase();
      return (!term || searchable.includes(term)) &&
        (!category || p.category === category);
    })
    .sort((a, b) =>
      Number(a.sort_order || 0) - Number(b.sort_order || 0)
    );
}

function renderProducts() {
  const list = getFilteredProducts();
  const box = $("productsList");

  if (!list.length) {
    box.innerHTML = `<div class="empty-state">Nenhum produto encontrado.</div>`;
    return;
  }

  box.innerHTML = list.map(p => `
    <article class="product-row">
      ${
        p.image_url
          ? `<img class="product-thumb" src="${escapeHtml(p.image_url)}" alt="">`
          : `<div class="product-thumb"></div>`
      }

      <div class="product-copy">
        <strong>${escapeHtml(p.name)}</strong>
        <p>${escapeHtml(p.description || "Sem descrição")}</p>

        <div class="meta-row">
          <span class="meta-chip">${escapeHtml(p.category || "Outros")}</span>
          <span class="meta-chip ${p.stock_status === "soldout" ? "red" : ""}">
            ${stockLabel(p.stock_status)}
          </span>
          ${p.badge ? `<span class="meta-chip orange">${escapeHtml(p.badge)}</span>` : ""}
          ${p.featured ? `<span class="meta-chip orange">DESTAQUE</span>` : ""}
          ${!p.active ? `<span class="meta-chip red">OCULTO</span>` : ""}
          <span class="meta-chip">ordem ${Number(p.sort_order || 0)}</span>
        </div>
      </div>

      <div class="price-box">
        <div class="admin-price-row">
          <span>Normal</span>
          <strong>${moneyBR(p.price)}</strong>
        </div>

        ${
          p.club_price
            ? `
              <div class="admin-price-row club">
                <span>Clube</span>
                <strong>${moneyBR(p.club_price)}</strong>
              </div>
              ${
                Number(p.price) > Number(p.club_price)
                  ? `<small class="admin-saving">Economia: ${moneyBR(Number(p.price) - Number(p.club_price))}</small>`
                  : ""
              }
            `
            : ""
        }
      </div>

      <div class="row-actions">
        <button class="icon-btn" data-edit-product="${escapeHtml(p.id)}" title="Editar">✎</button>
        <button class="icon-btn" data-delete-product="${escapeHtml(p.id)}" title="Excluir">🗑</button>
      </div>
    </article>
  `).join("");

  box.querySelectorAll("[data-edit-product]").forEach(btn => {
    btn.onclick = () => openProductEditor(btn.dataset.editProduct);
  });

  box.querySelectorAll("[data-delete-product]").forEach(btn => {
    btn.onclick = () => removeProduct(btn.dataset.deleteProduct);
  });
}

$("productSearch").addEventListener("input", renderProducts);
$("categoryFilter").addEventListener("change", renderProducts);

function imagePreview(el, url, empty = "Nenhuma foto selecionada") {
  el.innerHTML = url
    ? `<img src="${url}" alt="Prévia">`
    : `<span>${empty}</span>`;
}

function openProductEditor(id = null) {
  currentProductId = id;
  const p = products.find(x => String(x.id) === String(id));

  $("productEditor").classList.remove("hidden");
  $("productEditorTitle").textContent = p ? "Editar produto" : "Novo produto";
  $("productId").value = p?.id || "";
  $("productName").value = p?.name || "";
  $("productCategory").value = p?.category || "Outros";
  $("productStockStatus").value = p?.stock_status || "available";
  $("productPrice").value = p?.price ?? "";
  $("productClubPrice").value = p?.club_price ?? "";
  $("productBadge").value = p?.badge || "";
  $("productSortOrder").value = p?.sort_order ?? 0;
  $("productDescription").value = p?.description || "";
  $("productImageUrl").value = p?.image_url || "";
  $("productActive").checked = p ? Boolean(p.active) : true;
  $("productFeatured").checked = p ? Boolean(p.featured) : false;
  $("productImageFile").value = "";

  imagePreview($("productImagePreview"), p?.image_url);
  $("productEditor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeProductEditor() {
  currentProductId = null;
  $("productEditor").classList.add("hidden");
}

$("newProductBtn").onclick = () => openProductEditor();
$("closeProductEditor").onclick = closeProductEditor;
$("cancelProduct").onclick = closeProductEditor;

$("productImageFile").addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) imagePreview($("productImagePreview"), URL.createObjectURL(file));
});

$("productForm").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    let imageUrl = $("productImageUrl").value;
    const file = $("productImageFile").files[0];

    if (file) imageUrl = (await api.upload(file)).url;

    const payload = {
      name: $("productName").value.trim(),
      category: $("productCategory").value,
      stock_status: $("productStockStatus").value,
      price: parseMoney($("productPrice").value),
      club_price: parseMoney($("productClubPrice").value),
      badge: $("productBadge").value.trim(),
      sort_order: Number($("productSortOrder").value || 0),
      description: $("productDescription").value.trim(),
      image_url: imageUrl,
      active: $("productActive").checked,
      featured: $("productFeatured").checked
    };

    if (currentProductId) {
      await api.updateProduct(currentProductId, payload);
    } else {
      await api.createProduct(payload);
    }

    products = await api.products();
    renderProducts();
    renderDashboard();
    closeProductEditor();
    refreshPreview();
    toast("Produto salvo.");
  } catch (err) {
    console.error(err);
    toast(
      LOCAL_MODE
        ? "Não foi possível salvar. Tente uma foto menor."
        : "Não foi possível salvar o produto.",
      true
    );
  }
});

async function removeProduct(id) {
  const p = products.find(x => String(x.id) === String(id));
  if (!confirm(`Excluir "${p?.name || "este produto"}"?`)) return;

  try {
    await api.deleteProduct(id);
    products = await api.products();
    renderProducts();
    renderDashboard();
    refreshPreview();
    toast("Produto excluído.");
  } catch (err) {
    console.error(err);
    toast("Não foi possível excluir.", true);
  }
}

function fillEventForm() {
  $("eventTitle").value = content.event_title || "";
  $("eventLocation").value = content.event_location || "";
  $("eventDate").value = content.event_date || "";
  $("eventTime").value = content.event_time || "";
  $("eventSlots").value = content.event_slots || "";
  $("eventPrice").value = content.event_price || "";
  $("eventStatus").value = content.event_status || "open";
  $("eventWhatsappMessage").value = content.event_whatsapp_message || "";
  $("eventImageUrl").value = content.event_image_url || "";

  imagePreview(
    $("eventImagePreview"),
    content.event_image_url,
    "Nenhuma foto de evento selecionada"
  );
}

$("eventImageFile").addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) imagePreview($("eventImagePreview"), URL.createObjectURL(file));
});

$("eventForm").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    let imageUrl = $("eventImageUrl").value;
    const file = $("eventImageFile").files[0];

    if (file) imageUrl = (await api.upload(file)).url;

    const data = {
      event_title: $("eventTitle").value.trim(),
      event_location: $("eventLocation").value.trim(),
      event_date: $("eventDate").value,
      event_time: $("eventTime").value,
      event_slots: $("eventSlots").value,
      event_price: $("eventPrice").value,
      event_status: $("eventStatus").value,
      event_whatsapp_message: $("eventWhatsappMessage").value.trim(),
      event_image_url: imageUrl
    };

    await api.saveContent(data);
    content = { ...content, ...data };

    renderDashboard();
    refreshPreview();
    toast("Evento atualizado.");
  } catch (err) {
    console.error(err);
    toast("Não foi possível salvar o evento.", true);
  }
});

function fillHomeForm() {
  $("heroEyebrow").value = content.hero_eyebrow || "";
  $("heroTitle").value = content.hero_title || "";
  $("heroText").value = content.hero_text || "";
  $("heroImageUrl").value = content.hero_image_url || "";
  $("heroSideImageUrl").value = content.hero_side_image_url || "";
  $("clubTitle").value = content.club_title || "";
  $("clubText").value = content.club_text || "";
  $("clubBenefits").value = content.club_benefits || "";
  $("clubImageUrl").value = content.club_image_url || "";
  $("aboutText").value = content.about_text || "";

  imagePreview(
    $("heroImagePreview"),
    content.hero_image_url,
    "Nenhuma foto de capa selecionada"
  );
  imagePreview(
    $("heroSideImagePreview"),
    content.hero_side_image_url,
    "Nenhuma foto lateral selecionada"
  );

  imagePreview(
    $("clubImagePreview"),
    content.club_image_url,
    "Nenhuma foto selecionada"
  );
}

$("heroImageFile").addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) imagePreview($("heroImagePreview"), URL.createObjectURL(file));
});
$("heroSideImageFile").addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) imagePreview($("heroSideImagePreview"), URL.createObjectURL(file));
});

$("clubImageFile").addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) imagePreview($("clubImagePreview"), URL.createObjectURL(file));
});

$("homeForm").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    let heroImageUrl = $("heroImageUrl").value;
    const heroFile = $("heroImageFile").files[0];
    let heroSideImageUrl = $("heroSideImageUrl").value;
    const heroSideFile = $("heroSideImageFile").files[0];
    let clubImageUrl = $("clubImageUrl").value;
    const clubFile = $("clubImageFile").files[0];

    if (heroFile) heroImageUrl = (await api.upload(heroFile)).url;
    if (heroSideFile) heroSideImageUrl = (await api.upload(heroSideFile)).url;
    if (clubFile) clubImageUrl = (await api.upload(clubFile)).url;

    const data = {
      hero_eyebrow: $("heroEyebrow").value.trim(),
      hero_title: $("heroTitle").value.trim(),
      hero_text: $("heroText").value.trim(),
      hero_image_url: heroImageUrl,
      hero_side_image_url: heroSideImageUrl,
      club_title: $("clubTitle").value.trim(),
      club_text: $("clubText").value.trim(),
      club_benefits: $("clubBenefits").value.trim(),
      club_image_url: clubImageUrl,
      about_text: $("aboutText").value.trim()
    };

    await api.saveContent(data);
    content = { ...content, ...data };

    refreshPreview();
    toast("Home atualizada.");
  } catch (err) {
    console.error(err);
    toast("Não foi possível salvar a Home.", true);
  }
});


function fillPerformanceForm() {
  $("performanceTitle").value = content.performance_title || "";
  $("performanceText").value = content.performance_text || "";
  $("performanceActivities").value = content.performance_activities || "";
  $("performanceNote").value = content.performance_note || "";
  $("performanceWhatsappMessage").value =
    content.performance_whatsapp_message || "";
  $("performanceImageUrl").value = content.performance_image_url || "";
  $("performanceActive").checked =
    String(content.performance_active ?? "1") !== "0";

  imagePreview(
    $("performanceImagePreview"),
    content.performance_image_url,
    "Nenhuma foto selecionada"
  );
}

$("performanceImageFile").addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) {
    imagePreview(
      $("performanceImagePreview"),
      URL.createObjectURL(file)
    );
  }
});

$("performanceForm").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    let imageUrl = $("performanceImageUrl").value;
    const file = $("performanceImageFile").files[0];

    if (file) imageUrl = (await api.upload(file)).url;

    const data = {
      performance_title: $("performanceTitle").value.trim(),
      performance_text: $("performanceText").value.trim(),
      performance_activities: $("performanceActivities").value.trim(),
      performance_note: $("performanceNote").value.trim(),
      performance_whatsapp_message:
        $("performanceWhatsappMessage").value.trim(),
      performance_image_url: imageUrl,
      performance_active: $("performanceActive").checked ? "1" : "0"
    };

    await api.saveContent(data);
    content = { ...content, ...data };

    refreshPreview();
    toast("DOGFIT Performance atualizado.");
  } catch (err) {
    console.error(err);
    toast("Não foi possível salvar o Performance.", true);
  }
});

function readWalkerPlans() {
  try {
    const raw = content.walker_plans;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderWalkerPlansEditor() {
  const box = $("walkerPlansEditor");

  if (!walkerPlans.length) {
    box.innerHTML =
      `<div class="empty-state">Nenhum plano cadastrado. Clique em “Adicionar plano”.</div>`;
    return;
  }

  box.innerHTML = walkerPlans.map((plan, index) => `
    <div class="service-plan-editor" data-walker-plan="${index}">
      <label class="field">
        <span>Nome do plano</span>
        <input
          data-plan-field="name"
          value="${escapeHtml(plan.name || "")}"
          placeholder="Ex.: Passeio avulso"
        >
      </label>

      <label class="field">
        <span>Detalhe</span>
        <input
          data-plan-field="detail"
          value="${escapeHtml(plan.detail || "")}"
          placeholder="Ex.: 40 minutos"
        >
      </label>

      <label class="field">
        <span>Preço</span>
        <input
          data-plan-field="price"
          value="${escapeHtml(plan.price || "")}"
          placeholder="40,00"
        >
      </label>

      <button
        type="button"
        class="btn btn-danger remove-service-plan"
        data-remove-plan="${index}"
        title="Excluir plano"
      >
        ×
      </button>
    </div>
  `).join("");

  box.querySelectorAll("[data-plan-field]").forEach(input => {
    input.addEventListener("input", () => {
      const wrapper = input.closest("[data-walker-plan]");
      const index = Number(wrapper.dataset.walkerPlan);
      const field = input.dataset.planField;
      walkerPlans[index][field] = input.value;
    });
  });

  box.querySelectorAll("[data-remove-plan]").forEach(btn => {
    btn.addEventListener("click", () => {
      walkerPlans.splice(Number(btn.dataset.removePlan), 1);
      renderWalkerPlansEditor();
    });
  });
}

$("addWalkerPlan").addEventListener("click", () => {
  walkerPlans.push({
    name: "Novo plano",
    detail: "",
    price: ""
  });
  renderWalkerPlansEditor();
});

function fillWalkerForm() {
  $("walkerTitle").value = content.walker_title || "";
  $("walkerText").value = content.walker_text || "";
  $("walkerImageUrl").value = content.walker_image_url || "";
  $("walkerNote").value = content.walker_note || "";
  $("walkerWhatsappMessage").value =
    content.walker_whatsapp_message || "";
  $("walkerActive").checked =
    String(content.walker_active ?? "1") !== "0";

  imagePreview(
    $("walkerImagePreview"),
    content.walker_image_url,
    "Nenhuma foto selecionada"
  );

  walkerPlans = readWalkerPlans();
  renderWalkerPlansEditor();
}

$("walkerImageFile").addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) {
    imagePreview(
      $("walkerImagePreview"),
      URL.createObjectURL(file)
    );
  }
});

$("walkerForm").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    let imageUrl = $("walkerImageUrl").value;
    const file = $("walkerImageFile").files[0];

    if (file) imageUrl = (await api.upload(file)).url;

    const cleanPlans = walkerPlans
      .map(plan => ({
        name: String(plan.name || "").trim(),
        detail: String(plan.detail || "").trim(),
        price: String(plan.price || "").trim()
      }))
      .filter(plan => plan.name || plan.price || plan.detail);

    const data = {
      walker_title: $("walkerTitle").value.trim(),
      walker_text: $("walkerText").value.trim(),
      walker_image_url: imageUrl,
      walker_note: $("walkerNote").value.trim(),
      walker_whatsapp_message:
        $("walkerWhatsappMessage").value.trim(),
      walker_active: $("walkerActive").checked ? "1" : "0",
      walker_plans: JSON.stringify(cleanPlans)
    };

    await api.saveContent(data);
    content = { ...content, ...data };
    walkerPlans = cleanPlans;

    refreshPreview();
    toast("Passeador de Cães atualizado.");
  } catch (err) {
    console.error(err);
    toast("Não foi possível salvar o Passeador.", true);
  }
});

function renderGallery() {
  const box = $("galleryList");

  if (!gallery.length) {
    box.innerHTML = `<div class="empty-state">Nenhuma foto na galeria.</div>`;
    return;
  }

  box.innerHTML = gallery.map(item => `
    <article class="gallery-admin-item">
      <img src="${escapeHtml(item.image_url)}" alt="">
      <div class="gallery-admin-copy">
        <p>${escapeHtml(item.caption || "Sem legenda")}</p>
        <button class="btn btn-danger" data-delete-gallery="${escapeHtml(item.id)}">
          Excluir
        </button>
      </div>
    </article>
  `).join("");

  box.querySelectorAll("[data-delete-gallery]").forEach(btn => {
    btn.onclick = () => removeGallery(btn.dataset.deleteGallery);
  });
}

$("galleryForm").addEventListener("submit", async e => {
  e.preventDefault();

  const file = $("galleryFile").files[0];
  if (!file) return;

  try {
    const upload = await api.upload(file);

    await api.addGallery({
      image_url: upload.url,
      caption: $("galleryCaption").value.trim()
    });

    gallery = await api.gallery();
    renderGallery();
    renderDashboard();
    e.target.reset();
    refreshPreview();
    toast("Foto adicionada.");
  } catch (err) {
    console.error(err);
    toast(
      LOCAL_MODE
        ? "Não foi possível salvar a foto. O navegador pode estar sem espaço."
        : "Não foi possível enviar a foto.",
      true
    );
  }
});

async function removeGallery(id) {
  if (!confirm("Excluir esta foto da galeria?")) return;

  try {
    await api.deleteGallery(id);
    gallery = await api.gallery();
    renderGallery();
    renderDashboard();
    refreshPreview();
    toast("Foto removida.");
  } catch (err) {
    console.error(err);
    toast("Não foi possível remover.", true);
  }
}

async function init() {
  $("modeBadge").textContent = LOCAL_MODE ? "Modo local" : "Cloudflare";
  $("localNotice").style.display = LOCAL_MODE ? "block" : "none";

  try {
    [products, gallery, content] = await Promise.all([
      api.products(),
      api.gallery(),
      api.content()
    ]);

    content = { ...DEFAULT_CONTENT, ...content };

    renderProducts();
    renderGallery();
    fillEventForm();
    fillHomeForm();
    fillPerformanceForm();
    fillWalkerForm();
    renderDashboard();
  } catch (err) {
    console.error(err);
    toast("Erro ao carregar o painel.", true);
  }
}

init();
