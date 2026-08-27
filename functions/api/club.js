import { json, badRequest, notFound } from "../_lib/http.js";
import {
  cleanReferralCode,
  createReferral,
  normalizeReferralEmail,
  normalizeReferralPhone,
  numberToCents,
  referralSettingByCode,
  referralSettingById,
  syncReferralPaymentBySource,
  validateReferralCode
} from "../_lib/referrals.js";

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
    SELECT m.*,
      (SELECT r.code_snapshot FROM partner_referrals r
        WHERE r.source_type = 'club' AND r.club_member_id = m.id
        ORDER BY r.id DESC LIMIT 1) AS referral_code,
      (SELECT r.partner_name_snapshot FROM partner_referrals r
        WHERE r.source_type = 'club' AND r.club_member_id = m.id
        ORDER BY r.id DESC LIMIT 1) AS referral_partner_name,
      (SELECT r.commission_status FROM partner_referrals r
        WHERE r.source_type = 'club' AND r.club_member_id = m.id
        ORDER BY r.id DESC LIMIT 1) AS referral_commission_status
    FROM club_members m
    WHERE ? = '' OR m.full_name LIKE ? OR m.member_code LIKE ? OR m.dog_name LIKE ?
    ORDER BY m.status = 'active' DESC, m.full_name COLLATE NOCASE
    LIMIT 300
  `).bind(query, like, like, like).all();
  return json(results.map(item => ({ ...item, membership_active: memberIsActive(item) })));
}

async function createClubReferralForMember(env, member, referralCode) {
  const code = cleanReferralCode(referralCode);
  if (!code) return { referral: null, warning: "" };
  const originalAmountCents = numberToCents(member.monthly_fee);
  const validation = await validateReferralCode(env, code, {
    customerId: member.customer_id,
    email: member.email,
    phone: member.whatsapp,
    sourceType: "club",
    originalAmountCents,
    otherDiscountCents: 0
  });
  if (!validation.valid) return { referral: null, warning: validation.message };
  try {
    const referral = await createReferral(env, {
      setting: validation.setting,
      customerId: member.customer_id,
      email: member.email,
      phone: member.whatsapp,
      sourceType: "club",
      sourceReference: member.member_code,
      clubMemberId: member.id,
      originalAmountCents,
      discountAmountCents: validation.discount_amount_cents
    });
    if (member.payment_status === "paid") {
      await syncReferralPaymentBySource(env, {
        sourceType: "club",
        sourceReference: referral.source_reference,
        paymentStatus: "approved",
        paymentProvider: "manual"
      });
    }
    return { referral, warning: "" };
  } catch (error) {
    if (String(error).includes("REFERRAL_CUSTOMER_LIMIT")) {
      return { referral: null, warning: "Este cliente já atingiu o limite de uso deste cupom de indicação." };
    }
    throw error;
  }
}

async function createMember(request, env) {
  const data = await readBody(request);
  if (!data?.full_name?.trim()) return badRequest("Nome do associado é obrigatório.");
  const code = clean(data.member_code, 30).toUpperCase() || memberCode();
  const token = crypto.randomUUID();
  const memberEmail = email(data.email);
  const monthlyFee = numberOrNull(data.monthly_fee) ?? 79.9;
  const customer = memberEmail
    ? await env.DB.prepare("SELECT id FROM customer_accounts WHERE email = ? AND email_verified_at IS NOT NULL")
        .bind(memberEmail).first()
    : null;
  try {
    const result = await env.DB.prepare(`
      INSERT INTO club_members (
        member_code, public_token, full_name, whatsapp, email, dog_name,
        plan_name, monthly_fee, joined_on, valid_until, payment_status,
        status, notes, customer_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      code,
      token,
      clean(data.full_name, 180),
      clean(data.whatsapp, 30),
      memberEmail,
      clean(data.dog_name, 120),
      clean(data.plan_name, 120) || "Clube DOGFIT CANICROSS",
      monthlyFee,
      dateOrNull(data.joined_on) || new Date().toISOString().slice(0, 10),
      dateOrNull(data.valid_until),
      ["paid", "pending", "overdue"].includes(data.payment_status) ? data.payment_status : "paid",
      data.status === "inactive" ? "inactive" : "active",
      clean(data.notes, 1000),
      customer?.id || null
    ).run();
    const member = await env.DB.prepare("SELECT * FROM club_members WHERE id = ?")
      .bind(result.meta.last_row_id).first();
    const referralResult = await createClubReferralForMember(env, member, data.referral_code);
    return json({ ...member, referral_code: referralResult.referral?.code_snapshot || "", referral_warning: referralResult.warning }, 201);
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

    const member = await env.DB.prepare("SELECT * FROM club_members WHERE id = ?").bind(id).first();
    let referral = await env.DB.prepare(`
      SELECT * FROM partner_referrals WHERE source_type = 'club' AND club_member_id = ? ORDER BY id DESC LIMIT 1
    `).bind(id).first();
    let warning = "";
    const requestedCode = cleanReferralCode(data.referral_code);

    if (!referral && requestedCode) {
      const referralResult = await createClubReferralForMember(env, member, requestedCode);
      referral = referralResult.referral;
      warning = referralResult.warning;
    } else if (referral) {
      if (requestedCode && requestedCode !== cleanReferralCode(referral.code_snapshot)) {
        warning = "O cupom de indicação já registrado para este associado foi preservado para manter o histórico financeiro.";
      }
      await syncReferralPaymentBySource(env, {
        sourceType: "club",
        sourceReference: referral.source_reference,
        paymentStatus: member.payment_status === "paid" ? "approved" : "pending",
        paymentProvider: member.payment_status === "paid" ? (referral.payment_provider || "manual") : referral.payment_provider
      });
    }

    return json({ ...member, referral_code: referral?.code_snapshot || "", referral_warning: warning });
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

function referralConfigView(item) {
  return {
    ...item,
    customer_discount_value: item.customer_discount_type === "fixed"
      ? Number(item.customer_discount_cents || 0) / 100
      : Number(item.customer_discount_bps || 0) / 100,
    event_commission: Number(item.event_commission_cents || 0) / 100,
    club_commission: Number(item.club_commission_cents || 0) / 100,
    product_commission_percent: Number(item.product_commission_bps || 0) / 100,
    active_effective: Boolean(Number(item.active) && Number(item.partner_active ?? 1))
  };
}

async function listReferralConfigs(env) {
  const { results } = await env.DB.prepare(`
    SELECT s.*, p.name AS partner_name, p.email AS partner_email, p.active AS partner_active,
      COUNT(r.id) AS referral_count,
      SUM(CASE WHEN r.payment_status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
      COALESCE(SUM(CASE WHEN r.payment_status = 'approved' THEN r.final_amount_cents ELSE 0 END), 0) AS total_sold_cents,
      COALESCE(SUM(CASE WHEN r.commission_status = 'released' THEN r.commission_amount_cents ELSE 0 END), 0) AS pending_commission_cents,
      COALESCE(SUM(CASE WHEN r.commission_status = 'paid' THEN r.commission_amount_cents ELSE 0 END), 0) AS paid_commission_cents
    FROM partner_referral_settings s
    JOIN club_partners p ON p.id = s.partner_id
    LEFT JOIN partner_referrals r ON r.referral_setting_id = s.id
    GROUP BY s.id
    ORDER BY (s.active = 1 AND p.active = 1) DESC, p.name COLLATE NOCASE
  `).all();
  return json(results.map(referralConfigView));
}

async function saveReferralConfig(request, env, id = null) {
  const data = await readBody(request);
  const partnerId = Number(data?.partner_id);
  if (!Number.isInteger(partnerId) || partnerId <= 0) return badRequest("Selecione um parceiro válido.");
  const partner = await env.DB.prepare("SELECT id, name, active FROM club_partners WHERE id = ?").bind(partnerId).first();
  if (!partner) return notFound("Parceiro não encontrado.");
  const code = cleanReferralCode(data?.code);
  if (!code) return badRequest("Informe um código de indicação válido.");

  const discountType = data?.customer_discount_type === "fixed" ? "fixed" : "percentage";
  const discountValue = Math.max(0, Number(data?.customer_discount_value || 0));
  if (!Number.isFinite(discountValue) || (discountType === "percentage" && discountValue > 100)) {
    return badRequest("Desconto inválido.");
  }
  const productCommission = Math.max(0, Number(data?.product_commission_percent || 0));
  if (!Number.isFinite(productCommission) || productCommission > 100) return badRequest("Comissão de produtos inválida.");
  const perCustomerLimit = Math.max(1, Math.trunc(Number(data?.per_customer_limit) || 1));
  const values = [
    partnerId,
    code,
    data?.active === false ? 0 : 1,
    discountType,
    discountType === "percentage" ? Math.round(discountValue * 100) : 0,
    discountType === "fixed" ? numberToCents(discountValue) : 0,
    numberToCents(Math.max(0, Number(data?.event_commission || 0))),
    numberToCents(Math.max(0, Number(data?.club_commission || 0))),
    Math.round(productCommission * 100),
    perCustomerLimit,
    bool(data?.allow_stacking) ? 1 : 0,
    dateOrNull(data?.valid_until)
  ];

  try {
    if (id) {
      const current = await referralSettingById(env, id);
      if (!current) return notFound("Configuração de indicação não encontrada.");
      if (Number(current.partner_id) !== partnerId) {
        const history = await env.DB.prepare("SELECT 1 AS found FROM partner_referrals WHERE referral_setting_id = ? LIMIT 1")
          .bind(id).first();
        if (history) return badRequest("Este cupom já possui histórico. O pet shop não pode ser trocado; crie uma nova configuração para preservar a auditoria.");
      }
    }
    if (!id) {
      const result = await env.DB.prepare(`
        INSERT INTO partner_referral_settings (
          partner_id, code, active, customer_discount_type, customer_discount_bps,
          customer_discount_cents, event_commission_cents, club_commission_cents,
          product_commission_bps, per_customer_limit, allow_stacking, valid_until,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).bind(...values).run();
      const saved = await referralSettingById(env, result.meta.last_row_id);
      return json(referralConfigView(saved), 201);
    }
    const result = await env.DB.prepare(`
      UPDATE partner_referral_settings SET
        partner_id = ?, code = ?, active = ?, customer_discount_type = ?,
        customer_discount_bps = ?, customer_discount_cents = ?,
        event_commission_cents = ?, club_commission_cents = ?, product_commission_bps = ?,
        per_customer_limit = ?, allow_stacking = ?, valid_until = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(...values, id).run();
    if (!result.meta.changes) return notFound("Configuração de indicação não encontrada.");
    const saved = await referralSettingById(env, id);
    return json(referralConfigView(saved));
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return badRequest("Esse código já está em uso ou este parceiro já possui um código de indicação.");
    }
    throw error;
  }
}

async function listReferralRecords(request, env, forcedPartnerId = null) {
  const url = new URL(request.url);
  const partnerId = forcedPartnerId || Number(url.searchParams.get("partner_id") || 0);
  const paymentStatus = clean(url.searchParams.get("payment_status"), 20);
  const commissionStatus = clean(url.searchParams.get("commission_status"), 20);
  const sourceType = clean(url.searchParams.get("source_type"), 20);
  const dateFrom = dateOrNull(url.searchParams.get("from")) || "";
  const dateTo = dateOrNull(url.searchParams.get("to")) || "";
  const query = clean(url.searchParams.get("q"), 100);
  const like = `%${query}%`;
  const { results } = await env.DB.prepare(`
    SELECT r.*, p.name AS partner_name, s.code AS current_code,
      ca.full_name AS customer_name,
      er.registration_code, er.event_title,
      cm.member_code, cm.full_name AS member_name,
      pr.name AS product_name
    FROM partner_referrals r
    JOIN club_partners p ON p.id = r.partner_id
    JOIN partner_referral_settings s ON s.id = r.referral_setting_id
    LEFT JOIN customer_accounts ca ON ca.id = r.customer_id
    LEFT JOIN event_registrations er ON er.id = r.event_registration_id
    LEFT JOIN club_members cm ON cm.id = r.club_member_id
    LEFT JOIN products pr ON pr.id = r.product_id
    WHERE (? = 0 OR r.partner_id = ?)
      AND (? = '' OR r.payment_status = ?)
      AND (? = '' OR r.commission_status = ?)
      AND (? = '' OR r.source_type = ?)
      AND (? = '' OR date(r.referred_at) >= ?)
      AND (? = '' OR date(r.referred_at) <= ?)
      AND (? = '' OR r.code_snapshot LIKE ? OR r.partner_name_snapshot LIKE ? OR
        r.source_reference LIKE ? OR r.customer_email LIKE ? OR r.customer_phone LIKE ?)
    ORDER BY r.referred_at DESC, r.id DESC
    LIMIT 500
  `).bind(
    partnerId || 0, partnerId || 0,
    paymentStatus, paymentStatus,
    commissionStatus, commissionStatus,
    sourceType, sourceType,
    dateFrom, dateFrom,
    dateTo, dateTo,
    query, like, like, like, like, like
  ).all();
  return results;
}

async function referralDetail(env, id) {
  return env.DB.prepare(`
    SELECT r.*, p.name AS partner_name, s.code AS current_code,
      ca.full_name AS customer_name, er.event_title, er.event_date,
      cm.full_name AS member_name, pr.name AS product_name
    FROM partner_referrals r
    JOIN club_partners p ON p.id = r.partner_id
    JOIN partner_referral_settings s ON s.id = r.referral_setting_id
    LEFT JOIN customer_accounts ca ON ca.id = r.customer_id
    LEFT JOIN event_registrations er ON er.id = r.event_registration_id
    LEFT JOIN club_members cm ON cm.id = r.club_member_id
    LEFT JOIN products pr ON pr.id = r.product_id
    WHERE r.id = ?
  `).bind(id).first();
}

async function createManualReferral(request, env) {
  const data = await readBody(request);
  const setting = await referralSettingById(env, Number(data?.referral_setting_id));
  if (!setting) return notFound("Cupom de indicação não encontrado.");
  const sourceType = ["club", "product"].includes(data?.source_type) ? data.source_type : null;
  if (!sourceType) return badRequest("Indicações manuais são permitidas para Clube ou produto.");
  const originalAmountCents = numberToCents(Math.max(0, Number(data?.original_amount || 0)));
  if (!originalAmountCents) return badRequest("Informe o valor original da venda.");
  const customerEmail = normalizeReferralEmail(data?.customer_email);
  const customerPhone = normalizeReferralPhone(data?.customer_phone);
  if (!customerEmail && !customerPhone) return badRequest("Informe ao menos e-mail ou telefone do cliente.");
  const customer = customerEmail
    ? await env.DB.prepare("SELECT id FROM customer_accounts WHERE email = ?").bind(customerEmail).first()
    : null;
  const otherDiscountCents = numberToCents(Math.max(0, Number(data?.other_discount || 0)));
  const validation = await validateReferralCode(env, setting.code, {
    customerId: customer?.id,
    email: customerEmail,
    phone: customerPhone,
    sourceType,
    originalAmountCents,
    otherDiscountCents
  });
  if (!validation.valid) return badRequest(validation.message || "Cupom de indicação indisponível.");
  const sourceReference = clean(data?.source_reference, 120) ||
    `MAN-${sourceType.toUpperCase()}-${new Date().getUTCFullYear()}-${randomHex(4).toUpperCase()}`;
  try {
    const referral = await createReferral(env, {
      setting: validation.setting,
      customerId: customer?.id,
      email: customerEmail,
      phone: customerPhone,
      sourceType,
      sourceReference,
      productId: integerOrNull(data?.product_id),
      originalAmountCents,
      otherDiscountAmountCents: validation.other_discount_amount_cents,
      discountAmountCents: validation.discount_amount_cents
    });
    const paymentStatus = ["approved", "cancelled", "refunded"].includes(data?.payment_status)
      ? data.payment_status : "pending";
    await syncReferralPaymentBySource(env, {
      sourceType,
      sourceReference,
      paymentStatus,
      paymentProvider: paymentStatus === "approved" ? "manual" : ""
    });
    return json(await referralDetail(env, referral.id), 201);
  } catch (error) {
    if (String(error).includes("REFERRAL_CUSTOMER_LIMIT")) return badRequest("Este cliente já atingiu o limite deste cupom de indicação.");
    if (String(error).includes("UNIQUE")) return badRequest("Já existe uma indicação com essa referência.");
    throw error;
  }
}

async function updateReferralPayment(request, env, id) {
  const data = await readBody(request);
  const current = await env.DB.prepare("SELECT * FROM partner_referrals WHERE id = ?").bind(id).first();
  if (!current) return notFound("Indicação não encontrada.");
  const status = ["pending", "approved", "cancelled", "refunded"].includes(data?.payment_status)
    ? data.payment_status : null;
  if (!status) return badRequest("Status de pagamento inválido.");
  await syncReferralPaymentBySource(env, {
    sourceType: current.source_type,
    sourceReference: current.source_reference,
    paymentStatus: status,
    paymentProvider: status === "approved" ? (current.payment_provider || "manual") : current.payment_provider,
    paidAmountCents: status === "approved" && data?.paid_amount != null
      ? numberToCents(Math.max(0, Number(data.paid_amount)))
      : undefined
  });
  return json(await referralDetail(env, id));
}

async function markReferralCommissionsPaid(request, env) {
  const data = await readBody(request);
  const ids = [...new Set((Array.isArray(data?.ids) ? data.ids : [])
    .map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, 100);
  if (!ids.length) return badRequest("Selecione ao menos uma comissão liberada.");
  const results = await env.DB.batch(ids.map(id => env.DB.prepare(`
    UPDATE partner_referrals
    SET commission_status = 'paid', commission_paid_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND payment_status = 'approved' AND commission_status = 'released'
  `).bind(id)));
  const changed = results.reduce((total, item) => total + Number(item?.meta?.changes || 0), 0);
  return json({ ok: true, paid: changed });
}

async function partnerReferralSummary(request, env, partner) {
  const setting = await env.DB.prepare(`
    SELECT s.*, p.name AS partner_name, p.active AS partner_active
    FROM partner_referral_settings s JOIN club_partners p ON p.id = s.partner_id
    WHERE s.partner_id = ? LIMIT 1
  `).bind(partner.id).first();
  if (!setting) return json({ configured: false, partner: { id: partner.id, name: partner.name } });
  const rows = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS total FROM partner_referrals WHERE partner_id = ?").bind(partner.id),
    env.DB.prepare("SELECT COUNT(*) AS total FROM partner_referrals WHERE partner_id = ? AND payment_status = 'approved'").bind(partner.id),
    env.DB.prepare("SELECT COALESCE(SUM(final_amount_cents), 0) AS total FROM partner_referrals WHERE partner_id = ? AND payment_status = 'approved'").bind(partner.id),
    env.DB.prepare("SELECT COALESCE(SUM(commission_amount_cents), 0) AS total FROM partner_referrals WHERE partner_id = ? AND commission_status = 'released'").bind(partner.id),
    env.DB.prepare("SELECT COALESCE(SUM(commission_amount_cents), 0) AS total FROM partner_referrals WHERE partner_id = ? AND commission_status = 'paid'").bind(partner.id),
    env.DB.prepare(`
      SELECT source_type, source_reference, final_amount_cents, commission_amount_cents,
        payment_status, commission_status, referred_at, payment_confirmed_at, commission_paid_at
      FROM partner_referrals WHERE partner_id = ? ORDER BY referred_at DESC LIMIT 30
    `).bind(partner.id)
  ]);
  const origin = new URL(request.url).origin;
  return json({
    configured: true,
    setting: referralConfigView(setting),
    link: `${origin}/pre-inscricao?ref=${encodeURIComponent(setting.code)}`,
    stats: {
      referrals: Number(rows[0].results[0]?.total || 0),
      approved: Number(rows[1].results[0]?.total || 0),
      total_sold_cents: Number(rows[2].results[0]?.total || 0),
      pending_commission_cents: Number(rows[3].results[0]?.total || 0),
      paid_commission_cents: Number(rows[4].results[0]?.total || 0)
    },
    recent: rows[5].results
  });
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
    const partner = await env.DB.prepare("SELECT id, active FROM club_partners WHERE id = ?").bind(id).first();
    if (!partner) return notFound(`${label} não encontrado.`);

    // Parceiros com qualquer histórico operacional/financeiro não são apagados.
    // Isso preserva auditoria de benefícios do Clube e, principalmente, indicações/comissões.
    const history = await env.DB.prepare(`
      SELECT
        EXISTS(SELECT 1 FROM club_redemptions WHERE partner_id = ? LIMIT 1) AS has_redemptions,
        EXISTS(SELECT 1 FROM partner_referrals WHERE partner_id = ? LIMIT 1) AS has_referrals
    `).bind(id, id).first();

    if (Number(history?.has_redemptions || 0) || Number(history?.has_referrals || 0)) {
      await env.DB.batch([
        env.DB.prepare("UPDATE club_partners SET active = 0 WHERE id = ?").bind(id),
        env.DB.prepare("UPDATE partner_referral_settings SET active = 0, updated_at = datetime('now') WHERE partner_id = ?").bind(id),
        env.DB.prepare("UPDATE club_benefits SET active = 0 WHERE partner_id = ?").bind(id),
        env.DB.prepare("UPDATE club_coupons SET active = 0 WHERE partner_id = ?").bind(id),
        env.DB.prepare("DELETE FROM club_partner_sessions WHERE partner_id = ?").bind(id)
      ]);
      return json({ ok: true, deactivated: true, preserved_history: true });
    }

    const results = await env.DB.batch([
      env.DB.prepare("DELETE FROM club_partner_sessions WHERE partner_id = ?").bind(id),
      env.DB.prepare("DELETE FROM partner_referral_settings WHERE partner_id = ?").bind(id),
      env.DB.prepare("DELETE FROM club_benefits WHERE partner_id = ?").bind(id),
      env.DB.prepare("DELETE FROM club_coupons WHERE partner_id = ?").bind(id),
      env.DB.prepare("DELETE FROM club_partners WHERE id = ?").bind(id)
    ]);
    if (!results[4]?.meta?.changes) return notFound(`${label} não encontrado.`);
    return json({ ok: true, deleted: true });
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

  if (path === "/api/admin/club/referral-configs") {
    if (method === "GET") return listReferralConfigs(env);
    if (method === "POST") return saveReferralConfig(request, env);
  }
  const referralConfigMatch = path.match(/^\/api\/admin\/club\/referral-configs\/(\d+)$/);
  if (referralConfigMatch && method === "PUT") {
    return saveReferralConfig(request, env, Number(referralConfigMatch[1]));
  }

  if (path === "/api/admin/club/referrals" && method === "GET") {
    return json(await listReferralRecords(request, env));
  }
  if (path === "/api/admin/club/referrals/manual" && method === "POST") {
    return createManualReferral(request, env);
  }
  if (path === "/api/admin/club/referrals/mark-paid" && method === "POST") {
    return markReferralCommissionsPaid(request, env);
  }
  const referralPaymentMatch = path.match(/^\/api\/admin\/club\/referrals\/(\d+)\/payment$/);
  if (referralPaymentMatch && method === "PUT") {
    return updateReferralPayment(request, env, Number(referralPaymentMatch[1]));
  }
  const referralMatch = path.match(/^\/api\/admin\/club\/referrals\/(\d+)$/);
  if (referralMatch && method === "GET") {
    const item = await referralDetail(env, Number(referralMatch[1]));
    return item ? json(item) : notFound("Indicação não encontrada.");
  }

  if (path === "/api/admin/club/redemption-options" && method === "GET") {
    return adminRedemptionOptions(request, env);
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

async function adminRedemptionOptions(request, env) {
  const memberId = Number(new URL(request.url).searchParams.get("member_id"));
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return badRequest("Selecione um associado válido.");
  }

  const member = await env.DB.prepare(`
    SELECT id, member_code, full_name, dog_name, valid_until, payment_status, status
    FROM club_members WHERE id = ?
  `).bind(memberId).first();

  if (!member) return notFound("Associado não encontrado.");
  if (!memberIsActive(member)) {
    return badRequest("Associação inativa, vencida ou com pagamento pendente.");
  }

  const [benefits, coupons] = await Promise.all([
    activeBenefits(env, member.id),
    activeCoupons(env, member.id)
  ]);

  return json({
    member: {
      id: member.id,
      member_code: member.member_code,
      full_name: member.full_name
    },
    benefits,
    coupons
  });
}

async function redeem(request, env, partner = null, admin = false) {
  const data = await readBody(request);
  if (!data) return badRequest("Não foi possível ler os dados da utilização.");

  const memberId = Number(data.member_id);
  const itemId = Number(data.item_id);
  const kind = data.kind;
  if (
    !Number.isInteger(memberId) || memberId <= 0 ||
    !Number.isInteger(itemId) || itemId <= 0 ||
    !["benefit", "coupon"].includes(kind)
  ) {
    return badRequest("Dados da utilização inválidos.");
  }

  const member = await env.DB.prepare("SELECT * FROM club_members WHERE id = ?").bind(memberId).first();
  if (!member) return notFound("Associado não encontrado.");
  if (!memberIsActive(member)) return badRequest("Associação inativa, vencida ou com pagamento pendente.");

  const amountBefore = Math.max(0, numberOrNull(data.amount_before) ?? 0);
  let discount = 0;
  let benefitId = null;
  let couponId = null;
  let redemptionPartnerId = partner?.id ?? null;
  let result;

  if (kind === "benefit") {
    let benefitStatement = `
      SELECT * FROM club_benefits
      WHERE id = ? AND active = 1
        AND (starts_on IS NULL OR starts_on <= date('now'))
        AND (ends_on IS NULL OR ends_on >= date('now'))
    `;
    const benefitValues = [itemId];
    if (!admin) {
      if (!partner?.id) return forbidden();
      benefitStatement += " AND partner_id = ?";
      benefitValues.push(partner.id);
    }

    const benefit = await env.DB.prepare(benefitStatement).bind(...benefitValues).first();
    if (!benefit) {
      return badRequest(admin
        ? "Esse benefício não está disponível ou está fora da validade."
        : "Benefício indisponível para este parceiro."
      );
    }

    benefitId = benefit.id;
    redemptionPartnerId = benefit.partner_id ?? redemptionPartnerId;

    if (benefit.benefit_type === "percentage") {
      discount = amountBefore * Number(benefit.value) / 100;
    } else if (benefit.benefit_type === "fixed") {
      discount = Number(benefit.value);
    } else if (benefit.benefit_type === "credit") {
      discount = amountBefore;
    }

    if (amountBefore > 0) discount = Math.min(amountBefore, Math.max(0, discount));
    else discount = Math.max(0, discount);
    discount = Math.round(discount * 100) / 100;

    const start = periodStart(benefit.period);
    const limit = benefit.usage_limit == null ? null : Number(benefit.usage_limit);

    // O limite é verificado dentro do mesmo INSERT. Isso evita duas utilizações
    // simultâneas ultrapassarem o limite mensal/anual do associado.
    result = await env.DB.prepare(`
      INSERT INTO club_redemptions (
        member_id, partner_id, benefit_id, coupon_id, amount_before,
        discount_amount, notes, redeemed_at
      )
      SELECT ?, ?, ?, NULL, ?, ?, ?, datetime('now')
      WHERE ? IS NULL OR (
        SELECT COUNT(*) FROM club_redemptions
        WHERE member_id = ? AND benefit_id = ?
          AND (? IS NULL OR redeemed_at >= ?)
      ) < ?
    `).bind(
      memberId, redemptionPartnerId, benefitId, amountBefore || null,
      discount, clean(data.notes, 500),
      limit, memberId, benefitId, start, start, limit
    ).run();

    if (!result.meta.changes) {
      return badRequest("O limite deste benefício já foi utilizado por este associado no período atual.");
    }
  } else {
    let couponStatement = `
      SELECT c.*
      FROM club_coupons c
      WHERE c.id = ? AND c.active = 1
        AND (c.member_id IS NULL OR c.member_id = ?)
        AND (c.starts_on IS NULL OR c.starts_on <= date('now'))
        AND (c.ends_on IS NULL OR c.ends_on >= date('now'))
    `;
    const couponValues = [itemId, memberId];
    if (!admin) {
      if (!partner?.id) return forbidden();
      couponStatement += " AND c.partner_id = ?";
      couponValues.push(partner.id);
    }

    const coupon = await env.DB.prepare(couponStatement).bind(...couponValues).first();
    if (!coupon) return badRequest("Cupom indisponível para este associado.");

    couponId = coupon.id;
    redemptionPartnerId = coupon.partner_id ?? redemptionPartnerId;
    discount = coupon.discount_type === "percentage"
      ? amountBefore * Number(coupon.discount_value) / 100
      : Number(coupon.discount_value);

    if (amountBefore > 0) discount = Math.min(amountBefore, Math.max(0, discount));
    else discount = Math.max(0, discount);
    discount = Math.round(discount * 100) / 100;

    const totalLimit = coupon.total_limit == null ? null : Number(coupon.total_limit);
    const memberLimit = Number(coupon.per_member_limit || 1);

    result = await env.DB.prepare(`
      INSERT INTO club_redemptions (
        member_id, partner_id, benefit_id, coupon_id, amount_before,
        discount_amount, notes, redeemed_at
      )
      SELECT ?, ?, NULL, ?, ?, ?, ?, datetime('now')
      WHERE
        (? IS NULL OR (SELECT COUNT(*) FROM club_redemptions WHERE coupon_id = ?) < ?)
        AND (SELECT COUNT(*) FROM club_redemptions WHERE coupon_id = ? AND member_id = ?) < ?
    `).bind(
      memberId, redemptionPartnerId, couponId, amountBefore || null,
      discount, clean(data.notes, 500),
      totalLimit, couponId, totalLimit,
      couponId, memberId, memberLimit
    ).run();

    if (!result.meta.changes) {
      return badRequest("Esse cupom já atingiu o limite permitido para este associado ou está esgotado.");
    }
  }

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
  if (path === "/api/partner/referrals" && method === "GET") return partnerReferralSummary(request, env, partner);
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
