/**
 * Bulut sozlamalari. `.env` da manzil berilmagan bo'lsa ilova mutlaqo
 * avvalgidek — faqat qurilmada, o'z API kaliti bilan ishlaydi.
 */
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/** Bulut xizmati yoqilganmi (build vaqtida hal bo'ladi). */
export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Gemini proksisi — obunachilar so'rovi shu yerdan o'tadi. */
export const GATEWAY_URL = `${SUPABASE_URL}/functions/v1/ai-gateway`;

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
