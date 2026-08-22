import { json, badRequest } from "../../_lib/http.js";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) return badRequest("Arquivo não enviado.");
  if (!ALLOWED.has(file.type)) return badRequest("Formato de imagem não permitido.");
  if (file.size > 8 * 1024 * 1024) return badRequest("A imagem deve ter no máximo 8 MB.");

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = `${crypto.randomUUID()}.${ext}`;

  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name }
  });

  return json({ url: `/media/${encodeURIComponent(key)}`, key }, 201);
}
