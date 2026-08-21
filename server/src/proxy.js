/*
 * Tashqi API larga proxy.
 *
 * Brauzerdagi ilova Supabase Management API yoki Google API ga bevosita
 * murojaat qila olmaydi — ular CORS sarlavhalarini bermaydi, brauzer esa
 * soʻrovni bloklaydi. Server bunday cheklovga ega emas.
 *
 * Bu ochiq relay EMAS: faqat roʻyxatdagi xizmatlarga ruxsat beriladi,
 * soʻrov esa autentifikatsiyadan oʻtgan boʻlishi kerak.
 */

/** Faqat shu xostlarga ruxsat. */
const ALLOWED = [
  'api.supabase.com',
  // Google xizmatlari koʻp subdomenda: drive, calendar, sheets, gmail…
  'googleapis.com',
  'oauth2.googleapis.com',
  'api.openai.com',
  'openrouter.ai',
  'api.telegram.org',
  'api.github.com',
  'api.notion.com',
];

/** Xost roʻyxatda bormi (aniq moslik yoki subdomen). */
export function allowedHost(host) {
  const clean = String(host || '').toLowerCase();
  return ALLOWED.some((h) => clean === h || clean.endsWith(`.${h}`));
}

export function allowedHosts() {
  return [...ALLOWED];
}

export async function proxyRequest({ url, method, headers, body }) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, status: 400, body: 'Manzil notoʻgʻri' };
  }

  if (target.protocol !== 'https:') {
    return { ok: false, status: 400, body: 'Faqat https ruxsat etiladi' };
  }
  if (!allowedHost(target.hostname)) {
    return {
      ok: false,
      status: 403,
      body: `«${target.hostname}» ruxsat etilgan xizmatlar roʻyxatida yoʻq.`,
    };
  }

  // Faqat kerakli sarlavhalar oʻtadi — mijoz serverning oʻz kalitlarini
  // yoki xost sarlavhasini almashtira olmasin.
  const safe = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    const k = key.toLowerCase();
    if (['authorization', 'content-type', 'accept', 'apikey', 'x-goog-api-key'].includes(k)) {
      safe[k] = String(value);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(target.toString(), {
      method: method || 'GET',
      headers: safe,
      body: body === undefined || body === null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text.slice(0, 1_000_000) };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      body: `Ulanib boʻlmadi: ${String(err?.message ?? err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
