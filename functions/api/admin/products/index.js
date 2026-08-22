import { json, badRequest } from "../../../_lib/http.js";

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT
      id, name, price, club_price, description, image_url, active, sort_order,
      category, stock_status, badge, featured, created_at, updated_at
    FROM products
    ORDER BY sort_order ASC, id DESC
  `).all();

  return json(results);
}

export async function onRequestPost({ request, env }) {
  const data = await request.json();
  if (!data.name?.trim()) return badRequest("Nome do produto é obrigatório.");

  const result = await env.DB.prepare(`
    INSERT INTO products (
      name, price, club_price, description, image_url, active, sort_order,
      category, stock_status, badge, featured, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    data.name.trim(),
    data.price ?? null,
    data.club_price ?? null,
    data.description ?? "",
    data.image_url ?? "",
    data.active === false ? 0 : 1,
    data.sort_order ?? 0,
    data.category ?? "Outros",
    data.stock_status ?? "available",
    data.badge ?? "",
    data.featured ? 1 : 0
  ).run();

  return json(
    await env.DB.prepare("SELECT * FROM products WHERE id = ?")
      .bind(result.meta.last_row_id)
      .first(),
    201
  );
}
