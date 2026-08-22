export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export function badRequest(message) {
  return json({ error: message }, 400);
}

export function notFound(message = "Não encontrado.") {
  return json({ error: message }, 404);
}
