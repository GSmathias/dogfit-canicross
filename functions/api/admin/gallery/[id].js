import { json, badRequest, notFound } from "../../../_lib/http.js";

export async function onRequestDelete({ env, params }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return badRequest("ID inválido.");

  const item = await env.DB.prepare("SELECT image_url FROM gallery WHERE id = ?").bind(id).first();
  if (!item) return notFound("Foto não encontrada.");

  if (item.image_url?.startsWith("/media/")) {
    const key = decodeURIComponent(item.image_url.replace("/media/", ""));
    await env.MEDIA.delete(key);
  }

  await env.DB.prepare("DELETE FROM gallery WHERE id = ?").bind(id).run();
  return new Response(null, { status: 204 });
}
