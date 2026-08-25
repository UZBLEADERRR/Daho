/**
 * Bulut sozlamalari. `.env` da manzil berilmagan bo'lsa ilova mutlaqo
 * avvalgidek — faqat qurilmada, o'z API kaliti bilan ishlaydi.
 */
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/** Bulut xizmati yoqilganmi (build vaqtida hal bo'ladi). */
export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Daho serveri (Railway).
 *
 * Veb ilova ODATDA shu serverning oʻzidan beriladi, shuning uchun manzil
 * oʻzidan olinadi — foydalanuvchi hech nima kiritmaydi. Android ilovasi
 * `https://localhost` ichida ishlaydi, u yerda yigʻilish paytida
 * qoʻyilgan manzil ishlatiladi.
 */
function guessServer(): string {
  const fromEnv = String(import.meta.env.VITE_DAHO_SERVER_URL ?? '').trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (import.meta.env.DEV) return '';
  if (typeof location === 'undefined') return '';
  // Capacitor ichida `localhost` — u yerda server yoʻq.
  if (location.hostname === 'localhost' || location.protocol === 'capacitor:') return '';
  return location.origin.replace(/\/+$/, '');
}

export const SERVER_URL = guessServer();

/**
 * AI proksisi — obunachilar soʻrovi shu yerdan oʻtadi.
 *
 * Railway serveri koʻp provayderni biladi (Google + OpenRouter), Supabase
 * Edge funksiyasi esa faqat Google’ni. Shuning uchun server bor boʻlsa
 * oʻsha, boʻlmasa edge funksiyasi ishlatiladi.
 */
export const GATEWAY_URL = SERVER_URL
  ? `${SERVER_URL}/api/ai`
  : `${SUPABASE_URL}/functions/v1/ai-gateway`;

/** Kreditni odam o'qiydigan ko'rinishga keltiradi. */
export function formatCredits(value: number): string {
  const n = Number(value ?? 0);
  if (Math.abs(n) >= 1000) return `${Math.round(n).toLocaleString('ru-RU')}`;
  return n.toFixed(Math.abs(n) < 10 ? 2 : 1).replace(/\.?0+$/, '');
}

/** Narxni so'mda ko'rsatadi. */
export function formatPrice(cents: number, currency = 'UZS'): string {
  if (!cents) return 'Bepul';
  return `${Number(cents).toLocaleString('ru-RU')} ${currency === 'UZS' ? "so'm" : currency}`;
}
