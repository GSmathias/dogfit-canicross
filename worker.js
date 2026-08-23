import { onRequestGet as getContent } from "./functions/api/content.js";
import { onRequestGet as getProducts } from "./functions/api/products.js";
import { onRequestGet as getMedia } from "./functions/media/[key].js";
import { onRequestPost as uploadMedia } from "./functions/api/admin/upload.js";
import {
  handleAdminClub,
  handlePartner,
  handlePublicClub
} from "./functions/api/club.js";

import {
  onRequestGet as getAdminContent,
  onRequestPut as updateAdminContent
} from "./functions/api/admin/content.js";

import {
  onRequestGet as getAdminProducts,
  onRequestPost as createAdminProduct
} from "./functions/api/admin/products/index.js";

import {
  onRequestPut as updateAdminProduct,
  onRequestDelete as deleteAdminProduct
} from "./functions/api/admin/products/[id].js";

import {
  onRequestGet as getAdminGallery,
  onRequestPost as createGalleryItem
} from "./functions/api/admin/gallery/index.js";

import {
  onRequestDelete as deleteGalleryItem
} from "./functions/api/admin/gallery/[id].js";

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function unauthorized() {
  return new Response("Acesso restrito ao administrador.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Painel DOGFIT", charset="UTF-8"'
    }
  });
}

function isAuthorized(request, env) {
  if (!env.ADMIN_PASSWORD) return false;

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Basic ")) return false;

  try {
    const credentials = atob(authorization.slice(6));
    const separator = credentials.indexOf(":");
    if (separator < 0) return false;

    const username = credentials.slice(0, separator);
    const password = credentials.slice(separator + 1);

    return username === "dogfit" && password === env.ADMIN_PASSWORD;
  } catch {
    return false;
  }
}

function assetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === "/admin.html" || path === "/admin/") {
        return Response.redirect(`${url.origin}/admin`, 302);
      }

      if (path === "/admin") {
        if (!isAuthorized(request, env)) return unauthorized();
        return env.ASSETS.fetch(request);
      }

      if (path === "/club-admin.html" || path === "/club-admin/") {
        return Response.redirect(`${url.origin}/club-admin`, 302);
      }

      if (path === "/club-admin") {
        if (!isAuthorized(request, env)) return unauthorized();
        return env.ASSETS.fetch(assetRequest(request, "/club-admin.html"));
      }

      if (path === "/parceiro.html" || path === "/parceiro/") {
        return Response.redirect(`${url.origin}/parceiro`, 302);
      }

      if (path === "/parceiro") {
        return env.ASSETS.fetch(assetRequest(request, "/partner.html"));
      }

      if (/^\/clube\/[a-f0-9-]{36}$/i.test(path)) {
        return env.ASSETS.fetch(assetRequest(request, "/member-card.html"));
      }

      if (method === "GET" && path === "/api/content") {
        return getContent({ request, env, ctx });
      }

      if (method === "GET" && path === "/api/products") {
        return getProducts({ request, env, ctx });
      }

      if (path.startsWith("/api/club/")) {
        return handlePublicClub({ request, env, ctx, path, method });
      }

      if (path.startsWith("/api/partner/")) {
        return handlePartner({ request, env, ctx, path, method });
      }

      if (method === "GET" && path.startsWith("/media/")) {
        const key = path.slice("/media/".length);
        if (!key) return new Response("Not found", { status: 404 });

        return getMedia({
          request,
          env,
          ctx,
          params: { key }
        });
      }

      if (path.startsWith("/api/admin/")) {
        if (!env.ADMIN_PASSWORD) {
          return jsonError(
            "Senha administrativa ainda não configurada.",
            503
          );
        }

        if (!isAuthorized(request, env)) return unauthorized();

        if (path.startsWith("/api/admin/club/")) {
          return handleAdminClub({ request, env, ctx, path, method });
        }

        if (path === "/api/admin/content") {
          if (method === "GET") {
            return getAdminContent({ request, env, ctx });
          }

          if (method === "PUT") {
            return updateAdminContent({ request, env, ctx });
          }
        }

        if (path === "/api/admin/products") {
          if (method === "GET") {
            return getAdminProducts({ request, env, ctx });
          }

          if (method === "POST") {
            return createAdminProduct({ request, env, ctx });
          }
        }

        const productMatch = path.match(
          /^\/api\/admin\/products\/(\d+)$/
        );

        if (productMatch) {
          const params = { id: productMatch[1] };

          if (method === "PUT") {
            return updateAdminProduct({ request, env, ctx, params });
          }

          if (method === "DELETE") {
            return deleteAdminProduct({ request, env, ctx, params });
          }
        }

        if (path === "/api/admin/gallery") {
          if (method === "GET") {
            return getAdminGallery({ request, env, ctx });
          }

          if (method === "POST") {
            return createGalleryItem({ request, env, ctx });
          }
        }

        const galleryMatch = path.match(
          /^\/api\/admin\/gallery\/(\d+)$/
        );

        if (galleryMatch && method === "DELETE") {
          return deleteGalleryItem({
            request,
            env,
            ctx,
            params: { id: galleryMatch[1] }
          });
        }

        if (path === "/api/admin/upload" && method === "POST") {
          return uploadMedia({ request, env, ctx });
        }

        return jsonError("Rota administrativa não encontrada.", 404);
      }

      if (path.startsWith("/api/")) {
        return jsonError("Rota não encontrada.", 404);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return jsonError("Erro interno do servidor.", 500);
    }
  }
};
