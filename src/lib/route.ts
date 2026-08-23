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
import { activeGroup } from './cloud/groupctx';
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

  /*
   * ODDIY FOYDALANUVCHI QURILMADAGI KALITNI ISHLATMAYDI.
   *
   * Bu ataylab qoʻyilgan qattiq chegara. Sabab haqiqiy nosozlikdan
   * chiqdi: bitta telefonda admin oʻz kalitini kiritgan, keyin
   * boshqa odam BEPUL hisob bilan kirgan — va soʻrovlar oʻsha
   * kalitdan, admin qoʻshmagan model orqali ketgan. Sarf hisoboti
   * ham oʻsha modelga yozilgan.
   *
   * Endi bulut yoqilgan boʻlsa, faqat ADMIN oʻz kalitidan
   * foydalana oladi. Qolgan hamma odam faqat shlyuz orqali —
   * admin ochib bergan modellar bilan.
   */
  const hisob = accountSnapshot();
  if (cloudEnabled && hisob?.signed_in && !hisob.is_admin) {
    return 'cloud';
  }

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

/**
 * Zaxira modelga oʻtilgani haqida xabar.
 *
 * Bir suhbatda koʻp soʻrov ketadi — har biriga xabar chiqarsak bezor
 * qiladi, shuning uchun bir xil matn 5 daqiqada bir marta koʻrsatiladi.
 */
const noticeSeen = new Map<string, number>();
const noticeListeners = new Set<(text: string) => void>();

export function onFallbackNotice(listener: (text: string) => void): () => void {
  noticeListeners.add(listener);
  return () => noticeListeners.delete(listener);
}

function announceFallback(text: string): void {
  const last = noticeSeen.get(text) ?? 0;
  if (Date.now() - last < 5 * 60_000) return;
  noticeSeen.set(text, Date.now());
  noticeListeners.forEach((l) => l(text));
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
    /*
     * Guruh ichida ishlayotgan boʻlsak — id ni yuboramiz. Server uni
     * hisobga oladi: guruh hamyonida kredit boʻlsa avval shundan
     * yechiladi. Sarlavhaga ishonilmaydi, aʼzolikni baza tekshiradi.
     */
    const group = activeGroup();
    const res = await fetch(url.toString(), {
      method: opts.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        ...(group ? { 'X-Daho-Group': group } : {}),
      },
      body: opts.body,
      signal: opts.signal,
    });
    // Balans o'zgardi — hisobni jimgina yangilaymiz.
    scheduleAccountRefresh();

    /*
     * Limit tugab, zaxira modelga oʻtilgan boʻlsa foydalanuvchi buni
     * bilishi kerak: javob sifati boshqacha boʻladi. Server sababini
     * sarlavhada yuboradi, biz uni bir marta koʻrsatamiz.
     */
    const notice = res.headers.get('X-Daho-Notice');
    if (notice) announceFallback(decodeURIComponent(notice));

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
