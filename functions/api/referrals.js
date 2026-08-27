import { validateReferralCode, moneyTextToCents } from "../_lib/referrals.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

async function currentEventAmountCents(env) {
  const row = await env.DB.prepare("SELECT value FROM site_content WHERE key = 'event_price'").first();
  return moneyTextToCents(row?.value || "");
}

export async function handlePublicReferrals({ request, env, path, method }) {
  if (path !== "/api/referrals/validate" || method !== "POST") {
    return json({ error: "Rota de indicação não encontrada." }, 404);
  }
  const data = await readBody(request);
  const sourceType = data?.source_type === "event" ? "event" : "event";
  const originalAmountCents = sourceType === "event" ? await currentEventAmountCents(env) : 0;
  const result = await validateReferralCode(env, data?.code, {
    email: data?.email,
    phone: data?.phone,
    sourceType,
    originalAmountCents,
    otherDiscountCents: Number(data?.other_discount_cents || 0)
  });
  if (!result.valid) {
    return json({
      valid: false,
      code: result.code,
      reason: result.reason,
      message: result.message || "Cupom inválido ou indisponível. Verifique o código informado.",
      original_amount_cents: originalAmountCents
    });
  }
  return json({
    valid: true,
    code: result.code,
    partner_name: result.partner.name,
    discount_type: result.discount_type,
    discount_percentage: result.discount_percentage,
    discount_fixed_cents: result.discount_fixed_cents,
    original_amount_cents: result.original_amount_cents,
    discount_amount_cents: result.discount_amount_cents,
    final_amount_cents: result.final_amount_cents,
    message: result.discount_type === "percentage"
      ? `Cupom ${result.code} aplicado: você recebeu ${result.discount_percentage}% de desconto.`
      : `Cupom ${result.code} aplicado: você recebeu R$ ${(Number(result.discount_fixed_cents || 0) / 100).toFixed(2).replace(".", ",")} de desconto.`
  });
}
