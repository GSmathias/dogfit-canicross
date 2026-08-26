import { json, badRequest, notFound } from "../_lib/http.js";

const encoder = new TextEncoder();

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function email(value) {
  return clean(value, 180).toLowerCase();
}

function numberOrNull(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number == null ? null : Math.max(0, Math.trunc(number));
}

function dateOrNull(value) {
  const date = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function bool(value) {
  return value === true || value === 1 || value === "1";
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function randomHex(bytes = 16) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return [...data].map(value => value.toString(16).padStart(2, "0")).join("");
}

function memberCode() {
  return `DFC-${randomHex(3).toUpperCase()}`;
}

function hex(buffer) {
  return [...new Uint8Array(buffer)]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function accessHash(accessCode, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(accessCode),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      iterations: 100000
    },
    key,
    256
  );
  return hex(bits);
}

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function memberIsActive(member) {
  if (!member) return false;
  if (member.status !== "active" || member.payment_status !== "paid") return false;
  if (!member.valid_until) return true;
  return member.valid_until >= new Date().toISOString().slice(0, 10);
}

function publicName(fullName) {
  const parts = clean(fullName, 180).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Associado";
  return `${parts[0]} ${parts.at(-1).slice(0, 1)}.`;
}

function periodStart(period) {
  const now = new Date();
  if (period === "monthly") {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01 00:00:00`;
  }
  if (period === "annual") {
    return `${now.getUTCFullYear()}-01-01 00:00:00`;
  }
  return null;
}

async function addUsage(env, memberId, items, field = "benefit_id") {
  return Promise.all(items.map(async item => {
    if (item.usage_limit == null) return { ...item, used: 0, remaining: null };
    const start = periodStart(item.period);
    const row = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM club_redemptions
      WHERE member_id = ? AND ${field} = ?
        AND (? IS NULL OR redeemed_at >= ?)
    `).bind(memberId, item.id, start, start).first();
    const used = Number(row?.total || 0);
    return {
      ...item,
      used,
      remaining: Math.max(0, Number(item.usage_limit) - used)
    };
  }));
}

async function activeBenefits(env, memberId, partnerId = undefined) {
  let statement = `
    SELECT b.*, p.name AS partner_name
    FROM club_benefits b
    LEFT JOIN club_partners p ON p.id = b.partner_id
    WHERE b.active = 1
      AND (b.partner_id IS NULL OR p.active = 1)
      AND (b.starts_on IS NULL OR b.starts_on <= date('now'))
      AND (b.ends_on IS NULL OR b.ends_on >= date('now'))
  `;
  const values = [];
  if (partnerId !== undefined) {
    statement += " AND b.partner_id = ?";
    values.push(partnerId);
  }
  statement += " ORDER BY b.partner_id IS NOT NULL, b.id";
  const prepared = env.DB.prepare(statement);
  const { results } = values.length
    ? await prepared.bind(...values).all()
    : await prepared.all();
  return addUsage(env, memberId, results);
}

async function activeCoupons(env, memberId, partnerId = undefined) {
  let statement = `
    SELECT c.*, p.name AS partner_name,
      (SELECT COUNT(*) FROM club_redemptions r WHERE r.coupon_id = c.id) AS total_used,
      (SELECT COUNT(*) FROM club_redemptions r WHERE r.coupon_id = c.id AND r.member_id = ?) AS member_used
    FROM club_coupons c
    LEFT JOIN club_partners p ON p.id = c.partner_id
    WHERE c.active = 1
      AND (c.partner_id IS NULL OR p.active = 1)
      AND (c.member_id IS NULL OR c.member_id = ?)
      AND (c.starts_on IS NULL OR c.starts_on <= date('now'))
      AND (c.ends_on IS NULL OR c.ends_on >= date('now'))
  `;
  const values = [memberId, memberId];
  if (partnerId !== undefined) {
    statement += " AND c.partner_id = ?";
    values.push(partnerId);
  }
  statement += " ORDER BY c.id DESC";
  const { results } = await env.DB.prepare(statement).bind(...values).all();
  return results.map(item => ({
    ...item,
    available:
      (item.total_limit == null || Number(item.total_used) < Number(item.total_limit)) &&
      Number(item.member_used) < Number(item.per_member_limit)
  }));
}

async function partnerFromRequest(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(`
    SELECT p.id, p.name, p.email, p.active, s.id AS session_id
    FROM club_partner_sessions s
    JOIN club_partners p ON p.id = s.partner_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND p.active = 1
  `).bind(tokenHash).first();
}

function forbidden() {
  return json({ error: "Acesso não autorizado." }, 401);
}

async function adminDashboard(env) {
  const rows = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS total FROM club_members"),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM club_members WHERE status = 'active' AND payment_status = 'paid' AND (valid_until IS NULL OR valid_until >= date('now'))`),
    env.DB.prepare("SELECT COUNT(*) AS total FROM club_partners WHERE active = 1"),
    env.DB.prepare("SELECT COUNT(*) AS total FROM club_coupons WHERE active = 1"),
    env.DB.prepare("SELECT COUNT(*) AS total FROM club_redemptions WHERE redeemed_at >= datetime('now', 'start of month')")
  ]);
  return json({
    members: Number(rows[0].results[0]?.total || 0),
    active_members: Number(rows[1].results[0]?.total || 0),
    partners: Number(rows[2].results[0]?.total || 0),
    active_coupons: Number(rows[3].results[0]?.total || 0),
    monthly_redemptions: Number(rows[4].results[0]?.total || 0)
  });
}

async function listMembers(request, env) {
  const query = clean(new URL(request.url).searchParams.get("q"), 80);
  const like = `%${query}%`;
  const { results } = await env.DB.prepare(`
    SELECT * FROM club_members
    WHERE ? = '' OR full_name LIKE ? OR member_code LIKE ? OR dog_name LIKE ?
    ORDER BY status = 'active' DESC, full_name COLLATE NOCASE
    LIMIT 300
  `).bind(query, like, like, like).all();
  return json(results.map(item => ({ ...item, membership_active: memberIsActive(item) })));
}

async function createMember(request, env) {
  const data = await readBody(request);
  if (!data?.full_name?.trim()) return badRequest("Nome do associado é obrigatório.");
  const code = clean(data.member_code, 30).toUpperCase() || memberCode();
  const token = crypto.randomUUID();
  try {
    const result = await env.DB.prepare(`
      INSERT INTO club_members (
        member_code, public_token, full_name, whatsapp, email, dog_name,
        plan_name, monthly_fee, joined_on, valid_until, payment_status,
        status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      code,
      token,
      clean(data.full_name, 180),
      clean(data.whatsapp, 30),
      email(data.email),
      clean(data.dog_name, 120),
      clean(data.plan_name, 120) || "Clube DOGFIT CANICROSS",
      numberOrNull(data.monthly_fee) ?? 79.9,
      dateOrNull(data.joined_on) || new Date().toISOString().slice(0, 10),
      dateOrNull(data.valid_until),
      ["paid", "pending", "overdue"].includes(data.payment_status) ? data.payment_status : "paid",
      data.status === "inactive" ? "inactive" : "active",
      clean(data.notes, 1000)
    ).run();
    return json(
      await env.DB.prepare("SELECT * FROM club_members WHERE id = ?")
        .bind(result.meta.last_row_id).first(),
      201
    );
  } catch (error) {
    if (String(error).includes("UNIQUE")) return badRequest("Código de associado já utilizado.");
    throw error;
  }
}

async function updateMember(request, env, id) {
  const data = await readBody(request);
  if (!data?.full_name?.trim()) return badRequest("Nome do associado é obrigatório.");
  try {
    const result = await env.DB.prepare(`
      UPDATE club_members SET
        member_code = ?, full_name = ?, whatsapp = ?, email = ?, dog_name = ?,
        plan_name = ?, monthly_fee = ?, joined_on = ?, valid_until = ?,
        payment_status = ?, status = ?, notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      clean(data.member_code, 30).toUpperCase(),
      clean(data.full_name, 180),
      clean(data.whatsapp, 30),
      email(data.email),
      clean(data.dog_name, 120),
      clean(data.plan_name, 120) || "Clube DOGFIT CANICROSS",
      numberOrNull(data.monthly_fee) ?? 79.9,
      dateOrNull(data.joined_on) || new Date().toISOString().slice(0, 10),
      dateOrNull(data.valid_until),
      ["paid", "pending", "overdue"].includes(data.payment_status) ? data.payment_status : "pending",
      data.status === "inactive" ? "inactive" : "active",
      clean(data.notes, 1000),
      id
    ).run();
    if (!result.meta.changes) return notFound("Associado não encontrado.");
    return json(await env.DB.prepare("SELECT * FROM club_members WHERE id = ?").bind(id).first());
  } catch (error) {
    if (String(error).includes("UNIQUE")) return badRequest("Código de associado já utilizado.");
    throw error;
  }
}

async function listPartners(env) {
  const { results } = await env.DB.prepare(`
    SELECT p.id, p.name, p.email, p.active, p.category, p.phone, p.address,
      p.instagram, p.description, p.public_visible, p.created_at, p.updated_at,
      (SELECT COUNT(*) FROM club_redemptions r WHERE r.partner_id = p.id) AS redemptions
    FROM club_partners p
    ORDER BY p.active DESC, p.name COLLATE NOCASE
  `).all();
  return json(results);
}

async function savePartner(request, env, id = null) {
  const data = await readBody(request);
  const partnerEmail = email(data?.email);
  if (!data?.name?.trim() || !partnerEmail) return badRequest("Nome e e-mail são obrigatórios.");
  const accessCode = clean(data.access_code, 100);
  if (!id && accessCode.length < 6) return badRequest("A senha do parceiro precisa ter pelo menos 6 caracteres.");

  try {
    if (!id) {
      const salt = randomHex(16);
      const hash = await accessHash(accessCode, salt);
      const result = await env.DB.prepare(`
        INSERT INTO club_partners (
          name, email, access_salt, access_hash, active, category, phone,
          address, instagram, description, public_visible
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        clean(data.name, 140), partnerEmail, salt, hash, data.active === false ? 0 : 1,
        clean(data.category, 80) || "Pet shop", clean(data.phone, 30),
        clean(data.address, 250), clean(data.instagram, 100).replace(/^@/, ""),
        clean(data.description, 500), data.public_visible === false ? 0 : 1
      ).run();
      return json(
        await env.DB.prepare("SELECT id, name, email, active, category, phone, address, instagram, description, public_visible, created_at FROM club_partners WHERE id = ?")
          .bind(result.meta.last_row_id).first(),
        201
      );
    }

    const current = await env.DB.prepare("SELECT * FROM club_partners WHERE id = ?").bind(id).first();
    if (!current) return notFound("Parceiro não encontrado.");
    let salt = current.access_salt;
    let hash = current.access_hash;
    if (accessCode) {
      if (accessCode.length < 6) return badRequest("A senha do parceiro precisa ter pelo menos 6 caracteres.");
      salt = randomHex(16);
      hash = await accessHash(accessCode, salt);
      await env.DB.prepare("DELETE FROM club_partner_sessions WHERE partner_id = ?").bind(id).run();
    }
    await env.DB.prepare(`
      UPDATE club_partners SET name = ?, email = ?, access_salt = ?, access_hash = ?,
        active = ?, category = ?, phone = ?, address = ?, instagram = ?,
        description = ?, public_visible = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      clean(data.name, 140), partnerEmail, salt, hash, bool(data.active) ? 1 : 0,
      clean(data.category, 80) || "Pet shop", clean(data.phone, 30),
      clean(data.address, 250), clean(data.instagram, 100).replace(/^@/, ""),
      clean(data.description, 500), bool(data.public_visible) ? 1 : 0, id
    ).run();
    return json(await env.DB.prepare("SELECT id, name, email, active, category, phone, address, instagram, description, public_visible, created_at, updated_at FROM club_partners WHERE id = ?").bind(id).first());
  } catch (error) {
    if (String(error).includes("UNIQUE")) return badRequest("Já existe um parceiro com esse e-mail.");
    throw error;
  }
}

async function listBenefits(env) {
  const { results } = await env.DB.prepare(`
    SELECT b.*, p.name AS partner_name
    FROM club_benefits b
    LEFT JOIN club_partners p ON p.id = b.partner_id
    ORDER BY b.active DESC, b.id DESC
  `).all();
  return json(results);
}

async function saveBenefit(request, env, id = null) {
  const data = await readBody(request);
  if (!data?.title?.trim()) return badRequest("Título do benefício é obrigatório.");
  const type = ["percentage", "fixed", "credit", "item"].includes(data.benefit_type)
    ? data.benefit_type : "percentage";
  const period = ["monthly", "annual", "once", "unlimited"].includes(data.period)
    ? data.period : "unlimited";
  const benefitValue = numberOrNull(data.value) ?? 0;
  if (type === "percentage" && (benefitValue <= 0 || benefitValue > 100)) {
    return badRequest("O percentual precisa estar entre 0,01% e 100%.");
  }
  if (type === "fixed" && benefitValue <= 0) {
    return badRequest("O valor do desconto precisa ser maior que zero.");
  }
  const values = [
    integerOrNull(data.partner_id), clean(data.title, 160), clean(data.description, 700),
    type, benefitValue, period, integerOrNull(data.usage_limit),
    data.active === false ? 0 : 1, dateOrNull(data.starts_on), dateOrNull(data.ends_on)
  ];
  if (!id) {
    const result = await env.DB.prepare(`
      INSERT INTO club_benefits (
        partner_id, title, description, benefit_type, value, period,
        usage_limit, active, starts_on, ends_on
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(...values).run();
    return json(await env.DB.prepare("SELECT * FROM club_benefits WHERE id = ?").bind(result.meta.last_row_id).first(), 201);
  }
  const result = await env.DB.prepare(`
    UPDATE club_benefits SET
      partner_id = ?, title = ?, description = ?, benefit_type = ?, value = ?,
      period = ?, usage_limit = ?, active = ?, starts_on = ?, ends_on = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(...values, id).run();
  if (!result.meta.changes) return notFound("Benefício não encontrado.");
  return json(await env.DB.prepare("SELECT * FROM club_benefits WHERE id = ?").bind(id).first());
}

async function listCoupons(env) {
  const { results } = await env.DB.prepare(`
    SELECT c.*, p.name AS partner_name, m.full_name AS member_name,
      (SELECT COUNT(*) FROM club_redemptions r WHERE r.coupon_id = c.id) AS uses
    FROM club_coupons c
    LEFT JOIN club_partners p ON p.id = c.partner_id
    LEFT JOIN club_members m ON m.id = c.member_id
    ORDER BY c.active DESC, c.id DESC
  `).all();
  return json(results);
}

async function saveCoupon(request, env, id = null) {
  const data = await readBody(request);
  const code = clean(data?.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!code || !data?.title?.trim()) return badRequest("Código e título são obrigatórios.");
  const type = data.discount_type === "fixed" ? "fixed" : "percentage";
  const discountValue = numberOrNull(data.discount_value) ?? 0;
  if (discountValue <= 0 || (type === "percentage" && discountValue > 100)) {
    return badRequest(type === "percentage"
      ? "O percentual precisa estar entre 0,01% e 100%."
      : "O valor do desconto precisa ser maior que zero."
    );
  }
  const values = [
    code, clean(data.title, 160), clean(data.description, 700), type,
    discountValue, integerOrNull(data.partner_id),
    integerOrNull(data.member_id), integerOrNull(data.total_limit),
    integerOrNull(data.per_member_limit) ?? 1, dateOrNull(data.starts_on),
    dateOrNull(data.ends_on), data.active === false ? 0 : 1
  ];
  try {
    if (!id) {
      const result = await env.DB.prepare(`
        INSERT INTO club_coupons (
          code, title, description, discount_type, discount_value, partner_id,
          member_id, total_limit, per_member_limit, starts_on, ends_on, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(...values).run();
      return json(await env.DB.prepare("SELECT * FROM club_coupons WHERE id = ?").bind(result.meta.last_row_id).first(), 201);
    }
    const result = await env.DB.prepare(`
      UPDATE club_coupons SET
        code = ?, title = ?, description = ?, discount_type = ?, discount_value = ?,
        partner_id = ?, member_id = ?, total_limit = ?, per_member_limit = ?,
        starts_on = ?, ends_on = ?, active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(...values, id).run();
    if (!result.meta.changes) return notFound("Cupom não encontrado.");
    return json(await env.DB.prepare("SELECT * FROM club_coupons WHERE id = ?").bind(id).first());
  } catch (error) {
    if (String(error).includes("UNIQUE")) return badRequest("Esse código de cupom já existe.");
    throw error;
  }
}

async function listRedemptions(request, env, partnerId = undefined) {
  const query = clean(new URL(request.url).searchParams.get("q"), 80);
  const like = `%${query}%`;
  let statement = `
    SELECT r.*, m.member_code, m.full_name, p.name AS partner_name,
      b.title AS benefit_title, c.title AS coupon_title, c.code AS coupon_code
    FROM club_redemptions r
    JOIN club_members m ON m.id = r.member_id
    LEFT JOIN club_partners p ON p.id = r.partner_id
    LEFT JOIN club_benefits b ON b.id = r.benefit_id
    LEFT JOIN club_coupons c ON c.id = r.coupon_id
    WHERE (? = '' OR m.full_name LIKE ? OR m.member_code LIKE ? OR c.code LIKE ?)
  `;
  const values = [query, like, like, like];
  if (partnerId !== undefined) {
    statement += " AND r.partner_id = ?";
    values.push(partnerId);
  }
  statement += " ORDER BY r.redeemed_at DESC LIMIT 300";
  const { results } = await env.DB.prepare(statement).bind(...values).all();
  return json(partnerId === undefined
    ? results
    : results.map(item => ({ ...item, full_name: publicName(item.full_name) }))
  );
}

async function deleteAdminRecord(env, table, id, label) {
  const allowedTables = new Set([
    "club_members",
    "club_partners",
    "club_benefits",
    "club_coupons",
    "club_redemptions"
  ]);
  if (!allowedTables.has(table)) return badRequest("Tipo de registro inválido.");

  if (table === "club_partners") {
    const results = await env.DB.batch([
      env.DB.prepare(`
        DELETE FROM club_redemptions
        WHERE partner_id = ?
          OR benefit_id IN (SELECT id FROM club_benefits WHERE partner_id = ?)
          OR coupon_id IN (SELECT id FROM club_coupons WHERE partner_id = ?)
      `).bind(id, id, id),
      env.DB.prepare("DELETE FROM club_partner_sessions WHERE partner_id = ?").bind(id),
      env.DB.prepare("DELETE FROM club_benefits WHERE partner_id = ?").bind(id),
      env.DB.prepare("DELETE FROM club_coupons WHERE partner_id = ?").bind(id),
      env.DB.prepare("DELETE FROM club_partners WHERE id = ?").bind(id)
    ]);
    if (!results[4]?.meta?.changes) return notFound(`${label} não encontrado.`);
    return json({ ok: true });
  }

  if (table === "club_members") {
    const results = await env.DB.batch([
      env.DB.prepare("DELETE FROM club_redemptions WHERE member_id = ?").bind(id),
      env.DB.prepare("DELETE FROM club_coupons WHERE member_id = ?").bind(id),
      env.DB.prepare("DELETE FROM club_members WHERE id = ?").bind(id)
    ]);
    if (!results[2]?.meta?.changes) return notFound(`${label} não encontrado.`);
    return json({ ok: true });
  }

  // Benefícios e cupons já utilizados possuem histórico em club_redemptions.
  // A ação "Excluir" é definitiva, então removemos também esses vínculos.
  const dependentField = table === "club_benefits"
    ? "benefit_id"
    : table === "club_coupons"
      ? "coupon_id"
      : null;

  if (dependentField) {
    const results = await env.DB.batch([
      env.DB.prepare(`DELETE FROM club_redemptions WHERE ${dependentField} = ?`).bind(id),
      env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id)
    ]);
    if (!results[1]?.meta?.changes) return notFound(`${label} não encontrado.`);
    return json({ ok: true });
  }

  const result = await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  if (!result.meta.changes) return notFound(`${label} não encontrado.`);
  return json({ ok: true });
}

export async function handleAdminClub({ request, env, path, method }) {
  if (path === "/api/admin/club/dashboard" && method === "GET") return adminDashboard(env);
  if (path === "/api/admin/club/members") {
    if (method === "GET") return listMembers(request, env);
    if (method === "POST") return createMember(request, env);
  }
  const memberMatch = path.match(/^\/api\/admin\/club\/members\/(\d+)$/);
  if (memberMatch) {
    const id = Number(memberMatch[1]);
    if (method === "PUT") return updateMember(request, env, id);
    if (method === "DELETE") return deleteAdminRecord(env, "club_members", id, "Associado");
  }

  if (path === "/api/admin/club/partners") {
    if (method === "GET") return listPartners(env);
    if (method === "POST") return savePartner(request, env);
  }
  const partnerMatch = path.match(/^\/api\/admin\/club\/partners\/(\d+)$/);
  if (partnerMatch) {
    const id = Number(partnerMatch[1]);
    if (method === "PUT") return savePartner(request, env, id);
    if (method === "DELETE") return deleteAdminRecord(env, "club_partners", id, "Parceiro");
  }

  if (path === "/api/admin/club/benefits") {
    if (method === "GET") return listBenefits(env);
    if (method === "POST") return saveBenefit(request, env);
  }
  const benefitMatch = path.match(/^\/api\/admin\/club\/benefits\/(\d+)$/);
  if (benefitMatch) {
    const id = Number(benefitMatch[1]);
    if (method === "PUT") return saveBenefit(request, env, id);
    if (method === "DELETE") return deleteAdminRecord(env, "club_benefits", id, "Benefício");
  }

  if (path === "/api/admin/club/coupons") {
    if (method === "GET") return listCoupons(env);
    if (method === "POST") return saveCoupon(request, env);
  }
  const couponMatch = path.match(/^\/api\/admin\/club\/coupons\/(\d+)$/);
  if (couponMatch) {
    const id = Number(couponMatch[1]);
    if (method === "PUT") return saveCoupon(request, env, id);
    if (method === "DELETE") return deleteAdminRecord(env, "club_coupons", id, "Cupom");
  }

  if (path === "/api/admin/club/redemptions") {
    if (method === "GET") return listRedemptions(request, env);
    if (method === "POST") return redeem(request, env, null, true);
  }
  const redemptionMatch = path.match(/^\/api\/admin\/club\/redemptions\/(\d+)$/);
  if (redemptionMatch && method === "DELETE") {
    return deleteAdminRecord(env, "club_redemptions", Number(redemptionMatch[1]), "Utilização");
  }
  return notFound("Rota do Clube não encontrada.");
}

async function partnerLogin(request, env) {
  const data = await readBody(request);
  const partnerEmail = email(data?.email);
  const accessCode = clean(data?.access_code, 100);
  if (!partnerEmail || !accessCode) return badRequest("Informe e-mail e senha.");
  const partner = await env.DB.prepare("SELECT * FROM club_partners WHERE email = ? AND active = 1")
    .bind(partnerEmail).first();
  if (!partner) return forbidden();
  const candidate = await accessHash(accessCode, partner.access_salt);
  if (!safeEqual(candidate, partner.access_hash)) return forbidden();

  const token = `${crypto.randomUUID()}.${randomHex(24)}`;
  const tokenHash = await sha256(token);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM club_partner_sessions WHERE expires_at <= datetime('now')"),
    env.DB.prepare(`
      INSERT INTO club_partner_sessions (partner_id, token_hash, expires_at)
      VALUES (?, ?, datetime('now', '+12 hours'))
    `).bind(partner.id, tokenHash)
  ]);
  return json({
    token,
    partner: { id: partner.id, name: partner.name, email: partner.email },
    expires_in: 43200
  });
}

async function partnerMember(request, env, partner) {
  const code = clean(new URL(request.url).searchParams.get("code"), 30).toUpperCase();
  if (!code) return badRequest("Informe o código do associado.");
  const member = await env.DB.prepare(`
    SELECT id, member_code, full_name, dog_name, valid_until, payment_status, status
    FROM club_members WHERE member_code = ?
  `).bind(code).first();
  if (!member) return notFound("Associado não encontrado.");
  const active = memberIsActive(member);
  const [benefits, coupons] = active
    ? await Promise.all([
        activeBenefits(env, member.id, partner.id),
        activeCoupons(env, member.id, partner.id)
      ])
    : [[], []];
  return json({
    member: {
      id: member.id,
      member_code: member.member_code,
      name: publicName(member.full_name),
      dog_name: member.dog_name,
      valid_until: member.valid_until,
      active
    },
    benefits,
    coupons
  });
}

async function redeem(request, env, partner = null, admin = false) {
  const data = await readBody(request);
  const memberId = Number(data?.member_id);
  const itemId = Number(data?.item_id);
  const kind = data?.kind;
  if (!Number.isInteger(memberId) || !Number.isInteger(itemId) || !["benefit", "coupon"].includes(kind)) {
    return badRequest("Dados da utilização inválidos.");
  }
  const member = await env.DB.prepare("SELECT * FROM club_members WHERE id = ?").bind(memberId).first();
  if (!member || !memberIsActive(member)) return badRequest("Associação inativa ou pagamento pendente.");
  const amountBefore = Math.max(0, numberOrNull(data.amount_before) ?? 0);
  let discount = 0;
  let benefitId = null;
  let couponId = null;
  let redemptionPartnerId = partner?.id ?? null;

  if (kind === "benefit") {
    let benefitStatement = `
      SELECT * FROM club_benefits
      WHERE id = ? AND active = 1
        AND (starts_on IS NULL OR starts_on <= date('now'))
        AND (ends_on IS NULL OR ends_on >= date('now'))
    `;
    const benefitValues = [itemId];
    if (!admin) {
      benefitStatement += " AND partner_id = ?";
      benefitValues.push(partner.id);
    }
    const benefit = await env.DB.prepare(benefitStatement).bind(...benefitValues).first();
    if (!benefit) return badRequest(admin ? "Benefício indisponível." : "Benefício indisponível para este parceiro.");
    if (benefit.usage_limit != null) {
      const start = periodStart(benefit.period);
      const usage = await env.DB.prepare(`
        SELECT COUNT(*) AS total FROM club_redemptions
        WHERE member_id = ? AND benefit_id = ? AND (? IS NULL OR redeemed_at >= ?)
      `).bind(memberId, benefit.id, start, start).first();
      if (Number(usage.total) >= Number(benefit.usage_limit)) return badRequest("Limite desse benefício já utilizado.");
    }
    benefitId = benefit.id;
    redemptionPartnerId = benefit.partner_id ?? redemptionPartnerId;
    if (benefit.benefit_type === "percentage") discount = amountBefore * Number(benefit.value) / 100;
    if (benefit.benefit_type === "fixed") discount = Number(benefit.value);
    if (benefit.benefit_type === "credit") discount = amountBefore;
  } else {
    let couponStatement = `
      SELECT c.*,
        (SELECT COUNT(*) FROM club_redemptions r WHERE r.coupon_id = c.id) AS total_used,
        (SELECT COUNT(*) FROM club_redemptions r WHERE r.coupon_id = c.id AND r.member_id = ?) AS member_used
      FROM club_coupons c
      WHERE c.id = ? AND c.active = 1
        AND (c.member_id IS NULL OR c.member_id = ?)
        AND (c.starts_on IS NULL OR c.starts_on <= date('now'))
        AND (c.ends_on IS NULL OR c.ends_on >= date('now'))
    `;
    const couponValues = [memberId, itemId, memberId];
    if (!admin) {
      couponStatement += " AND c.partner_id = ?";
      couponValues.push(partner.id);
    }
    const coupon = await env.DB.prepare(couponStatement).bind(...couponValues).first();
    if (!coupon) return badRequest("Cupom indisponível para este associado.");
    if (coupon.total_limit != null && Number(coupon.total_used) >= Number(coupon.total_limit)) return badRequest("Cupom esgotado.");
    if (Number(coupon.member_used) >= Number(coupon.per_member_limit)) return badRequest("Cupom já utilizado por este associado.");
    couponId = coupon.id;
    redemptionPartnerId = coupon.partner_id ?? redemptionPartnerId;
    discount = coupon.discount_type === "percentage"
      ? amountBefore * Number(coupon.discount_value) / 100
      : Number(coupon.discount_value);
  }

  discount = Math.round(Math.min(amountBefore || discount, Math.max(0, discount)) * 100) / 100;
  const result = await env.DB.prepare(`
    INSERT INTO club_redemptions (
      member_id, partner_id, benefit_id, coupon_id, amount_before,
      discount_amount, notes, redeemed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    memberId, redemptionPartnerId, benefitId, couponId, amountBefore || null,
    discount, clean(data.notes, 500)
  ).run();
  return json({
    id: result.meta.last_row_id,
    discount_amount: discount,
    final_amount: Math.max(0, Math.round((amountBefore - discount) * 100) / 100)
  }, 201);
}

export async function handlePartner({ request, env, path, method }) {
  if (path === "/api/partner/login" && method === "POST") return partnerLogin(request, env);
  const partner = await partnerFromRequest(request, env);
  if (!partner) return forbidden();

  if (path === "/api/partner/me" && method === "GET") {
    return json({ partner: { id: partner.id, name: partner.name, email: partner.email } });
  }
  if (path === "/api/partner/member" && method === "GET") return partnerMember(request, env, partner);
  if (path === "/api/partner/redeem" && method === "POST") return redeem(request, env, partner);
  if (path === "/api/partner/redemptions" && method === "GET") return listRedemptions(request, env, partner.id);
  if (path === "/api/partner/logout" && method === "POST") {
    await env.DB.prepare("DELETE FROM club_partner_sessions WHERE id = ?").bind(partner.session_id).run();
    return new Response(null, { status: 204 });
  }
  return notFound("Rota do parceiro não encontrada.");
}

export async function handlePublicClub({ env, path, method }) {
  if (method !== "GET") return notFound();
  const match = path.match(/^\/api\/club\/card\/([a-f0-9-]{36})$/i);
  if (!match) return notFound("Carteirinha não encontrada.");
  const member = await env.DB.prepare(`
    SELECT id, member_code, public_token, full_name, dog_name, plan_name,
      joined_on, valid_until, payment_status, status
    FROM club_members WHERE public_token = ?
  `).bind(match[1]).first();
  if (!member) return notFound("Carteirinha não encontrada.");
  const benefits = memberIsActive(member) ? await activeBenefits(env, member.id) : [];
  return json({
    member: {
      member_code: member.member_code,
      name: publicName(member.full_name),
      dog_name: member.dog_name,
      plan_name: member.plan_name,
      joined_on: member.joined_on,
      valid_until: member.valid_until,
      active: memberIsActive(member)
    },
    benefits: benefits.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      partner_name: item.partner_name,
      period: item.period,
      usage_limit: item.usage_limit,
      remaining: item.remaining
    }))
  });
}
