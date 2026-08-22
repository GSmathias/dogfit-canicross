import { json, badRequest, notFound } from "../../../_lib/http.js";

export async function onRequestPut({ request, env, params }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return badRequest("ID inválido.");

  const data = await request.json();
  if (!data.name?.trim()) return badRequest("Nome do produto é obrigatório.");

  const result = await env.DB.prepare(`
    UPDATE products
    SET
      name = ?,
      price = ?,
      club_price = ?,
      description = ?,
      image_url = ?,
      active = ?,
      sort_order = ?,
      category = ?,
      stock_status = ?,
      badge = ?,
      featured = ?,
      updated_at = datetime('now')
    WHERE id = ?
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
    data.featured ? 1 : 0,
    id
  ).run();

  if (!result.meta.changes) return notFound("Produto não encontrado.");

  return json(
    await env.DB.prepare("SELECT * FROM products WHERE id = ?")
      .bind(id)
      .first()
  );
}

export async function onRequestDelete({ env, params }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return badRequest("ID inválido.");

  const result = await env.DB.prepare(
    "DELETE FROM products WHERE id = ?"
  ).bind(id).run();

  if (!result.meta.changes) return notFound("Produto não encontrado.");

  return new Response(null, { status: 204 });
}
