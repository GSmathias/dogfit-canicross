import { json } from "../_lib/http.js";

export async function onRequestGet({ env }) {
  const contentRows = await env.DB.prepare("SELECT key, value FROM site_content").all();
  const galleryRows = await env.DB.prepare(`
    SELECT id, image_url, caption, sort_order
    FROM gallery
    WHERE active = 1
    ORDER BY sort_order ASC, id DESC
  `).all();

  const content = Object.fromEntries(contentRows.results.map(row => [row.key, row.value]));
  return json({ content, gallery: galleryRows.results });
}
