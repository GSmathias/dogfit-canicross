import { json, badRequest } from "../../../_lib/http.js";

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT id, image_url, caption, active, sort_order, created_at
    FROM gallery
    ORDER BY sort_order ASC, id DESC
  `).all();
  return json(results);
}

export async function onRequestPost({ request, env }) {
  const data = await request.json();
  if (!data.image_url) return badRequest("Imagem é obrigatória.");

  const result = await env.DB.prepare(`
    INSERT INTO gallery (image_url, caption, active, sort_order, created_at)
    VALUES (?, ?, 1, ?, datetime('now'))
  `).bind(data.image_url, data.caption ?? "", data.sort_order ?? 0).run();

  return json(
    await env.DB.prepare("SELECT * FROM gallery WHERE id = ?").bind(result.meta.last_row_id).first(),
    201
  );
}
