import { json, badRequest, notFound } from "../../../_lib/http.js";
import { deleteMediaUrl } from "../../../_lib/media.js";

export async function onRequestPut({ request, env, params }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return badRequest("ID inválido.");

  const data = await request.json();
  if (!data.name?.trim()) return badRequest("Nome do produto é obrigatório.");

  const previous = await env.DB.prepare("SELECT image_url FROM products WHERE id = ?")
    .bind(id).first();
  if (!previous) return notFound("Produto não encontrado.");

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

  if (previous.image_url && previous.image_url !== (data.image_url ?? "")) {
    try { await deleteMediaUrl(env, previous.image_url); }
    catch (caught) { console.error("Falha ao limpar imagem antiga do produto:", caught); }
  }

  return json(
    await env.DB.prepare("SELECT * FROM products WHERE id = ?")
      .bind(id)
      .first()
  );
}

export async function onRequestDelete({ env, params }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return badRequest("ID inválido.");

  const product = await env.DB.prepare("SELECT image_url FROM products WHERE id = ?")
    .bind(id).first();
  if (!product) return notFound("Produto não encontrado.");

  const result = await env.DB.prepare(
    "DELETE FROM products WHERE id = ?"
  ).bind(id).run();

  if (!result.meta.changes) return notFound("Produto não encontrado.");

  if (product.image_url) {
    try { await deleteMediaUrl(env, product.image_url); }
    catch (caught) { console.error("Falha ao apagar imagem do produto no R2:", caught); }
  }

  return new Response(null, { status: 204 });
}
