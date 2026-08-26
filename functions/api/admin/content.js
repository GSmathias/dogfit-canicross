import { json } from "../../_lib/http.js";
import { deleteMediaUrl } from "../../_lib/media.js";

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare("SELECT key, value FROM site_content").all();
  return json(Object.fromEntries(results.map(row => [row.key, row.value])));
}

export async function onRequestPut({ request, env }) {
  const data = await request.json();
  const entries = Object.entries(data).filter(([key]) =>
    /^[a-z0-9_]{2,80}$/i.test(key)
  );

  const imageEntries = entries.filter(([key]) => key.endsWith("_image_url"));
  const previousImages = {};
  if (imageEntries.length) {
    const placeholders = imageEntries.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `SELECT key, value FROM site_content WHERE key IN (${placeholders})`
    ).bind(...imageEntries.map(([key]) => key)).all();
    for (const row of results) previousImages[row.key] = row.value || "";
  }

  const statements = entries.map(([key, value]) =>
    env.DB.prepare(`
      INSERT INTO site_content (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `).bind(key, value == null ? "" : String(value))
  );

  if (statements.length) await env.DB.batch(statements);

  for (const [key, value] of imageEntries) {
    const oldValue = previousImages[key] || "";
    const newValue = value == null ? "" : String(value);
    if (oldValue && oldValue !== newValue) {
      try { await deleteMediaUrl(env, oldValue); }
      catch (caught) { console.error(`Falha ao limpar mídia antiga de ${key}:`, caught); }
    }
  }

  return json(data);
}
