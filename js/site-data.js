(() => {
  const PRODUCTS_KEY = "dogfit_admin_products_v1";
  const GALLERY_KEY = "dogfit_admin_gallery_v1";
  const CONTENT_KEY = "dogfit_admin_content_v1";

  const IS_LOCAL =
    location.protocol === "file:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(location.hostname) ||
    location.hostname.endsWith(".local");

  const readLocal = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  };

  const esc = value => String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;");

  const moneyBR = value => {
    const n = Number(value || 0);
    return n ? n.toLocaleString("pt-BR", { style:"currency", currency:"BRL" }) : "Consulte";
  };

  function localData() {
    return {
      products: readLocal(PRODUCTS_KEY, [])
        .filter(p => p.active !== false && p.active !== 0)
        .sort((a,b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
      gallery: readLocal(GALLERY_KEY, []),
      content: readLocal(CONTENT_KEY, {})
    };
  }

  async function getData() {
    if (IS_LOCAL) return localData();

    try {
      const [productsRes, contentRes] = await Promise.all([
        fetch("/api/products", { cache:"no-store" }),
        fetch("/api/content", { cache:"no-store" })
      ]);

      if (!productsRes.ok || !contentRes.ok) throw new Error("API não configurada.");

      const products = await productsRes.json();
      const bundle = await contentRes.json();

      return {
        products,
        gallery: bundle.gallery || [],
        content: bundle.content || {}
      };
    } catch (error) {
      console.warn("DOGFIT CMS: usando dados locais.", error);
      return localData();
    }
  }

  function applyContent(content) {
    const hero = document.querySelector(".hero");
    const heroEyebrow = document.querySelector(".hero .eyebrow");
    const heroTitle = document.querySelector(".hero h1");
    const heroText = document.querySelector(".hero .hero-text");

    if (content.hero_eyebrow && heroEyebrow) heroEyebrow.textContent = content.hero_eyebrow;
    if (content.hero_title && heroTitle) heroTitle.textContent = content.hero_title;
    if (content.hero_text && heroText) heroText.textContent = content.hero_text;

    if (hero && content.hero_image_url) {
      hero.style.backgroundImage =
        `linear-gradient(90deg, rgba(5,5,5,.88) 0%, rgba(5,5,5,.58) 52%, rgba(5,5,5,.26) 100%), url("${content.hero_image_url}")`;
      hero.style.backgroundPosition = "center";
      hero.style.backgroundSize = "cover";
    }
    const heroSidePhoto = document.querySelector(".hero-side-photo");
    if (heroSidePhoto && content.hero_side_image_url) {
      heroSidePhoto.innerHTML = `<img src="${content.hero_side_image_url}" alt="DOGFIT CANICROSS">`;
    }

    const eventTitle = document.querySelector(".event-content h3");
    if (eventTitle && content.event_title) eventTitle.textContent = content.event_title;

    const eventPriceValue = document.querySelector(".event-price-value");
    if (eventPriceValue && content.event_price) {
      const rawPrice = String(content.event_price).replace(",", ".");
      const numericPrice = Number(rawPrice);
      eventPriceValue.textContent = Number.isFinite(numericPrice)
        ? numericPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        : `R$ ${content.event_price}`;
    }

    const info = document.querySelectorAll(".event-info li");
    if (info[0] && content.event_location) info[0].innerHTML = `<strong>LOCAL</strong><span>${esc(content.event_location)}</span>`;

    if (info[1] && content.event_date) {
      const date = new Date(`${content.event_date}T12:00:00`).toLocaleDateString("pt-BR");
      info[1].innerHTML = `<strong>DATA</strong><span>${date}</span>`;
    }

    if (info[2] && content.event_time) info[2].innerHTML = `<strong>HORÁRIO</strong><span>${esc(content.event_time)}</span>`;
    if (info[3] && content.event_slots) info[3].innerHTML = `<strong>VAGAS</strong><span>${esc(content.event_slots)}</span>`;

    const eventImage = document.querySelector(".event-image");
    if (eventImage && content.event_image_url) {
      eventImage.innerHTML = `<img src="${content.event_image_url}" alt="Evento DOGFIT" style="width:100%;height:100%;object-fit:cover;display:block">`;
    }

    const eventBtn = document.querySelector(".event-content .whatsapp-link");
    const registrationBtn = document.querySelector("#openRegistration");
    if (eventBtn && content.event_whatsapp_message) {
      eventBtn.dataset.message = content.event_whatsapp_message;
    }

    if (eventBtn && content.event_status === "soldout") {
      if (registrationBtn) {
        registrationBtn.textContent = "EVENTO ESGOTADO";
        registrationBtn.disabled = true;
        registrationBtn.style.opacity = ".55";
      }
    } else if (eventBtn && content.event_status === "soon") {
      if (registrationBtn) registrationBtn.textContent = "QUERO SER AVISADO";
    }

    const clubHeading = document.querySelector("#clube h2");
    const clubLead = document.querySelector("#clube .lead");
    const clubList = document.querySelector("#clube .check-list");
    const clubPhoto = document.querySelector("#clube .club-photo");

    if (clubHeading && content.club_title) clubHeading.textContent = content.club_title;
    if (clubLead && content.club_text) clubLead.textContent = content.club_text;

    if (clubList && content.club_benefits) {
      const benefits = content.club_benefits
        .split("\n")
        .map(v => v.trim())
        .filter(Boolean);

      if (benefits.length) {
        clubList.innerHTML = benefits.map(v => `<li>${esc(v)}</li>`).join("");
      }
    }

    if (clubPhoto && content.club_image_url) {
      clubPhoto.innerHTML = `
        <img
          src="${content.club_image_url}"
          alt="Benefícios do Clube DOGFIT"
        >
      `;
    }

    const performanceSection = document.querySelector("#performance");

    if (performanceSection) {
      performanceSection.style.display =
        String(content.performance_active ?? "1") === "0" ? "none" : "";

      const performanceTitle =
        performanceSection.querySelector("h2");
      const performanceText =
        performanceSection.querySelector(".lead");
      const performanceNote =
        performanceSection.querySelector(".small-note");
      const performanceActivities =
        performanceSection.querySelector(".pill-row");
      const performanceImage =
        performanceSection.querySelector(".performance-visual");
      const performanceBtn =
        performanceSection.querySelector(".whatsapp-link");

      if (performanceTitle && content.performance_title) {
        performanceTitle.textContent = content.performance_title;
      }

      if (performanceText && content.performance_text) {
        performanceText.textContent = content.performance_text;
      }

      if (performanceNote && content.performance_note) {
        performanceNote.textContent = content.performance_note;
      }

      if (performanceActivities && content.performance_activities) {
        const activities = content.performance_activities
          .split("\n")
          .map(v => v.trim())
          .filter(Boolean);

        performanceActivities.innerHTML =
          activities.map(v => `<span>${esc(v)}</span>`).join("");
      }

      if (performanceImage && content.performance_image_url) {
        performanceImage.innerHTML = `
          <img
            src="${content.performance_image_url}"
            alt="DOGFIT Performance"
            style="width:100%;height:100%;object-fit:cover;display:block"
          >
        `;
      }

      if (
        performanceBtn &&
        content.performance_whatsapp_message
      ) {
        performanceBtn.dataset.message =
          content.performance_whatsapp_message;
      }
    }

    const walkerSection = document.querySelector("#passeador");

    if (walkerSection) {
      walkerSection.style.display =
        String(content.walker_active ?? "1") === "0" ? "none" : "";

      const walkerTitle =
        walkerSection.querySelector("h2");
      const walkerText =
        walkerSection.querySelector(".walker-lead");
      const walkerVisual =
        walkerSection.querySelector(".walker-visual");
      const walkerPlansBox =
        walkerSection.querySelector(".walker-plans");
      const walkerNote =
        walkerSection.querySelector(".walker-note");
      const walkerBtn =
        walkerSection.querySelector(".walker-whatsapp");

      if (walkerTitle && content.walker_title) {
        walkerTitle.textContent = content.walker_title;
      }

      if (walkerText && content.walker_text) {
        walkerText.textContent = content.walker_text;
      }

      if (walkerVisual && content.walker_image_url) {
        walkerVisual.innerHTML = `
          <img
            src="${content.walker_image_url}"
            alt="DOGFIT Passeador de Cães"
          >
        `;
      }

      let walkerPlans = [];

      try {
        walkerPlans =
          typeof content.walker_plans === "string"
            ? JSON.parse(content.walker_plans)
            : content.walker_plans || [];
      } catch {
        walkerPlans = [];
      }

      if (walkerPlansBox && Array.isArray(walkerPlans) && walkerPlans.length) {
        walkerPlansBox.innerHTML = walkerPlans.map(plan => `
          <article class="walker-plan">
            <span class="walker-plan-name">${esc(plan.name || "")}</span>
            <strong>${plan.price ? `R$ ${esc(plan.price)}` : "Consulte"}</strong>
            <small>${esc(plan.detail || "")}</small>
          </article>
        `).join("");
      }

      if (walkerNote && content.walker_note) {
        walkerNote.textContent = content.walker_note;
      }

      if (walkerBtn && content.walker_whatsapp_message) {
        walkerBtn.dataset.message =
          content.walker_whatsapp_message;
      }
    }

    const about = document.querySelector(".about-text p");
    if (about && content.about_text) about.textContent = content.about_text;
  }

  function stockText(status) {
    return {
      available:"DISPONÍVEL",
      preorder:"SOB ENCOMENDA",
      soldout:"ESGOTADO"
    }[status] || "DISPONÍVEL";
  }

  function renderProducts(products) {
    const grid = document.querySelector(".product-grid");
    if (!grid || !products.length) return;

    grid.innerHTML = products.map(p => {
      const soldout = p.stock_status === "soldout";

      return `
        <article class="product-card reveal ${p.featured ? "product-featured" : ""}">
          <div class="product-image product-image-admin" style="position:relative">
            ${
              p.image_url
                ? `<img src="${p.image_url}" alt="${esc(p.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block">`
                : `<div class="placeholder-image" style="width:100%;height:100%"><span>PRODUTO DOGFIT</span></div>`
            }

            ${
              p.badge
                ? `<span style="position:absolute;top:12px;left:12px;background:#ff6a00;color:#111;font-size:.7rem;font-weight:900;padding:7px 9px;border-radius:999px">${esc(p.badge)}</span>`
                : ""
            }
          </div>

          <div class="product-body">
            <p class="product-tag">${esc(p.category || "DOGFIT GEAR")}</p>
            <h3>${esc(p.name || "Produto DOGFIT")}</h3>
            <p>${esc(p.description || "")}</p>

            <div style="margin:.8rem 0 1rem">
              <div style="display:flex;gap:10px;align-items:stretch;flex-wrap:wrap">
                <div style="flex:1;min-width:120px;border:1px solid rgba(255,255,255,.10);border-radius:10px;padding:10px 12px;background:rgba(255,255,255,.025)">
                  <span style="display:block;color:#8f8f8f;font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em">
                    Preço normal
                  </span>
                  <strong style="display:block;font-size:1.15rem;margin-top:2px">
                    ${moneyBR(p.price)}
                  </strong>
                </div>

                ${
                  p.club_price
                    ? `
                      <div style="flex:1;min-width:120px;border:1px solid rgba(255,106,0,.38);border-radius:10px;padding:10px 12px;background:rgba(255,106,0,.08)">
                        <span style="display:block;color:#ff6a00;font-size:.68rem;font-weight:900;text-transform:uppercase;letter-spacing:.06em">
                          Clube DOGFIT
                        </span>
                        <strong style="display:block;color:#ff6a00;font-size:1.15rem;margin-top:2px">
                          ${moneyBR(p.club_price)}
                        </strong>
                      </div>
                    `
                    : ""
                }
              </div>

              ${
                p.club_price && Number(p.price) > Number(p.club_price)
                  ? `
                    <div style="margin-top:8px;color:#ff6a00;font-size:.76rem;font-weight:800">
                      Economize ${moneyBR(Number(p.price) - Number(p.club_price))}
                      (${Math.round((1 - Number(p.club_price) / Number(p.price)) * 100)}%)
                      sendo membro do Clube
                    </div>
                  `
                  : ""
              }

              <div style="margin-top:9px">
                <span style="font-size:.67rem;font-weight:900;color:${soldout ? "#ff7777" : "#ff6a00"}">
                  ${stockText(p.stock_status)}
                </span>
              </div>
            </div>

            <a
              class="text-link whatsapp-link"
              href="#"
              style="${soldout ? "pointer-events:none;opacity:.45" : ""}"
              data-message="Olá! Quero informações sobre ${esc(p.name || "um produto DOGFIT")}."
            >
              ${soldout ? "ESGOTADO" : "COMPRAR →"}
            </a>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderGallery(gallery) {
    const grid = document.querySelector(".gallery-grid");
    if (!grid || !gallery.length) return;

    grid.innerHTML = gallery.slice(0, 6).map((item, index) => `
      <div class="gallery-item reveal ${index === 0 ? "tall" : ""} ${index === 3 ? "wide" : ""}">
        <img src="${item.image_url}" alt="${esc(item.caption || "DOGFIT CANICROSS")}" loading="lazy"
             style="width:100%;height:100%;object-fit:cover;display:block">
      </div>
    `).join("");
  }

  async function init() {
    try {
      const { products, gallery, content } = await getData();
      applyContent(content);
      renderProducts(products);
      renderGallery(gallery);
      document.dispatchEvent(new CustomEvent("dogfit:data-ready"));
    } catch (error) {
      console.error("DOGFIT CMS:", error);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
