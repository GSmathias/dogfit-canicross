const encoder = new TextEncoder();
const SESSION_COOKIE = "dogfit_client_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeEmail(value) {
  return clean(value, 180).toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

async function body(request) {
  try { return await request.json(); } catch { return null; }
}

function randomHex(bytes = 16) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map(value => value.toString(16).padStart(2, "0")).join("");
}

function hex(buffer) {
  return [...new Uint8Array(buffer)]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100000
  }, key, 256);
  return hex(bits);
}

function safeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function cookies(request) {
  return Object.fromEntries((request.headers.get("Cookie") || "")
    .split(";")
    .map(item => item.trim().split(/=(.*)/s).slice(0, 2))
    .filter(item => item[0]));
}

async function customerFromRequest(request, env) {
  const token = cookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(`
    SELECT a.*, s.id AS session_id
    FROM customer_sessions s
    JOIN customer_accounts a ON a.id = s.customer_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now')
  `).bind(tokenHash).first();
}

function publicCustomer(customer) {
  return {
    id: customer.id,
    email: customer.email,
    full_name: customer.full_name,
    birth_date: customer.birth_date,
    phone: customer.phone,
    dog_name: customer.dog_name,
    dog_breed: customer.dog_breed,
    dog_count: customer.dog_count,
    sociability: customer.sociability
  };
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

async function createSession(env, customerId) {
  const token = `${crypto.randomUUID()}.${randomHex(24)}`;
  const tokenHash = await sha256(token);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM customer_sessions WHERE expires_at <= datetime('now')"),
    env.DB.prepare(`
      INSERT INTO customer_sessions (customer_id, token_hash, expires_at)
      VALUES (?, ?, datetime('now', '+30 days'))
    `).bind(customerId, tokenHash)
  ]);
  return token;
}

function validateProfile(data, passwordRequired = false) {
  const email = normalizeEmail(data?.email);
  if (!clean(data?.full_name, 180)) return "Informe o nome completo.";
  if (!validEmail(email)) return "Informe um e-mail válido.";
  if (!clean(data?.phone, 30)) return "Informe um número para contato.";
  if (passwordRequired && clean(data?.password, 120).length < 8) {
    return "A senha precisa ter pelo menos 8 caracteres.";
  }
  return "";
}

async function currentEvent(env) {
  const keys = ["event_title", "event_date", "event_time", "event_location", "event_price", "event_status"];
  const placeholders = keys.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM site_content WHERE key IN (${placeholders})`
  ).bind(...keys).all();
  const values = Object.fromEntries(results.map(row => [row.key, row.value]));
  return {
    title: values.event_title || "DOGFIT CANICROSS EXPERIENCE",
    date: validDate(values.event_date) || null,
    time: values.event_time || "",
    location: values.event_location || "Anápolis - GO",
    price: values.event_price || "",
    status: values.event_status || "open"
  };
}

function registrationCode() {
  return `PRE-${new Date().getUTCFullYear()}-${randomHex(3).toUpperCase()}`;
}

function eventAmount(value) {
  let normalized = clean(value, 50).replace(/[^0-9,.-]/g, "");
  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
}

async function mercadoPagoRequest(env, pathname, options = {}) {
  const accessToken = clean(env.MERCADOPAGO_ACCESS_TOKEN, 1000);
  if (!accessToken) throw new Error("MERCADOPAGO_ACCESS_TOKEN_NOT_CONFIGURED");
  const response = await fetch(`https://api.mercadopago.com${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Erro Mercado Pago:", response.status, JSON.stringify(result));
    throw new Error("MERCADOPAGO_REQUEST_FAILED");
  }
  return result;
}

async function createPaymentPreference(request, env, registration, event) {
  const amount = eventAmount(event.price);
  if (!amount) throw new Error("INVALID_EVENT_PRICE");
  const origin = new URL(request.url).origin;
  const nameParts = registration.full_name.split(/\s+/).filter(Boolean);
  const firstName = nameParts.shift() || registration.full_name;
  const surname = nameParts.join(" ") || firstName;
  return mercadoPagoRequest(env, "/checkout/preferences", {
    method: "POST",
    headers: { "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      items: [{
        id: registration.registration_code,
        title: `Inscrição ${event.title}`.slice(0, 250),
        description: `Participante: ${registration.full_name}`.slice(0, 250),
        category_id: "tickets",
        quantity: 1,
        currency_id: "BRL",
        unit_price: amount
      }],
      payer: {
        name: firstName,
        surname,
        email: registration.email
      },
      external_reference: registration.registration_code,
      statement_descriptor: "DOGFIT CANICROSS",
      back_urls: {
        success: `${origin}/pagamento/retorno`,
        pending: `${origin}/?pagamento=pendente#eventos`,
        failure: `${origin}/?pagamento=erro#eventos`
      },
      auto_return: "approved",
      notification_url: `${origin}/api/payments/mercadopago`,
      metadata: {
        registration_code: registration.registration_code,
        dog_name: registration.dog_name
      }
    })
  });
}

async function paymentFromMercadoPago(env, paymentId) {
  if (!/^\d+$/.test(String(paymentId || ""))) return null;
  return mercadoPagoRequest(env, `/v1/payments/${paymentId}`, { method: "GET" });
}

async function confirmMercadoPagoPayment(env, payment) {
  if (!payment || payment.status !== "approved") return false;
  const code = clean(payment.external_reference, 80);
  if (!/^PRE-\d{4}-[A-F0-9]{6}$/.test(code)) return false;
  const reference = `Mercado Pago #${payment.id}`;
  const result = await env.DB.prepare(`
    UPDATE event_registrations
    SET payment_status = 'paid',
      notes = CASE
        WHEN notes LIKE ? THEN notes
        WHEN notes = '' THEN ?
        ELSE notes || char(10) || ?
      END,
      updated_at = datetime('now')
    WHERE registration_code = ?
  `).bind(`%${reference}%`, reference, reference, code).run();
  return Boolean(result.meta.changes);
}

function whatsappConfirmationUrl(code) {
  const message = `Inscrição realizada com sucesso! Código: ${code}. Realizei o pagamento pelo Mercado Pago e gostaria de finalizar minha inscrição.`;
  return `https://wa.me/5562994431333?text=${encodeURIComponent(message)}`;
}

async function handleMercadoPagoWebhook(request, env) {
  const url = new URL(request.url);
  const payload = request.method === "POST" ? await body(request) : null;
  const paymentId = payload?.data?.id || url.searchParams.get("data.id") ||
    url.searchParams.get("id");
  if (!paymentId) return json({ ok: true });
  try {
    const payment = await paymentFromMercadoPago(env, paymentId);
    await confirmMercadoPagoPayment(env, payment);
  } catch (caught) {
    console.error("Falha ao processar webhook Mercado Pago:", caught);
  }
  return json({ ok: true });
}

async function handlePaymentReturn(request, env) {
  const url = new URL(request.url);
  const paymentId = url.searchParams.get("payment_id") || url.searchParams.get("collection_id");
  try {
    const payment = await paymentFromMercadoPago(env, paymentId);
    const confirmed = await confirmMercadoPagoPayment(env, payment);
    if (confirmed || payment?.status === "approved") {
      return Response.redirect(whatsappConfirmationUrl(clean(payment.external_reference, 80)), 302);
    }
  } catch (caught) {
    console.error("Falha ao validar retorno Mercado Pago:", caught);
  }
  return Response.redirect(`${url.origin}/?pagamento=pendente#eventos`, 302);
}

async function registerForEvent(request, env) {
  const data = await body(request);
  const email = normalizeEmail(data?.email);
  const dogCount = Math.max(1, Math.min(10, Number.parseInt(data?.dog_count, 10) || 1));
  const sociability = ["social", "selective", "reactive", "unknown"].includes(data?.sociability)
    ? data.sociability : "unknown";
  const required = [
    [clean(data?.full_name, 180), "Informe o nome completo."],
    [validDate(data?.birth_date), "Informe a data de nascimento."],
    [clean(data?.phone, 30), "Informe o número para contato."],
    [validEmail(email), "Informe um e-mail válido."],
    [clean(data?.dog_name, 120), "Informe o nome do cachorro."],
    [clean(data?.dog_breed, 120), "Informe a raça do cachorro."]
  ];
  const invalid = required.find(([value]) => !value);
  if (invalid) return error(invalid[1]);
  if (data?.recreational_terms_accepted !== true || data?.muzzle_terms_accepted !== true) {
    return error("É necessário aceitar os dois termos de participação.");
  }
  if (data?.privacy_accepted !== true) {
    return error("É necessário autorizar o tratamento dos dados da inscrição.");
  }
  const event = await currentEvent(env);
  if (event.status === "soldout") return error("As inscrições deste evento estão encerradas.", 409);
  const customer = await customerFromRequest(request, env);
  const existing = customer || await env.DB.prepare(
    "SELECT id FROM customer_accounts WHERE email = ?"
  ).bind(email).first();
  let code = registrationCode();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const registration = {
        registration_code: code,
        full_name: clean(data.full_name, 180),
        email,
        phone: clean(data.phone, 30),
        dog_name: clean(data.dog_name, 120),
        dog_count: dogCount,
        sociability
      };
      await env.DB.prepare(`
        INSERT INTO event_registrations (
          registration_code, customer_id, event_title, event_date, event_time,
          event_location, event_price, full_name, birth_date, phone, email,
          dog_name, dog_breed, dog_count, sociability,
          recreational_terms_accepted, muzzle_terms_accepted, privacy_accepted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1)
      `).bind(
        code, existing?.id || null, event.title, event.date, event.time,
        event.location, event.price, clean(data.full_name, 180), data.birth_date,
        clean(data.phone, 30), email, clean(data.dog_name, 120),
        clean(data.dog_breed, 120), dogCount, sociability
      ).run();
      let preference;
      try {
        preference = await createPaymentPreference(request, env, registration, event);
      } catch (paymentError) {
        await env.DB.prepare("DELETE FROM event_registrations WHERE registration_code = ?")
          .bind(code).run();
        if (String(paymentError).includes("NOT_CONFIGURED")) {
          return error("Pagamento ainda não configurado. Entre em contato com a DOGFIT.", 503);
        }
        if (String(paymentError).includes("INVALID_EVENT_PRICE")) {
          return error("O valor do próximo evento precisa ser corrigido pela DOGFIT.", 503);
        }
        return error("Não foi possível abrir o pagamento. Tente novamente.", 502);
      }
      return json({
        ok: true,
        registration_code: code,
        payment_url: preference.init_point,
        message: "Pré-inscrição realizada com sucesso!"
      }, 201);
    } catch (caught) {
      if (!String(caught).includes("UNIQUE") || attempt === 2) throw caught;
      code = registrationCode();
    }
  }
  return error("Não foi possível gerar a pré-inscrição.", 500);
}

async function registerCustomer(request, env) {
  const data = await body(request);
  const validation = validateProfile(data, true);
  if (validation) return error(validation);
  if (data?.privacy_accepted !== true) {
    return error("É necessário autorizar o armazenamento dos dados da conta.");
  }
  const email = normalizeEmail(data.email);
  const salt = randomHex(16);
  const hash = await passwordHash(clean(data.password, 120), salt);
  const sociability = ["social", "selective", "reactive", "unknown"].includes(data.sociability)
    ? data.sociability : "unknown";
  try {
    const result = await env.DB.prepare(`
      INSERT INTO customer_accounts (
        email, full_name, birth_date, phone, dog_name, dog_breed, dog_count,
        sociability, password_salt, password_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      email, clean(data.full_name, 180), validDate(data.birth_date) || null,
      clean(data.phone, 30), clean(data.dog_name, 120), clean(data.dog_breed, 120),
      Math.max(1, Math.min(10, Number.parseInt(data.dog_count, 10) || 1)),
      sociability, salt, hash
    ).run();
    const customerId = result.meta.last_row_id;
    await env.DB.batch([
      env.DB.prepare("UPDATE event_registrations SET customer_id = ? WHERE customer_id IS NULL AND lower(email) = ?")
        .bind(customerId, email),
      env.DB.prepare("UPDATE club_members SET customer_id = ? WHERE customer_id IS NULL AND lower(email) = ?")
        .bind(customerId, email)
    ]);
    const token = await createSession(env, customerId);
    const customer = await env.DB.prepare("SELECT * FROM customer_accounts WHERE id = ?").bind(customerId).first();
    return json({ customer: publicCustomer(customer) }, 201, { "Set-Cookie": sessionCookie(token) });
  } catch (caught) {
    if (String(caught).includes("UNIQUE")) return error("Já existe uma conta com este e-mail.", 409);
    throw caught;
  }
}

async function loginCustomer(request, env) {
  const data = await body(request);
  const email = normalizeEmail(data?.email);
  const password = clean(data?.password, 120);
  if (!validEmail(email) || !password) return error("Informe e-mail e senha.");
  const customer = await env.DB.prepare("SELECT * FROM customer_accounts WHERE email = ?")
    .bind(email).first();
  if (!customer) return error("E-mail ou senha incorretos.", 401);
  const candidate = await passwordHash(password, customer.password_salt);
  if (!safeEqual(candidate, customer.password_hash)) return error("E-mail ou senha incorretos.", 401);
  await env.DB.batch([
    env.DB.prepare("UPDATE event_registrations SET customer_id = ? WHERE customer_id IS NULL AND lower(email) = ?")
      .bind(customer.id, email),
    env.DB.prepare("UPDATE club_members SET customer_id = ? WHERE customer_id IS NULL AND lower(email) = ?")
      .bind(customer.id, email)
  ]);
  const token = await createSession(env, customer.id);
  return json({ customer: publicCustomer(customer) }, 200, { "Set-Cookie": sessionCookie(token) });
}

async function updateCustomer(request, env, customer) {
  const data = await body(request);
  const validation = validateProfile({ ...data, email: customer.email });
  if (validation) return error(validation);
  const sociability = ["social", "selective", "reactive", "unknown"].includes(data.sociability)
    ? data.sociability : "unknown";
  await env.DB.prepare(`
    UPDATE customer_accounts SET full_name = ?, birth_date = ?, phone = ?,
      dog_name = ?, dog_breed = ?, dog_count = ?, sociability = ?,
      updated_at = datetime('now') WHERE id = ?
  `).bind(
    clean(data.full_name, 180), validDate(data.birth_date) || null,
    clean(data.phone, 30), clean(data.dog_name, 120), clean(data.dog_breed, 120),
    Math.max(1, Math.min(10, Number.parseInt(data.dog_count, 10) || 1)),
    sociability, customer.id
  ).run();
  const updated = await env.DB.prepare("SELECT * FROM customer_accounts WHERE id = ?")
    .bind(customer.id).first();
  return json({ customer: publicCustomer(updated) });
}

async function customerDashboard(env, customer) {
  const [registrations, member, partners] = await Promise.all([
    env.DB.prepare(`
      SELECT registration_code, event_title, event_date, event_time, event_location,
        event_price, dog_name, dog_count, payment_status, created_at
      FROM event_registrations WHERE customer_id = ? ORDER BY created_at DESC
    `).bind(customer.id).all(),
    env.DB.prepare(`
      SELECT member_code, public_token, full_name, dog_name, plan_name, monthly_fee,
        joined_on, valid_until, payment_status, status
      FROM club_members
      WHERE customer_id = ? OR lower(email) = ?
      ORDER BY id DESC LIMIT 1
    `).bind(customer.id, customer.email).first(),
    env.DB.prepare(`
      SELECT p.id, p.name, p.category, p.phone, p.address, p.instagram, p.description,
        GROUP_CONCAT(b.title || CASE WHEN b.value > 0 AND b.benefit_type = 'percentage'
          THEN ' (' || CAST(b.value AS TEXT) || '%)' ELSE '' END, ' • ') AS benefits
      FROM club_partners p
      LEFT JOIN club_benefits b ON b.partner_id = p.id AND b.active = 1
      WHERE p.active = 1 AND p.public_visible = 1
      GROUP BY p.id ORDER BY p.category, p.name COLLATE NOCASE
    `).all()
  ]);
  const memberActive = member && member.status === "active" && member.payment_status === "paid" &&
    (!member.valid_until || member.valid_until >= new Date().toISOString().slice(0, 10));
  return json({
    customer: publicCustomer(customer),
    registrations: registrations.results,
    member: member ? {
      ...member,
      active: memberActive,
      card_url: `/clube/${member.public_token}`
    } : null,
    partners: memberActive ? partners.results : []
  });
}

async function listAdminRegistrations(request, env) {
  const url = new URL(request.url);
  const query = clean(url.searchParams.get("q"), 100);
  const status = clean(url.searchParams.get("status"), 20);
  const like = `%${query}%`;
  const { results } = await env.DB.prepare(`
    SELECT * FROM event_registrations
    WHERE (? = '' OR full_name LIKE ? OR email LIKE ? OR phone LIKE ? OR
      dog_name LIKE ? OR registration_code LIKE ?)
      AND (? = '' OR payment_status = ?)
    ORDER BY created_at DESC LIMIT 500
  `).bind(query, like, like, like, like, like, status, status).all();
  return json(results);
}

async function updateAdminRegistration(request, env, id) {
  const data = await body(request);
  const status = ["pending", "paid", "cancelled"].includes(data?.payment_status)
    ? data.payment_status : null;
  if (!status) return error("Status inválido.");
  const result = await env.DB.prepare(`
    UPDATE event_registrations SET payment_status = ?, notes = ?,
      updated_at = datetime('now') WHERE id = ?
  `).bind(status, clean(data.notes, 1000), id).run();
  if (!result.meta.changes) return error("Inscrição não encontrada.", 404);
  return json(await env.DB.prepare("SELECT * FROM event_registrations WHERE id = ?").bind(id).first());
}

export async function handlePublicEvent({ request, env, ctx, path, method }) {
  if (path === "/api/events/register" && method === "POST") {
    return registerForEvent(request, env);
  }
  return error("Rota não encontrada.", 404);
}

export async function handlePayments({ request, env, path, method }) {
  if (path === "/api/payments/mercadopago" && (method === "POST" || method === "GET")) {
    return handleMercadoPagoWebhook(request, env);
  }
  if (path === "/pagamento/retorno" && method === "GET") {
    return handlePaymentReturn(request, env);
  }
  return error("Rota de pagamento não encontrada.", 404);
}

export async function handleClient({ request, env, path, method }) {
  if (path === "/api/client/register" && method === "POST") return registerCustomer(request, env);
  if (path === "/api/client/login" && method === "POST") return loginCustomer(request, env);
  const customer = await customerFromRequest(request, env);
  if (!customer) return error("Faça login para continuar.", 401);
  if (path === "/api/client/dashboard" && method === "GET") return customerDashboard(env, customer);
  if (path === "/api/client/me" && method === "PUT") return updateCustomer(request, env, customer);
  if (path === "/api/client/logout" && method === "POST") {
    await env.DB.prepare("DELETE FROM customer_sessions WHERE id = ?").bind(customer.session_id).run();
    return json({ ok: true }, 200, {
      "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
    });
  }
  return error("Rota não encontrada.", 404);
}

export async function handleAdminRegistrations({ request, env, path, method }) {
  if (path === "/api/admin/registrations" && method === "GET") {
    return listAdminRegistrations(request, env);
  }
  const match = path.match(/^\/api\/admin\/registrations\/(\d+)$/);
  if (match && method === "PUT") {
    return updateAdminRegistration(request, env, Number(match[1]));
  }
  return error("Rota de inscrições não encontrada.", 404);
}
