import { json, badRequest, notFound } from "../_lib/http.js";

function responseError(message, status = 409) {
  return json({ error: message }, status);
}

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanVariation(value) {
  return clean(value, 80).replace(/\s+/g, " ").toUpperCase();
}

function positiveInt(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function nonNegativeInt(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

function bps(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10000) return fallback;
  return parsed;
}

function isoDate(value, fallback = "") {
  const text = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return fallback;
  const parsed = new Date(`${text}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : text;
}

function firstDayOfMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function readBody(request) {
  try { return await request.json(); }
  catch { return {}; }
}

async function partnerById(env, id, activeOnly = false) {
  return env.DB.prepare(`
    SELECT p.*,
      s.code AS referral_code,
      s.active AS referral_code_active
    FROM club_partners p
    LEFT JOIN partner_referral_settings s ON s.partner_id = p.id
    WHERE p.id = ? ${activeOnly ? "AND p.active = 1" : ""}
    LIMIT 1
  `).bind(id).first();
}

async function productById(env, id, activeOnly = false) {
  return env.DB.prepare(`
    SELECT id, name, price, club_price, category, stock_status, active
    FROM products
    WHERE id = ? ${activeOnly ? "AND active = 1" : ""}
    LIMIT 1
  `).bind(id).first();
}

async function currentStock(env, partnerId, productId, variation) {
  const row = await env.DB.prepare(`
    SELECT COALESCE(SUM(stock_delta), 0) AS stock
    FROM consignment_movements
    WHERE partner_id = ? AND product_id = ? AND variation = ? COLLATE NOCASE
  `).bind(partnerId, productId, variation).first();
  return Number(row?.stock || 0);
}

async function latestTerms(env, partnerId, productId, variation) {
  const movement = await env.DB.prepare(`
    SELECT unit_price_cents, commission_bps_snapshot
    FROM consignment_movements
    WHERE partner_id = ? AND product_id = ? AND variation = ? COLLATE NOCASE
      AND unit_price_cents >= 0
    ORDER BY movement_date DESC, id DESC
    LIMIT 1
  `).bind(partnerId, productId, variation).first();

  if (movement) {
    return {
      unitPriceCents: Number(movement.unit_price_cents || 0),
      commissionBps: Number(movement.commission_bps_snapshot || 0)
    };
  }

  const [partner, product] = await Promise.all([
    partnerById(env, partnerId),
    productById(env, productId)
  ]);
  if (!partner || !product) return null;

  return {
    unitPriceCents: Math.max(0, Math.round(Number(product.price || 0) * 100)),
    commissionBps: Number(partner.consignment_commission_bps ?? 3000)
  };
}

async function meta(env) {
  const [partnersRows, productsRows] = await Promise.all([
    env.DB.prepare(`
      SELECT p.id, p.name, p.email, p.phone, p.address, p.category, p.active,
        p.responsible_name, p.consignment_enabled, p.consignment_commission_bps,
        p.consignment_low_stock_threshold, p.consignment_notes,
        s.code AS referral_code, s.active AS referral_code_active
      FROM club_partners p
      LEFT JOIN partner_referral_settings s ON s.partner_id = p.id
      ORDER BY p.active DESC, p.name COLLATE NOCASE
    `).all(),
    env.DB.prepare(`
      SELECT id, name, price, club_price, category, stock_status, active
      FROM products
      ORDER BY active DESC, sort_order ASC, name COLLATE NOCASE
    `).all()
  ]);

  return json({ partners: partnersRows.results, products: productsRows.results });
}

async function dashboard(request, env) {
  const url = new URL(request.url);
  const from = isoDate(url.searchParams.get("from"), firstDayOfMonth());
  const to = isoDate(url.searchParams.get("to"), today());

  const [summary, sales, alerts] = await Promise.all([
    env.DB.prepare(`
      WITH stock AS (
        SELECT partner_id, product_id, variation, SUM(stock_delta) AS qty
        FROM consignment_movements
        GROUP BY partner_id, product_id, variation
      )
      SELECT
        (SELECT COUNT(*) FROM club_partners WHERE active = 1 AND consignment_enabled = 1) AS active_partners,
        (SELECT COALESCE(SUM(qty), 0) FROM stock WHERE qty > 0) AS total_units,
        (
          SELECT COALESCE(SUM(
            s.qty * COALESCE((
              SELECT m2.unit_price_cents
              FROM consignment_movements m2
              WHERE m2.partner_id = s.partner_id
                AND m2.product_id = s.product_id
                AND m2.variation = s.variation COLLATE NOCASE
              ORDER BY m2.movement_date DESC, m2.id DESC
              LIMIT 1
            ), 0)
          ), 0)
          FROM stock s WHERE s.qty > 0
        ) AS current_value_cents,
        (
          SELECT COUNT(*) FROM stock s
          JOIN club_partners p ON p.id = s.partner_id
          WHERE p.active = 1 AND p.consignment_enabled = 1
            AND s.qty >= 0
            AND s.qty <= COALESCE((
              SELECT ci.low_stock_threshold
              FROM consignment_items ci
              JOIN consignments c ON c.id = ci.consignment_id
              WHERE c.partner_id = s.partner_id
                AND ci.product_id = s.product_id
                AND ci.variation = s.variation COLLATE NOCASE
              ORDER BY ci.id DESC LIMIT 1
            ), p.consignment_low_stock_threshold, 1)
            AND EXISTS (
              SELECT 1 FROM consignment_movements mx
              WHERE mx.partner_id = s.partner_id AND mx.product_id = s.product_id
                AND mx.variation = s.variation COLLATE NOCASE
                AND mx.movement_type IN ('ENVIADO','REPOSICAO')
            )
        ) AS low_stock_count
    `).first(),
    env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN movement_type = 'VENDA' AND movement_status = 'ATIVA' AND movement_date BETWEEN ? AND ? THEN gross_amount_cents ELSE 0 END), 0) AS sales_cents,
        COALESCE(SUM(CASE WHEN movement_type = 'VENDA' AND movement_status = 'ATIVA' AND commission_status = 'PENDENTE' THEN commission_amount_cents ELSE 0 END), 0) AS pending_commission_cents,
        COALESCE(SUM(CASE WHEN movement_type = 'VENDA' AND movement_status = 'ATIVA' AND movement_date BETWEEN ? AND ? THEN dogfit_net_cents ELSE 0 END), 0) AS dogfit_net_cents
      FROM consignment_movements
    `).bind(from, to, from, to).first(),
    env.DB.prepare(`
      WITH stock AS (
        SELECT partner_id, product_id, variation, SUM(stock_delta) AS qty
        FROM consignment_movements
        GROUP BY partner_id, product_id, variation
      )
      SELECT s.partner_id, p.name AS partner_name, s.product_id,
        COALESCE(pr.name, (
          SELECT mx.product_name_snapshot FROM consignment_movements mx
          WHERE mx.partner_id=s.partner_id AND mx.product_id=s.product_id
            AND mx.variation=s.variation COLLATE NOCASE
          ORDER BY mx.id DESC LIMIT 1
        )) AS product_name,
        s.variation, s.qty AS stock,
        COALESCE((
          SELECT ci.low_stock_threshold
          FROM consignment_items ci JOIN consignments c ON c.id=ci.consignment_id
          WHERE c.partner_id=s.partner_id AND ci.product_id=s.product_id
            AND ci.variation=s.variation COLLATE NOCASE
          ORDER BY ci.id DESC LIMIT 1
        ), p.consignment_low_stock_threshold, 1) AS threshold
      FROM stock s
      JOIN club_partners p ON p.id=s.partner_id
      LEFT JOIN products pr ON pr.id=s.product_id
      WHERE p.active = 1 AND p.consignment_enabled = 1
        AND s.qty >= 0
        AND s.qty <= COALESCE((
          SELECT ci.low_stock_threshold
          FROM consignment_items ci JOIN consignments c ON c.id=ci.consignment_id
          WHERE c.partner_id=s.partner_id AND ci.product_id=s.product_id
            AND ci.variation=s.variation COLLATE NOCASE
          ORDER BY ci.id DESC LIMIT 1
        ), p.consignment_low_stock_threshold, 1)
        AND EXISTS (
          SELECT 1 FROM consignment_movements mx
          WHERE mx.partner_id=s.partner_id AND mx.product_id=s.product_id
            AND mx.variation=s.variation COLLATE NOCASE
            AND mx.movement_type IN ('ENVIADO','REPOSICAO')
        )
      ORDER BY s.qty ASC, p.name COLLATE NOCASE, product_name COLLATE NOCASE
      LIMIT 50
    `).all()
  ]);

  return json({
    period: { from, to },
    active_partners: Number(summary?.active_partners || 0),
    total_units: Number(summary?.total_units || 0),
    current_value_cents: Number(summary?.current_value_cents || 0),
    sales_cents: Number(sales?.sales_cents || 0),
    pending_commission_cents: Number(sales?.pending_commission_cents || 0),
    dogfit_net_cents: Number(sales?.dogfit_net_cents || 0),
    low_stock_count: Number(summary?.low_stock_count || 0),
    alerts: alerts.results
  });
}

function buildStockFilters(url) {
  const values = [];
  const clauses = [];
  const partnerId = Number(url.searchParams.get("partner_id") || 0);
  const productId = Number(url.searchParams.get("product_id") || 0);
  if (Number.isInteger(partnerId) && partnerId > 0) { clauses.push("m.partner_id = ?"); values.push(partnerId); }
  if (Number.isInteger(productId) && productId > 0) { clauses.push("m.product_id = ?"); values.push(productId); }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

async function stock(request, env) {
  const url = new URL(request.url);
  const { where, values } = buildStockFilters(url);
  const search = clean(url.searchParams.get("q"), 120).toLowerCase();

  const { results } = await env.DB.prepare(`
    WITH grouped AS (
      SELECT m.partner_id, m.product_id, m.variation,
        SUM(m.stock_delta) AS stock,
        SUM(CASE WHEN m.movement_type='ENVIADO' THEN m.quantity ELSE 0 END) AS sent,
        SUM(CASE WHEN m.movement_type='REPOSICAO' THEN m.quantity ELSE 0 END) AS restocked,
        SUM(CASE WHEN m.movement_type='DEVOLUCAO' THEN m.quantity ELSE 0 END) AS returned,
        SUM(CASE WHEN m.movement_type='VENDA' AND m.movement_status='ATIVA' THEN m.quantity ELSE 0 END) AS sold,
        MAX(m.id) AS latest_id
      FROM consignment_movements m
      ${where}
      GROUP BY m.partner_id, m.product_id, m.variation
    )
    SELECT g.*, p.name AS partner_name, p.active AS partner_active,
      p.consignment_commission_bps AS partner_commission_bps,
      p.consignment_low_stock_threshold AS partner_threshold,
      pr.name AS current_product_name, pr.active AS product_active,
      COALESCE((SELECT mx.product_name_snapshot FROM consignment_movements mx WHERE mx.id=g.latest_id), pr.name, 'Produto') AS product_name,
      COALESCE((SELECT mx.unit_price_cents FROM consignment_movements mx WHERE mx.id=g.latest_id), 0) AS unit_price_cents,
      COALESCE((SELECT mx.commission_bps_snapshot FROM consignment_movements mx WHERE mx.id=g.latest_id), p.consignment_commission_bps, 3000) AS commission_bps,
      COALESCE((
        SELECT ci.low_stock_threshold
        FROM consignment_items ci JOIN consignments c ON c.id=ci.consignment_id
        WHERE c.partner_id=g.partner_id AND ci.product_id=g.product_id AND ci.variation=g.variation COLLATE NOCASE
        ORDER BY ci.id DESC LIMIT 1
      ), p.consignment_low_stock_threshold, 1) AS low_stock_threshold
    FROM grouped g
    JOIN club_partners p ON p.id=g.partner_id
    LEFT JOIN products pr ON pr.id=g.product_id
    ORDER BY p.name COLLATE NOCASE, product_name COLLATE NOCASE, g.variation COLLATE NOCASE
  `).bind(...values).all();

  const filtered = search
    ? results.filter(item => `${item.partner_name} ${item.product_name} ${item.variation}`.toLowerCase().includes(search))
    : results;
  return json(filtered);
}

async function remittances(request, env) {
  const url = new URL(request.url);
  const partnerId = Number(url.searchParams.get("partner_id") || 0);
  const status = clean(url.searchParams.get("status"), 20).toUpperCase();
  const from = isoDate(url.searchParams.get("from"));
  const to = isoDate(url.searchParams.get("to"));
  const q = clean(url.searchParams.get("q"), 120);

  const clauses = ["1=1"];
  const values = [];
  if (partnerId > 0) { clauses.push("c.partner_id = ?"); values.push(partnerId); }
  if (["ATIVA", "ENCERRADA", "CANCELADA"].includes(status)) { clauses.push("c.status = ?"); values.push(status); }
  if (from) { clauses.push("c.shipment_date >= ?"); values.push(from); }
  if (to) { clauses.push("c.shipment_date <= ?"); values.push(to); }
  if (q) { clauses.push("(c.code LIKE ? OR c.partner_name_snapshot LIKE ?)"); values.push(`%${q}%`, `%${q}%`); }

  const { results } = await env.DB.prepare(`
    SELECT c.*,
      COUNT(ci.id) AS item_lines,
      COALESCE(SUM(ci.quantity_sent), 0) AS total_units,
      COALESCE(SUM(ci.quantity_sent * ci.unit_price_cents), 0) AS total_value_cents
    FROM consignments c
    LEFT JOIN consignment_items ci ON ci.consignment_id = c.id
    WHERE ${clauses.join(" AND ")}
    GROUP BY c.id
    ORDER BY c.shipment_date DESC, c.id DESC
    LIMIT 300
  `).bind(...values).all();
  return json(results);
}

async function remittanceDetail(env, id) {
  const consignment = await env.DB.prepare(`
    SELECT c.*, p.name AS current_partner_name, p.active AS partner_active,
      p.responsible_name, p.phone, p.address,
      s.code AS referral_code
    FROM consignments c
    JOIN club_partners p ON p.id = c.partner_id
    LEFT JOIN partner_referral_settings s ON s.partner_id = p.id
    WHERE c.id = ? LIMIT 1
  `).bind(id).first();
  if (!consignment) return null;
  const { results: items } = await env.DB.prepare(`
    SELECT ci.*, pr.name AS current_product_name, pr.active AS product_active
    FROM consignment_items ci
    LEFT JOIN products pr ON pr.id = ci.product_id
    WHERE ci.consignment_id = ?
    ORDER BY ci.id
  `).bind(id).all();
  return { ...consignment, items };
}

async function createRemittance(request, env) {
  const data = await readBody(request);
  const partnerId = positiveInt(data.partner_id);
  const shipmentDate = isoDate(data.shipment_date, today());
  const items = Array.isArray(data.items) ? data.items.slice(0, 100) : [];
  if (!partnerId) return badRequest("Selecione um parceiro válido.");
  if (!items.length) return badRequest("Adicione pelo menos um produto à remessa.");

  const partner = await partnerById(env, partnerId, true);
  if (!partner) return badRequest("Parceiro não encontrado ou inativo.");

  const normalized = [];
  const seen = new Set();
  for (const raw of items) {
    const productId = positiveInt(raw.product_id);
    const variation = cleanVariation(raw.variation);
    const quantity = positiveInt(raw.quantity);
    if (!productId || !quantity) return badRequest("Produto e quantidade são obrigatórios em todos os itens.");
    const key = `${productId}|${variation}`;
    if (seen.has(key)) return badRequest("O mesmo produto/variação não pode aparecer duas vezes na mesma remessa.");
    seen.add(key);

    const product = await productById(env, productId, true);
    if (!product) return badRequest("Um dos produtos selecionados não existe ou está inativo.");
    const fallbackPrice = Math.max(0, Math.round(Number(product.price || 0) * 100));
    const unitPriceCents = nonNegativeInt(raw.unit_price_cents, fallbackPrice);
    const commissionBps = bps(raw.commission_bps, Number(partner.consignment_commission_bps ?? 3000));
    const threshold = nonNegativeInt(raw.low_stock_threshold, Number(partner.consignment_low_stock_threshold ?? 1));
    normalized.push({
      productId,
      productName: clean(product.name, 180),
      variation,
      quantity,
      unitPriceCents,
      commissionBps,
      threshold,
      notes: clean(raw.notes, 500)
    });
  }

  const tempCode = `TMP-${crypto.randomUUID()}`;
  const result = await env.DB.prepare(`
    INSERT INTO consignments (code, partner_id, partner_name_snapshot, shipment_date, notes, created_by)
    VALUES (?, ?, ?, ?, ?, 'admin')
  `).bind(tempCode, partnerId, clean(partner.name, 180), shipmentDate, clean(data.notes, 1000)).run();
  const consignmentId = Number(result.meta.last_row_id);
  const code = `CON-${shipmentDate.slice(0, 4)}-${String(consignmentId).padStart(4, "0")}`;

  const statements = [
    env.DB.prepare("UPDATE consignments SET code = ?, updated_at = datetime('now') WHERE id = ?").bind(code, consignmentId),
    env.DB.prepare("UPDATE club_partners SET consignment_enabled = 1, updated_at = datetime('now') WHERE id = ?").bind(partnerId)
  ];
  for (const item of normalized) {
    statements.push(env.DB.prepare(`
      INSERT INTO consignment_items (
        consignment_id, product_id, product_name_snapshot, variation, quantity_sent,
        unit_price_cents, commission_bps, low_stock_threshold, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      consignmentId, item.productId, item.productName, item.variation, item.quantity,
      item.unitPriceCents, item.commissionBps, item.threshold, item.notes
    ));
    statements.push(env.DB.prepare(`
      INSERT INTO consignment_movements (
        partner_id, consignment_id, product_id, product_name_snapshot, variation,
        movement_type, quantity, stock_delta, movement_date, unit_price_cents,
        commission_bps_snapshot, commission_status, responsible_user, notes
      ) VALUES (?, ?, ?, ?, ?, 'ENVIADO', ?, ?, ?, ?, ?, 'NAO_APLICA', 'admin', ?)
    `).bind(
      partnerId, consignmentId, item.productId, item.productName, item.variation,
      item.quantity, item.quantity, shipmentDate, item.unitPriceCents,
      item.commissionBps, item.notes
    ));
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    // Se a segunda etapa falhar, a remessa temporária é removida porque ainda não há histórico válido.
    try { await env.DB.prepare("DELETE FROM consignments WHERE id = ? AND code LIKE 'TMP-%'").bind(consignmentId).run(); } catch {}
    throw error;
  }

  return json(await remittanceDetail(env, consignmentId), 201);
}

async function registerSale(request, env) {
  const data = await readBody(request);
  const partnerId = positiveInt(data.partner_id);
  const productId = positiveInt(data.product_id);
  const quantity = positiveInt(data.quantity);
  const variation = cleanVariation(data.variation);
  const movementDate = isoDate(data.movement_date, today());
  if (!partnerId || !productId || !quantity) return badRequest("Parceiro, produto e quantidade são obrigatórios.");

  const [partner, product, terms] = await Promise.all([
    partnerById(env, partnerId), productById(env, productId), latestTerms(env, partnerId, productId, variation)
  ]);
  if (!partner || !product || !terms) return notFound("Parceiro ou produto não encontrado.");
  if (!Number(partner.active)) return responseError("O parceiro está inativo. Reative-o antes de registrar novas vendas.", 409);

  const defaultTotal = terms.unitPriceCents * quantity;
  const grossCents = nonNegativeInt(data.gross_amount_cents, defaultTotal);
  if (grossCents == null) return badRequest("Informe um valor de venda válido.");
  const commissionBps = bps(data.commission_bps, terms.commissionBps);
  const commissionCents = Math.round((grossCents * commissionBps) / 10000);
  const dogfitNetCents = grossCents - commissionCents;

  // A própria gravação verifica o saldo para evitar que dois lançamentos simultâneos
  // deixem o estoque do parceiro negativo.
  const result = await env.DB.prepare(`
    INSERT INTO consignment_movements (
      partner_id, product_id, product_name_snapshot, variation, movement_type,
      quantity, stock_delta, movement_date, unit_price_cents, gross_amount_cents,
      commission_bps_snapshot, commission_amount_cents, dogfit_net_cents,
      commission_status, movement_status, responsible_user, notes
    )
    SELECT ?, ?, ?, ?, 'VENDA', ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE', 'ATIVA', 'admin', ?
    WHERE (
      SELECT COALESCE(SUM(stock_delta), 0)
      FROM consignment_movements
      WHERE partner_id = ? AND product_id = ? AND variation = ? COLLATE NOCASE
    ) >= ?
  `).bind(
    partnerId, productId, clean(product.name, 180), variation, quantity, -quantity,
    movementDate, terms.unitPriceCents, grossCents, commissionBps, commissionCents,
    dogfitNetCents, clean(data.notes, 1000),
    partnerId, productId, variation, quantity
  ).run();

  if (!Number(result.meta?.changes || 0)) {
    const stockQty = await currentStock(env, partnerId, productId, variation);
    return responseError(`Estoque insuficiente. Disponível no parceiro: ${stockQty}.`, 409);
  }
  return json(await movementDetail(env, Number(result.meta.last_row_id)), 201);
}

async function registerRestock(request, env) {
  const data = await readBody(request);
  const partnerId = positiveInt(data.partner_id);
  const productId = positiveInt(data.product_id);
  const quantity = positiveInt(data.quantity);
  const variation = cleanVariation(data.variation);
  const movementDate = isoDate(data.movement_date, today());
  if (!partnerId || !productId || !quantity) return badRequest("Parceiro, produto e quantidade são obrigatórios.");
  const [partner, product, terms] = await Promise.all([partnerById(env, partnerId, true), productById(env, productId), latestTerms(env, partnerId, productId, variation)]);
  if (!partner) return badRequest("Parceiro não encontrado ou inativo.");
  if (!product || !terms) return notFound("Produto não encontrado.");

  const result = await env.DB.prepare(`
    INSERT INTO consignment_movements (
      partner_id, product_id, product_name_snapshot, variation, movement_type,
      quantity, stock_delta, movement_date, unit_price_cents,
      commission_bps_snapshot, commission_status, responsible_user, notes
    ) VALUES (?, ?, ?, ?, 'REPOSICAO', ?, ?, ?, ?, ?, 'NAO_APLICA', 'admin', ?)
  `).bind(
    partnerId, productId, clean(product.name, 180), variation, quantity, quantity,
    movementDate, terms.unitPriceCents, terms.commissionBps, clean(data.notes, 1000)
  ).run();
  return json(await movementDetail(env, Number(result.meta.last_row_id)), 201);
}

async function registerReturn(request, env) {
  const data = await readBody(request);
  const partnerId = positiveInt(data.partner_id);
  const productId = positiveInt(data.product_id);
  const quantity = positiveInt(data.quantity);
  const variation = cleanVariation(data.variation);
  const movementDate = isoDate(data.movement_date, today());
  if (!partnerId || !productId || !quantity) return badRequest("Parceiro, produto e quantidade são obrigatórios.");
  const [product, terms] = await Promise.all([productById(env, productId), latestTerms(env, partnerId, productId, variation)]);
  if (!product || !terms) return notFound("Produto não encontrado.");

  const reason = clean(data.reason || data.notes, 1000);
  const result = await env.DB.prepare(`
    INSERT INTO consignment_movements (
      partner_id, product_id, product_name_snapshot, variation, movement_type,
      quantity, stock_delta, movement_date, unit_price_cents,
      commission_bps_snapshot, commission_status, responsible_user, notes
    )
    SELECT ?, ?, ?, ?, 'DEVOLUCAO', ?, ?, ?, ?, ?, 'NAO_APLICA', 'admin', ?
    WHERE (
      SELECT COALESCE(SUM(stock_delta), 0)
      FROM consignment_movements
      WHERE partner_id = ? AND product_id = ? AND variation = ? COLLATE NOCASE
    ) >= ?
  `).bind(
    partnerId, productId, clean(product.name, 180), variation, quantity, -quantity,
    movementDate, terms.unitPriceCents, terms.commissionBps, reason,
    partnerId, productId, variation, quantity
  ).run();
  if (!Number(result.meta?.changes || 0)) {
    const stockQty = await currentStock(env, partnerId, productId, variation);
    return responseError(`Não é possível devolver ${quantity}. Estoque disponível no parceiro: ${stockQty}.`, 409);
  }
  return json(await movementDetail(env, Number(result.meta.last_row_id)), 201);
}

async function registerAdjustment(request, env) {
  const data = await readBody(request);
  const partnerId = positiveInt(data.partner_id);
  const productId = positiveInt(data.product_id);
  const delta = Number(data.stock_delta);
  const variation = cleanVariation(data.variation);
  const movementDate = isoDate(data.movement_date, today());
  if (!partnerId || !productId || !Number.isInteger(delta) || delta === 0) return badRequest("Parceiro, produto e ajuste diferente de zero são obrigatórios.");
  const [product, terms] = await Promise.all([productById(env, productId), latestTerms(env, partnerId, productId, variation)]);
  if (!product || !terms) return notFound("Produto não encontrado.");
  const notes = clean(data.notes, 1000);
  if (!notes) return badRequest("Informe o motivo do ajuste.");

  let result;
  if (delta < 0) {
    result = await env.DB.prepare(`
      INSERT INTO consignment_movements (
        partner_id, product_id, product_name_snapshot, variation, movement_type,
        quantity, stock_delta, movement_date, unit_price_cents,
        commission_bps_snapshot, commission_status, responsible_user, notes
      )
      SELECT ?, ?, ?, ?, 'AJUSTE', ?, ?, ?, ?, ?, 'NAO_APLICA', 'admin', ?
      WHERE (
        SELECT COALESCE(SUM(stock_delta), 0)
        FROM consignment_movements
        WHERE partner_id = ? AND product_id = ? AND variation = ? COLLATE NOCASE
      ) >= ?
    `).bind(
      partnerId, productId, clean(product.name, 180), variation, Math.abs(delta), delta,
      movementDate, terms.unitPriceCents, terms.commissionBps, notes,
      partnerId, productId, variation, Math.abs(delta)
    ).run();
    if (!Number(result.meta?.changes || 0)) {
      const stockQty = await currentStock(env, partnerId, productId, variation);
      return responseError(`O ajuste deixaria o estoque negativo. Disponível atualmente: ${stockQty}.`, 409);
    }
  } else {
    result = await env.DB.prepare(`
      INSERT INTO consignment_movements (
        partner_id, product_id, product_name_snapshot, variation, movement_type,
        quantity, stock_delta, movement_date, unit_price_cents,
        commission_bps_snapshot, commission_status, responsible_user, notes
      ) VALUES (?, ?, ?, ?, 'AJUSTE', ?, ?, ?, ?, ?, 'NAO_APLICA', 'admin', ?)
    `).bind(
      partnerId, productId, clean(product.name, 180), variation, delta, delta,
      movementDate, terms.unitPriceCents, terms.commissionBps, notes
    ).run();
  }
  return json(await movementDetail(env, Number(result.meta.last_row_id)), 201);
}

async function movementDetail(env, id) {
  return env.DB.prepare(`
    SELECT m.*, p.name AS partner_name, pr.name AS current_product_name,
      s.code AS settlement_code, s.status AS settlement_status
    FROM consignment_movements m
    JOIN club_partners p ON p.id = m.partner_id
    LEFT JOIN products pr ON pr.id = m.product_id
    LEFT JOIN consignment_settlements s ON s.id = m.settlement_id
    WHERE m.id = ? LIMIT 1
  `).bind(id).first();
}

async function reverseSale(env, id, request) {
  const data = await readBody(request);
  const sale = await movementDetail(env, id);
  if (!sale || sale.movement_type !== "VENDA") return notFound("Venda não encontrada.");
  if (sale.movement_status !== "ATIVA") return responseError("Esta venda já foi estornada ou cancelada.", 409);
  if (sale.settlement_id && sale.settlement_status !== "CANCELADO") {
    return responseError("Esta venda já faz parte de um fechamento. Cancele o fechamento pendente antes de estornar a venda.", 409);
  }
  const movementDate = isoDate(data.movement_date, today());
  const note = clean(data.notes || "Estorno de venda", 1000);

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE consignment_movements
      SET movement_status='ESTORNADA', commission_status='CANCELADA', updated_at=datetime('now')
      WHERE id = ? AND movement_status='ATIVA'
    `).bind(id),
    env.DB.prepare(`
      INSERT INTO consignment_movements (
        partner_id, product_id, product_name_snapshot, variation, movement_type,
        quantity, stock_delta, movement_date, unit_price_cents,
        commission_bps_snapshot, commission_status, movement_status,
        reversal_of_movement_id, responsible_user, notes
      ) VALUES (?, ?, ?, ?, 'ESTORNO_VENDA', ?, ?, ?, ?, ?, 'NAO_APLICA', 'ATIVA', ?, 'admin', ?)
    `).bind(
      sale.partner_id, sale.product_id, sale.product_name_snapshot, sale.variation,
      sale.quantity, sale.quantity, movementDate, sale.unit_price_cents,
      sale.commission_bps_snapshot, id, note
    )
  ]);
  return json({ ok: true, sale: await movementDetail(env, id) });
}

async function movements(request, env) {
  const url = new URL(request.url);
  const clauses = ["1=1"];
  const values = [];
  const partnerId = Number(url.searchParams.get("partner_id") || 0);
  const productId = Number(url.searchParams.get("product_id") || 0);
  const type = clean(url.searchParams.get("type"), 30).toUpperCase();
  const from = isoDate(url.searchParams.get("from"));
  const to = isoDate(url.searchParams.get("to"));
  if (partnerId > 0) { clauses.push("m.partner_id = ?"); values.push(partnerId); }
  if (productId > 0) { clauses.push("m.product_id = ?"); values.push(productId); }
  if (["ENVIADO","VENDA","REPOSICAO","DEVOLUCAO","AJUSTE","ESTORNO_VENDA"].includes(type)) { clauses.push("m.movement_type = ?"); values.push(type); }
  if (from) { clauses.push("m.movement_date >= ?"); values.push(from); }
  if (to) { clauses.push("m.movement_date <= ?"); values.push(to); }

  const { results } = await env.DB.prepare(`
    SELECT m.*, p.name AS partner_name,
      COALESCE(pr.name, m.product_name_snapshot) AS product_name,
      s.code AS settlement_code, s.status AS settlement_status
    FROM consignment_movements m
    JOIN club_partners p ON p.id=m.partner_id
    LEFT JOIN products pr ON pr.id=m.product_id
    LEFT JOIN consignment_settlements s ON s.id=m.settlement_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY m.movement_date DESC, m.id DESC
    LIMIT 1000
  `).bind(...values).all();
  return json(results);
}

async function commissionSummary(request, env) {
  const url = new URL(request.url);
  const partnerId = Number(url.searchParams.get("partner_id") || 0);
  const from = isoDate(url.searchParams.get("from"), firstDayOfMonth());
  const to = isoDate(url.searchParams.get("to"), today());
  const partnerClause = partnerId > 0 ? "AND m.partner_id = ?" : "";
  const params = partnerId > 0 ? [from, to, partnerId] : [from, to];

  const { results } = await env.DB.prepare(`
    SELECT m.partner_id, p.name AS partner_name,
      COUNT(*) AS sales_count,
      COALESCE(SUM(m.quantity), 0) AS units_sold,
      COALESCE(SUM(m.gross_amount_cents), 0) AS gross_sales_cents,
      COALESCE(SUM(m.commission_amount_cents), 0) AS total_commission_cents,
      COALESCE(SUM(CASE WHEN m.commission_status='PENDENTE' THEN m.commission_amount_cents ELSE 0 END), 0) AS pending_commission_cents,
      COALESCE(SUM(CASE WHEN m.commission_status='PAGO' THEN m.commission_amount_cents ELSE 0 END), 0) AS paid_commission_cents,
      COALESCE(SUM(m.dogfit_net_cents), 0) AS dogfit_net_cents,
      CASE WHEN SUM(m.gross_amount_cents) > 0
        THEN ROUND(SUM(m.commission_amount_cents) * 10000.0 / SUM(m.gross_amount_cents))
        ELSE 0 END AS effective_commission_bps
    FROM consignment_movements m
    JOIN club_partners p ON p.id=m.partner_id
    WHERE m.movement_type='VENDA' AND m.movement_status='ATIVA'
      AND m.movement_date BETWEEN ? AND ? ${partnerClause}
    GROUP BY m.partner_id, p.name
    ORDER BY p.name COLLATE NOCASE
  `).bind(...params).all();
  return json({ period: { from, to }, results });
}

async function settlements(request, env) {
  const url = new URL(request.url);
  const clauses = ["1=1"];
  const values = [];
  const partnerId = Number(url.searchParams.get("partner_id") || 0);
  const status = clean(url.searchParams.get("status"), 20).toUpperCase();
  const from = isoDate(url.searchParams.get("from"));
  const to = isoDate(url.searchParams.get("to"));
  if (partnerId > 0) { clauses.push("s.partner_id = ?"); values.push(partnerId); }
  if (["PENDENTE","PAGO","CANCELADO"].includes(status)) { clauses.push("s.status = ?"); values.push(status); }
  if (from) { clauses.push("s.period_end >= ?"); values.push(from); }
  if (to) { clauses.push("s.period_start <= ?"); values.push(to); }

  const { results } = await env.DB.prepare(`
    SELECT s.*, p.name AS current_partner_name,
      (SELECT COUNT(*) FROM consignment_movements m WHERE m.settlement_id=s.id AND m.movement_type='VENDA') AS sales_count
    FROM consignment_settlements s
    JOIN club_partners p ON p.id=s.partner_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT 500
  `).bind(...values).all();
  return json(results);
}

async function generateSettlement(request, env) {
  const data = await readBody(request);
  const partnerId = positiveInt(data.partner_id);
  const periodStart = isoDate(data.period_start);
  const periodEnd = isoDate(data.period_end);
  if (!partnerId || !periodStart || !periodEnd) return badRequest("Parceiro e período são obrigatórios.");
  if (periodStart > periodEnd) return badRequest("A data inicial não pode ser posterior à data final.");
  const partner = await partnerById(env, partnerId);
  if (!partner) return notFound("Parceiro não encontrado.");

  const pendingExisting = await env.DB.prepare(`
    SELECT id, code FROM consignment_settlements
    WHERE partner_id=? AND status='PENDENTE'
      AND NOT (period_end < ? OR period_start > ?)
    LIMIT 1
  `).bind(partnerId, periodStart, periodEnd).first();
  if (pendingExisting) return responseError(`Já existe um fechamento pendente (${pendingExisting.code}) sobre esse período.`, 409);

  const { results: sales } = await env.DB.prepare(`
    SELECT id, gross_amount_cents, commission_amount_cents, dogfit_net_cents
    FROM consignment_movements
    WHERE partner_id=? AND movement_type='VENDA' AND movement_status='ATIVA'
      AND commission_status='PENDENTE' AND settlement_id IS NULL
      AND movement_date BETWEEN ? AND ?
    ORDER BY id
  `).bind(partnerId, periodStart, periodEnd).all();
  if (!sales.length) return responseError("Não há comissões pendentes sem fechamento para esse parceiro e período.", 409);

  const gross = sales.reduce((sum, item) => sum + Number(item.gross_amount_cents || 0), 0);
  const commission = sales.reduce((sum, item) => sum + Number(item.commission_amount_cents || 0), 0);
  const net = sales.reduce((sum, item) => sum + Number(item.dogfit_net_cents || 0), 0);
  const tempCode = `TMP-FECH-${crypto.randomUUID()}`;
  const result = await env.DB.prepare(`
    INSERT INTO consignment_settlements (
      code, partner_id, partner_name_snapshot, period_start, period_end,
      gross_sales_cents, commission_cents, dogfit_net_cents, status, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE', ?, 'admin')
  `).bind(tempCode, partnerId, clean(partner.name, 180), periodStart, periodEnd, gross, commission, net, clean(data.notes, 1000)).run();
  const id = Number(result.meta.last_row_id);
  const code = `FEC-${periodEnd.slice(0,4)}-${String(id).padStart(4,"0")}`;

  const statements = [env.DB.prepare("UPDATE consignment_settlements SET code=?, updated_at=datetime('now') WHERE id=?").bind(code, id)];
  for (const sale of sales) {
    statements.push(env.DB.prepare(`
      UPDATE consignment_movements SET settlement_id=?, updated_at=datetime('now')
      WHERE id=? AND settlement_id IS NULL AND commission_status='PENDENTE'
    `).bind(id, sale.id));
  }
  await env.DB.batch(statements);
  return json(await settlementDetail(env, id), 201);
}

async function settlementDetail(env, id) {
  const settlement = await env.DB.prepare(`
    SELECT s.*, p.name AS current_partner_name
    FROM consignment_settlements s JOIN club_partners p ON p.id=s.partner_id
    WHERE s.id=? LIMIT 1
  `).bind(id).first();
  if (!settlement) return null;
  const { results: sales } = await env.DB.prepare(`
    SELECT id, product_name_snapshot, variation, quantity, movement_date,
      gross_amount_cents, commission_amount_cents, dogfit_net_cents, commission_status
    FROM consignment_movements
    WHERE settlement_id=? AND movement_type='VENDA'
    ORDER BY movement_date, id
  `).bind(id).all();
  return { ...settlement, sales };
}

async function paySettlement(request, env, id) {
  const data = await readBody(request);
  const settlement = await settlementDetail(env, id);
  if (!settlement) return notFound("Fechamento não encontrado.");
  if (settlement.status === "PAGO") return json(settlement);
  if (settlement.status !== "PENDENTE") return responseError("Somente fechamentos pendentes podem ser pagos.", 409);
  const paidOn = isoDate(data.paid_on, today());
  const paidAt = `${paidOn} 12:00:00`;
  const notes = clean(data.notes, 1000);

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE consignment_settlements
      SET status='PAGO', paid_at=?, notes=CASE WHEN ?='' THEN notes ELSE ? END, updated_at=datetime('now')
      WHERE id=? AND status='PENDENTE'
    `).bind(paidAt, notes, notes, id),
    env.DB.prepare(`
      UPDATE consignment_movements
      SET commission_status='PAGO', updated_at=datetime('now')
      WHERE settlement_id=? AND movement_type='VENDA' AND movement_status='ATIVA' AND commission_status='PENDENTE'
    `).bind(id)
  ]);
  return json(await settlementDetail(env, id));
}

async function cancelSettlement(request, env, id) {
  const data = await readBody(request);
  const settlement = await settlementDetail(env, id);
  if (!settlement) return notFound("Fechamento não encontrado.");
  if (settlement.status === "PAGO") return responseError("Um fechamento já pago não pode ser cancelado pelo painel. Registre um ajuste financeiro separado.", 409);
  if (settlement.status === "CANCELADO") return json(settlement);
  const reason = clean(data.notes, 1000);
  if (!reason) return badRequest("Informe o motivo do cancelamento do fechamento.");

  await env.DB.batch([
    env.DB.prepare(`UPDATE consignment_settlements SET status='CANCELADO', notes=?, updated_at=datetime('now') WHERE id=? AND status='PENDENTE'`).bind(reason, id),
    env.DB.prepare(`UPDATE consignment_movements SET settlement_id=NULL, updated_at=datetime('now') WHERE settlement_id=? AND commission_status='PENDENTE'`).bind(id)
  ]);
  return json(await settlementDetail(env, id));
}

async function updatePartnerSettings(request, env, id) {
  const data = await readBody(request);
  const partner = await partnerById(env, id);
  if (!partner) return notFound("Parceiro não encontrado.");
  const commissionBps = bps(data.consignment_commission_bps, Number(partner.consignment_commission_bps ?? 3000));
  const threshold = nonNegativeInt(data.consignment_low_stock_threshold, Number(partner.consignment_low_stock_threshold ?? 1));
  await env.DB.prepare(`
    UPDATE club_partners
    SET responsible_name=?, consignment_enabled=?, consignment_commission_bps=?,
      consignment_low_stock_threshold=?, consignment_notes=?, updated_at=datetime('now')
    WHERE id=?
  `).bind(
    clean(data.responsible_name, 160), data.consignment_enabled === false ? 0 : 1,
    commissionBps, threshold, clean(data.consignment_notes, 1000), id
  ).run();
  return json(await partnerById(env, id));
}

async function partnerOverview(env, id) {
  const partner = await partnerById(env, id);
  if (!partner) return null;
  const [stockRows, financial, movementsRows, settlementsRows] = await Promise.all([
    env.DB.prepare(`
      WITH g AS (
        SELECT product_id, variation,
          SUM(stock_delta) AS stock,
          SUM(CASE WHEN movement_type='ENVIADO' THEN quantity ELSE 0 END) AS sent,
          SUM(CASE WHEN movement_type='REPOSICAO' THEN quantity ELSE 0 END) AS restocked,
          SUM(CASE WHEN movement_type='VENDA' AND movement_status='ATIVA' THEN quantity ELSE 0 END) AS sold,
          SUM(CASE WHEN movement_type='DEVOLUCAO' THEN quantity ELSE 0 END) AS returned,
          MAX(id) AS latest_id
        FROM consignment_movements WHERE partner_id=? GROUP BY product_id, variation
      )
      SELECT g.*, COALESCE(pr.name,(SELECT product_name_snapshot FROM consignment_movements WHERE id=g.latest_id)) AS product_name,
        COALESCE((SELECT unit_price_cents FROM consignment_movements WHERE id=g.latest_id),0) AS unit_price_cents,
        COALESCE((SELECT commission_bps_snapshot FROM consignment_movements WHERE id=g.latest_id),?) AS commission_bps
      FROM g LEFT JOIN products pr ON pr.id=g.product_id
      ORDER BY product_name COLLATE NOCASE, variation COLLATE NOCASE
    `).bind(id, Number(partner.consignment_commission_bps ?? 3000)).all(),
    env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN movement_type='VENDA' AND movement_status='ATIVA' THEN gross_amount_cents ELSE 0 END),0) AS sold_cents,
        COALESCE(SUM(CASE WHEN movement_type='VENDA' AND movement_status='ATIVA' THEN commission_amount_cents ELSE 0 END),0) AS commission_total_cents,
        COALESCE(SUM(CASE WHEN movement_type='VENDA' AND movement_status='ATIVA' AND commission_status='PAGO' THEN commission_amount_cents ELSE 0 END),0) AS commission_paid_cents,
        COALESCE(SUM(CASE WHEN movement_type='VENDA' AND movement_status='ATIVA' AND commission_status='PENDENTE' THEN commission_amount_cents ELSE 0 END),0) AS commission_pending_cents,
        COALESCE(SUM(CASE WHEN movement_type='VENDA' AND movement_status='ATIVA' THEN dogfit_net_cents ELSE 0 END),0) AS dogfit_net_cents
      FROM consignment_movements WHERE partner_id=?
    `).bind(id).first(),
    env.DB.prepare(`
      SELECT m.*, COALESCE(pr.name,m.product_name_snapshot) AS product_name
      FROM consignment_movements m LEFT JOIN products pr ON pr.id=m.product_id
      WHERE m.partner_id=? ORDER BY m.movement_date DESC,m.id DESC LIMIT 80
    `).bind(id).all(),
    env.DB.prepare(`SELECT * FROM consignment_settlements WHERE partner_id=? ORDER BY created_at DESC,id DESC LIMIT 30`).bind(id).all()
  ]);
  return { partner, stock: stockRows.results, financial, movements: movementsRows.results, settlements: settlementsRows.results };
}

export async function handleAdminConsignments({ request, env, path, method }) {
  if (path === "/api/admin/consignments/meta" && method === "GET") return meta(env);
  if (path === "/api/admin/consignments/dashboard" && method === "GET") return dashboard(request, env);
  if (path === "/api/admin/consignments/stock" && method === "GET") return stock(request, env);

  if (path === "/api/admin/consignments/remittances") {
    if (method === "GET") return remittances(request, env);
    if (method === "POST") return createRemittance(request, env);
  }
  const remittanceMatch = path.match(/^\/api\/admin\/consignments\/remittances\/(\d+)$/);
  if (remittanceMatch && method === "GET") {
    const item = await remittanceDetail(env, Number(remittanceMatch[1]));
    return item ? json(item) : notFound("Remessa não encontrada.");
  }

  if (path === "/api/admin/consignments/sales" && method === "POST") return registerSale(request, env);
  if (path === "/api/admin/consignments/restocks" && method === "POST") return registerRestock(request, env);
  if (path === "/api/admin/consignments/returns" && method === "POST") return registerReturn(request, env);
  if (path === "/api/admin/consignments/adjustments" && method === "POST") return registerAdjustment(request, env);
  const reverseMatch = path.match(/^\/api\/admin\/consignments\/sales\/(\d+)\/reverse$/);
  if (reverseMatch && method === "POST") return reverseSale(env, Number(reverseMatch[1]), request);

  if (path === "/api/admin/consignments/movements" && method === "GET") return movements(request, env);
  if (path === "/api/admin/consignments/commissions" && method === "GET") return commissionSummary(request, env);

  if (path === "/api/admin/consignments/settlements") {
    if (method === "GET") return settlements(request, env);
    if (method === "POST") return generateSettlement(request, env);
  }
  const settlementDetailMatch = path.match(/^\/api\/admin\/consignments\/settlements\/(\d+)$/);
  if (settlementDetailMatch && method === "GET") {
    const item = await settlementDetail(env, Number(settlementDetailMatch[1]));
    return item ? json(item) : notFound("Fechamento não encontrado.");
  }
  const payMatch = path.match(/^\/api\/admin\/consignments\/settlements\/(\d+)\/pay$/);
  if (payMatch && method === "PUT") return paySettlement(request, env, Number(payMatch[1]));
  const cancelMatch = path.match(/^\/api\/admin\/consignments\/settlements\/(\d+)\/cancel$/);
  if (cancelMatch && method === "PUT") return cancelSettlement(request, env, Number(cancelMatch[1]));

  const partnerSettingsMatch = path.match(/^\/api\/admin\/consignments\/partners\/(\d+)\/settings$/);
  if (partnerSettingsMatch && method === "PUT") return updatePartnerSettings(request, env, Number(partnerSettingsMatch[1]));
  const partnerOverviewMatch = path.match(/^\/api\/admin\/consignments\/partners\/(\d+)\/overview$/);
  if (partnerOverviewMatch && method === "GET") {
    const item = await partnerOverview(env, Number(partnerOverviewMatch[1]));
    return item ? json(item) : notFound("Parceiro não encontrado.");
  }

  return notFound("Rota de consignados não encontrada.");
}
