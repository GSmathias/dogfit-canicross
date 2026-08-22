import { onRequestGet as getContent } from "./functions/api/content.js";
import { onRequestGet as getProducts } from "./functions/api/products.js";

function apiNotFound() {
  return new Response(
    JSON.stringify({ error: "Rota não encontrada." }),
    {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" }
    }
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/api/content") {
        return getContent({ request, env, ctx });
      }

      if (request.method === "GET" && url.pathname === "/api/products") {
        return getProducts({ request, env, ctx });
      }

      if (url.pathname.startsWith("/api/")) {
        return apiNotFound();
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);

      return new Response(
        JSON.stringify({ error: "Erro interno do servidor." }),
        {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8" }
        }
      );
    }
  }
};