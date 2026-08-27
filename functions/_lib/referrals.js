export function cleanReferralCode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 40);
}

export function normalizeReferralEmail(value) {
  return String(value ?? "").trim().toLowerCase().slice(0, 180);
}

export function normalizeReferralPhone(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 13);
}

export function moneyTextToCents(value) {
  if (Number.isInteger(value)) return Math.max(0, value);
  let normalized = String(value ?? "").trim().replace(/[^0-9,.-]/g, "");
  if (!normalized) return 0;
  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
}

export function numberToCents(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : 0;
}

export function percentageFromBps(value) {
  return Math.max(0, Number(value || 0)) / 100;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export async function referralSettingByCode(env, rawCode) {
  const code = cleanReferralCode(rawCode);
  if (!code) return null;
  return env.DB.prepare(`
    SELECT s.*, p.name AS partner_name, p.active AS partner_active
    FROM partner_referral_settings s
    JOIN club_partners p ON p.id = s.partner_id
    WHERE s.code = ? COLLATE NOCASE
    LIMIT 1
  `).bind(code).first();
}

export async function referralSettingById(env, id) {
  const settingId = Number(id);
  if (!Number.isInteger(settingId) || settingId <= 0) return null;
  return env.DB.prepare(`
    SELECT s.*, p.name AS partner_name, p.active AS partner_active
    FROM partner_referral_settings s
    JOIN club_partners p ON p.id = s.partner_id
    WHERE s.id = ?
  `).bind(settingId).first();
}

export function referralDiscount(setting, originalAmountCents) {
  const original = Math.max(0, Math.trunc(Number(originalAmountCents) || 0));
  if (!setting || !original) return 0;
  const raw = setting.customer_discount_type === "fixed"
    ? Math.max(0, Number(setting.customer_discount_cents || 0))
    : Math.round(original * Math.max(0, Number(setting.customer_discount_bps || 0)) / 10000);
  return Math.min(original, Math.trunc(raw));
}

export function referralCommission(setting, sourceType, finalPaidCents) {
  if (!setting) return 0;
  if (sourceType === "event") return Math.max(0, Math.trunc(Number(setting.event_commission_cents || 0)));
  if (sourceType === "club") return Math.max(0, Math.trunc(Number(setting.club_commission_cents || 0)));
  if (sourceType === "product") {
    return Math.max(0, Math.round(
      Math.max(0, Math.trunc(Number(finalPaidCents) || 0)) *
      Math.max(0, Number(setting.product_commission_bps || 0)) / 10000
    ));
  }
  return 0;
}

export async function validateReferralCode(env, rawCode, options = {}) {
  const code = cleanReferralCode(rawCode);
  if (!code) return { valid: false, code: "", reason: "EMPTY", message: "" };
  const setting = await referralSettingByCode(env, code);
  if (!setting) {
    return { valid: false, code, reason: "NOT_FOUND", message: "Cupom inválido ou indisponível. Verifique o código informado." };
  }
  if (!Number(setting.active) || !Number(setting.partner_active)) {
    return { valid: false, code, reason: "INACTIVE", message: "Este cupom de indicação está desativado." };
  }
  if (setting.valid_until && setting.valid_until < todayUtc()) {
    return { valid: false, code, reason: "EXPIRED", message: "Este cupom de indicação está vencido." };
  }
  const otherDiscountCents = Math.max(0, Math.trunc(Number(options.otherDiscountCents) || 0));
  if (otherDiscountCents > 0 && !Number(setting.allow_stacking)) {
    return { valid: false, code, reason: "STACKING_NOT_ALLOWED", message: "Este cupom de indicação não pode ser acumulado com outro desconto." };
  }

  const customerId = Number(options.customerId);
  const email = normalizeReferralEmail(options.email);
  const phone = normalizeReferralPhone(options.phone);
  if ((Number.isInteger(customerId) && customerId > 0) || email || phone) {
    const row = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM partner_referrals
      WHERE referral_setting_id = ?
        AND commission_status <> 'cancelled'
        AND (
          (? > 0 AND customer_id = ?)
          OR (? <> '' AND customer_email = ?)
          OR (? <> '' AND customer_phone = ?)
        )
    `).bind(
      setting.id,
      Number.isInteger(customerId) && customerId > 0 ? customerId : 0,
      Number.isInteger(customerId) && customerId > 0 ? customerId : 0,
      email, email,
      phone, phone
    ).first();
    if (Number(row?.total || 0) >= Number(setting.per_customer_limit || 1)) {
      return { valid: false, code, reason: "CUSTOMER_LIMIT", message: "Este cupom de indicação já atingiu o limite de uso para este cliente." };
    }
  }

  const originalAmountCents = Math.max(0, Math.trunc(Number(options.originalAmountCents) || 0));
  const referralBaseCents = Math.max(0, originalAmountCents - otherDiscountCents);
  const discountAmountCents = referralDiscount(setting, referralBaseCents);
  return {
    valid: true,
    code,
    reason: "OK",
    message: `Cupom ${code} aplicado.`,
    setting,
    partner: { id: setting.partner_id, name: setting.partner_name },
    discount_type: setting.customer_discount_type,
    discount_percentage: percentageFromBps(setting.customer_discount_bps),
    discount_fixed_cents: Number(setting.customer_discount_cents || 0),
    original_amount_cents: originalAmountCents,
    other_discount_amount_cents: otherDiscountCents,
    discount_amount_cents: discountAmountCents,
    final_amount_cents: Math.max(0, originalAmountCents - otherDiscountCents - discountAmountCents)
  };
}

export async function createReferral(env, data) {
  const setting = data.setting;
  if (!setting) throw new Error("REFERRAL_SETTING_REQUIRED");
  const customerId = Number(data.customerId);
  const normalizedCustomerId = Number.isInteger(customerId) && customerId > 0 ? customerId : null;
  const email = normalizeReferralEmail(data.email);
  const phone = normalizeReferralPhone(data.phone);
  const sourceType = ["event", "club", "product"].includes(data.sourceType) ? data.sourceType : "";
  const sourceReference = String(data.sourceReference ?? "").trim().slice(0, 120);
  if (!sourceType || !sourceReference) throw new Error("REFERRAL_SOURCE_REQUIRED");

  const original = Math.max(0, Math.trunc(Number(data.originalAmountCents) || 0));
  const otherDiscount = Math.min(original, Math.max(0, Math.trunc(Number(data.otherDiscountAmountCents) || 0)));
  const discount = Math.min(Math.max(0, original - otherDiscount), Math.max(0, Math.trunc(Number(data.discountAmountCents) || 0)));
  const finalAmount = Math.max(0, original - otherDiscount - discount);
  const limit = Math.max(1, Math.trunc(Number(setting.per_customer_limit) || 1));

  const result = await env.DB.prepare(`
    INSERT INTO partner_referrals (
      referral_setting_id, partner_id, code_snapshot, partner_name_snapshot,
      customer_id, customer_email, customer_phone, source_type, source_reference,
      event_registration_id, club_member_id, product_id,
      original_amount_cents, other_discount_amount_cents, discount_amount_cents, final_amount_cents,
      event_commission_cents_snapshot, club_commission_cents_snapshot, product_commission_bps_snapshot,
      commission_amount_cents, payment_status, commission_status, referred_at, updated_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', 'pending', datetime('now'), datetime('now')
    WHERE (
      SELECT COUNT(*) FROM partner_referrals
      WHERE referral_setting_id = ? AND commission_status <> 'cancelled'
        AND (
          (? > 0 AND customer_id = ?)
          OR (? <> '' AND customer_email = ?)
          OR (? <> '' AND customer_phone = ?)
        )
    ) < ?
  `).bind(
    setting.id, setting.partner_id, setting.code, setting.partner_name,
    normalizedCustomerId, email, phone, sourceType, sourceReference,
    data.eventRegistrationId || null, data.clubMemberId || null, data.productId || null,
    original, otherDiscount, discount, finalAmount,
    Math.max(0, Math.trunc(Number(setting.event_commission_cents) || 0)),
    Math.max(0, Math.trunc(Number(setting.club_commission_cents) || 0)),
    Math.max(0, Math.trunc(Number(setting.product_commission_bps) || 0)),
    setting.id,
    normalizedCustomerId || 0, normalizedCustomerId || 0,
    email, email,
    phone, phone,
    limit
  ).run();

  if (!result.meta.changes) throw new Error("REFERRAL_CUSTOMER_LIMIT");
  return env.DB.prepare("SELECT * FROM partner_referrals WHERE id = ?")
    .bind(result.meta.last_row_id).first();
}

export function normalizeReferralPaymentStatus(value) {
  const status = String(value ?? "").toLowerCase();
  if (["approved", "paid"].includes(status)) return "approved";
  if (["refunded", "charged_back"].includes(status)) return "refunded";
  if (["cancelled", "canceled", "rejected", "expired"].includes(status)) return "cancelled";
  return "pending";
}

export async function syncReferralPaymentBySource(env, data) {
  const sourceType = ["event", "club", "product"].includes(data.sourceType) ? data.sourceType : "";
  const sourceReference = String(data.sourceReference ?? "").trim().slice(0, 120);
  if (!sourceType || !sourceReference) return null;

  const referral = await env.DB.prepare(`
    SELECT r.*
    FROM partner_referrals r
    WHERE r.source_type = ? AND r.source_reference = ?
  `).bind(sourceType, sourceReference).first();
  if (!referral) return null;

  const paymentStatus = normalizeReferralPaymentStatus(data.paymentStatus);
  // Webhooks podem chegar fora de ordem. Estados financeiros terminais não podem
  // ser reabertos por uma notificação antiga, e um pagamento já aprovado não
  // volta para pendente. Cancelamento/reembolso recebidos depois da aprovação
  // continuam prevalecendo e cancelam a comissão.
  if (["cancelled", "refunded"].includes(referral.payment_status) &&
      !["cancelled", "refunded"].includes(paymentStatus)) {
    return referral;
  }
  if (referral.payment_status === "approved" && paymentStatus === "pending") {
    return referral;
  }
  const provider = String(data.paymentProvider ?? referral.payment_provider ?? "").trim().slice(0, 40);
  const transactionId = String(data.paymentTransactionId ?? referral.payment_transaction_id ?? "").trim().slice(0, 120);
  const paidCents = Math.max(0, Math.trunc(Number(data.paidAmountCents ?? referral.final_amount_cents) || 0));

  let commissionStatus = referral.commission_status;
  let commissionAmount = Number(referral.commission_amount_cents || 0);
  let confirmedAt = referral.payment_confirmed_at;
  let paidAt = referral.commission_paid_at;

  if (paymentStatus === "approved") {
    commissionAmount = referralCommission({
      event_commission_cents: referral.event_commission_cents_snapshot,
      club_commission_cents: referral.club_commission_cents_snapshot,
      product_commission_bps: referral.product_commission_bps_snapshot
    }, sourceType, paidCents);
    if (commissionStatus !== "paid") commissionStatus = "released";
    confirmedAt = data.confirmedAt || confirmedAt || new Date().toISOString();
  } else if (paymentStatus === "cancelled" || paymentStatus === "refunded") {
    commissionStatus = "cancelled";
  } else if (commissionStatus !== "paid") {
    commissionStatus = "pending";
    commissionAmount = 0;
    confirmedAt = null;
  }

  try {
    await env.DB.prepare(`
      UPDATE partner_referrals SET
        payment_status = ?, final_amount_cents = ?, commission_amount_cents = ?,
        commission_status = ?, payment_provider = ?, payment_transaction_id = ?,
        payment_confirmed_at = ?, commission_paid_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      paymentStatus, paidCents, commissionAmount, commissionStatus,
      provider, transactionId, confirmedAt, paidAt, referral.id
    ).run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new Error("REFERRAL_PAYMENT_DUPLICATE");
    throw error;
  }

  return env.DB.prepare("SELECT * FROM partner_referrals WHERE id = ?").bind(referral.id).first();
}

export async function cancelReferralBySource(env, sourceType, sourceReference) {
  return syncReferralPaymentBySource(env, {
    sourceType,
    sourceReference,
    paymentStatus: "cancelled"
  });
}
