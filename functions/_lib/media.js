export function mediaKeyFromUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://dogfit.local");
    if (!url.pathname.startsWith("/media/")) return "";
    const key = decodeURIComponent(url.pathname.slice("/media/".length));
    return key && !key.includes("/") ? key : "";
  } catch {
    return "";
  }
}

export async function deleteMediaUrl(env, value) {
  const key = mediaKeyFromUrl(value);
  if (!key || !env.MEDIA) return false;
  await env.MEDIA.delete(key);
  return true;
}
