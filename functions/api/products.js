import { json } from "../_lib/http.js";

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`
    SELECT
      id, name, price, club_price, description, image_url, active,
      sort_order, category, stock_status, badge, featured
    FROM products
    WHERE active = 1
    ORDER BY sort_order ASC, id DESC
  `).all();

  return json(results);
}
