/**
 * AI so'rovi qayerga ketishini hal qiladi.
 *
 *   byok  — foydalanuvchining o'z Gemini kaliti bilan to'g'ridan-to'g'ri
 *           Google'ga. Bepul, cheklovlar Google tomonida.
 *   cloud — Daho Cloud gateway'i orqali: obuna, model ruxsati va
 *           token hisobi server tomonda nazorat qilinadi.
 *
 * Ikkala holatda ham javob formati bir xil, shuning uchun ilovaning
 * qolgan qismi farqni sezmaydi.
 */
import { accountSnapshot, scheduleAccountRefresh } from './cloud/account';
import { accessToken } from './cloud/client';
import { GATEWAY_URL, SUPABASE_ANON_KEY, cloudEnabled } from './cloud/config';
import { getState } from './store';

export const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export type AiSource = 'byok' | 'cloud';

/** Bulut ishlashga tayyormi: sozlangan, kirilgan va bloklanmagan. */
export function cloudReady(): boolean {
  if (!cloudEnabled) return false;
  const account = accountSnapshot();
  return Boolean(account?.signed_in && !account.blocked && account.plan);
}

/** So'rov qaysi yo'ldan ketadi. */
export function resolveSource(apiKey?: string): AiSource {
  const key = apiKey ?? getState().settings.apiKey;
  const preference = getState().settings.aiSource;
  if (preference === 'byok') return 'byok';
  if (preference === 'cloud') return cloudReady() ? 'cloud' : 'byok';
  // 'auto': o'z kaliti bo'lsa — o'shandan, aks holda obunadan.
  if (key) return 'byok';
  return cloudReady() ? 'cloud' : 'byok';
}

/** Umuman so'rov yuborish mumkinmi (kalit yoki obuna bormi). */
export function aiAvailable(apiKey?: string): boolean {
  const key = apiKey ?? getState().settings.apiKey;
  return Boolean(key) || cloudReady();
}

/** Obunada shu model ochiqmi (ro'yxat `my_account` dan keladi). */
export function modelInPlan(model: string): boolean {
  const account = accountSnapshot();
  if (!account?.models?.length) return false;
  return account.models.some((m) => m.model === model);
}

export class AiRouteError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'AiRouteError';
    this.status = status;
  }
}

interface FetchOptions {
  method?: string;
  body?: string;
  signal?: AbortSignal;
  /** Qo'shimcha so'rov parametrlari (masalan alt=sse) */
  query?: Record<string, string>;
}

/**
 * `path` — Google API yo'lining `/v1beta` dan keyingi qismi,
 * masalan `/models/gemini-flash-latest:generateContent`.
 */
export async function aiFetch(
  apiKey: string,
  path: string,
  opts: FetchOptions = {},
): Promise<Response> {
  const source = resolveSource(apiKey);

  if (source === 'cloud') {
    const token = await accessToken();
    if (!token) {
      throw new AiRouteError('Obunadan foydalanish uchun tizimga kiring.', 401);
    }
    const url = new URL(`${GATEWAY_URL}/v1beta${path}`);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      url.searchParams.set(key, value);
    }
    const res = await fetch(url.toString(), {
      method: opts.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: opts.body,
      signal: opts.signal,
    });
    // Balans o'zgardi — hisobni jimgina yangilaymiz.
    scheduleAccountRefresh();
    return res;
  }

  if (!apiKey) {
    throw new AiRouteError(
      'API kalit kiritilmagan. Sozlamalarga oʻting yoki obunaga kiring.',
      0,
    );
  }

  const url = new URL(`${GOOGLE_BASE}${path}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    url.searchParams.set(key, value);
  }
  return fetch(url.toString(), {
    method: opts.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: opts.body,
    signal: opts.signal,
  });
}
