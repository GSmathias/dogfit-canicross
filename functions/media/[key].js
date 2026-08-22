export async function onRequestGet({ env, params }) {
  const key = decodeURIComponent(params.key);
  const object = await env.MEDIA.get(key);

  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
}
