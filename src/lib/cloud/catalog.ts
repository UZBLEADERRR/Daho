/**
 * Model katalogi — admin uchun.
 *
 * Ikki manba bor:
 *   • OpenRouter katalogi — Daho serveri orqali olinadi, chunki
 *     provayder kaliti faqat o'sha yerda turadi. Haqiqiy TANNARX
 *     ($/1M token) shu ro'yxatdan keladi.
 *   • `ai_models` jadvali — biz sotadigan modellar: Daho nomi,
 *     qaysi provayder, qaysi model, sotuv narxi.
 */
import { accessToken, supa } from './client';
import { SERVER_URL } from './config';

function client() {
  const sb = supa();
  if (!sb) throw new Error('Bulut sozlanmagan');
  return sb;
}

/** OpenRouter dagi bitta model — narxi bilan. */
export interface CatalogModel {
  id: string;
  name: string;
  description: string;
  context: number;
  /** USD / 1M token */
  input_usd: number;
  output_usd: number;
  image_usd: number;
  free: boolean;
  supports_tools: boolean;
  supports_vision: boolean;
}

/** Biz sotadigan model. */
export interface AiModel {
  id?: string;
  slug: string;
  label: string;
  description: string;
  provider: 'openrouter' | 'google';
  upstream: string;
  role: string;
  cost_input_usd: number;
  cost_output_usd: number;
  input_credits_per_mtok: number;
  output_credits_per_mtok: number;
  call_credits: number;
  supports_tools: boolean;
  supports_vision: boolean;
  supports_stream: boolean;
  context_tokens: number;
  enabled: boolean;
  is_daily: boolean;
  sort: number;
}

export interface ProviderStatus {
  google: { key: boolean; base: string };
  openrouter: { key: boolean; base: string };
}

export interface CreditRate {
  usd_per_credit: number;
  markup: number;
}

async function serverCall<T>(path: string, method = 'GET'): Promise<T> {
  if (!SERVER_URL) {
    throw new Error(
      'Daho serveri topilmadi. Ilovani Railway manzilidan oching yoki VITE_DAHO_SERVER_URL ni sozlang.',
    );
  }
  const token = await accessToken();
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error ?? `Server xatosi (${res.status})`);
  return data;
}

async function serverGet<T>(path: string): Promise<T> {
  if (!SERVER_URL) {
    throw new Error(
      'Daho serveri topilmadi. Ilovani Railway manzilidan oching yoki VITE_DAHO_SERVER_URL ni sozlang.',
    );
  }
  const token = await accessToken();
  const res = await fetch(`${SERVER_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error ?? `Server xatosi (${res.status})`);
  return data;
}

export interface ServerHealth {
  ok: boolean;
  yetishmayapti: string[];
  xotira_mb?: number;
  ish_vaqti_s?: number;
}

/**
 * Railway’dagi server holati.
 *
 * Token talab qilmaydi — aynan shuning uchun foydali: agar server
 * SUPABASE_URL siz turgan boʻlsa, boshqa manzillar javob bera olmaydi,
 * bu esa beradi va sababini aytadi.
 */
export async function serverHealth(): Promise<ServerHealth> {
  if (!SERVER_URL) throw new Error('Daho serveri manzili sozlanmagan');
  const res = await fetch(`${SERVER_URL}/health`);
  const data = (await res.json().catch(() => ({}))) as Partial<ServerHealth>;
  if (!res.ok && !Array.isArray(data.yetishmayapti)) {
    throw new Error(`Server javob bermadi (${res.status})`);
  }
  return {
    ok: Boolean(data.ok),
    yetishmayapti: data.yetishmayapti ?? [],
    xotira_mb: data.xotira_mb,
    ish_vaqti_s: data.ish_vaqti_s,
  };
}

/** Qaysi provayder kaliti serverda bor. Kalitning oʻzi hech qachon kelmaydi. */
export async function providerStatus(): Promise<ProviderStatus> {
  const data = await serverGet<{ providers: ProviderStatus }>('/api/providers');
  return data.providers;
}

/** OpenRouter dagi barcha modellar (10 daqiqa keshlanadi). */
export async function openrouterCatalog(force = false): Promise<CatalogModel[]> {
  const data = await serverGet<{ models: CatalogModel[] }>(
    `/api/catalog/openrouter${force ? '?force=1' : ''}`,
  );
  return data.models ?? [];
}

/** Biz sotadigan modellar roʻyxati. */
export async function aiModels(): Promise<AiModel[]> {
  const { data, error } = await client()
    .from('ai_models')
    .select('*')
    .order('sort', { ascending: true })
    .order('label', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AiModel[];
}

/** Modelni qoʻshadi yoki yangilaydi. Narx berilmasa tannarxdan hisoblanadi. */
export async function saveAiModel(model: Partial<AiModel>): Promise<AiModel> {
  const { data, error } = await client().rpc('admin_save_model', { p_model: model });
  if (error) throw new Error(error.message);
  return data as AiModel;
}

export async function deleteAiModel(slug: string): Promise<void> {
  const { error } = await client().from('ai_models').delete().eq('slug', slug);
  if (error) throw new Error(error.message);
}

/** Modelni bir necha rejaga bir vaqtda ochadi. */
export async function attachModel(
  slug: string,
  planIds: string[],
  markup?: number,
): Promise<number> {
  const { data, error } = await client().rpc('admin_attach_model', {
    p_slug: slug,
    p_plans: planIds,
    p_markup: markup ?? null,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Kredit kursi.
 *
 * `usd_per_credit` — bir kredit necha dollar turadi. `markup` — ustama
 * (2 = tannarxdan ikki barobar). Sotuv narxi shu ikkisidan hisoblanadi:
 *   kredit/1M = tannarx($/1M) × markup / usd_per_credit
 */
export async function creditRate(): Promise<CreditRate> {
  const { data, error } = await client()
    .from('app_settings')
    .select('value')
    .eq('key', 'credit_rate')
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = (data?.value ?? {}) as Partial<CreditRate>;
  return {
    usd_per_credit: Number(value.usd_per_credit ?? 0.00005),
    markup: Number(value.markup ?? 2),
  };
}

export async function saveCreditRate(rate: CreditRate): Promise<void> {
  const { error } = await client()
    .from('app_settings')
    .upsert({ key: 'credit_rate', value: rate });
  if (error) throw new Error(error.message);
}

/** Tannarxdan sotuv narxini hisoblaydi (bazadagi funksiya bilan bir xil). */
export function toCredits(usdPerMtok: number, rate: CreditRate): number {
  const perCredit = rate.usd_per_credit || 0.00005;
  return Math.round(((usdPerMtok || 0) * (rate.markup || 1)) / perCredit);
}

/** Foydalanuvchi koʻradigan katalog — narx emas, imkoniyatlar. */
export interface PublicModel {
  slug: string;
  label: string;
  description: string;
  role: string;
  supports_tools: boolean;
  supports_vision: boolean;
  context_tokens: number;
  is_daily: boolean;
  open: boolean;
  input_credits_per_mtok: number;
  output_credits_per_mtok: number;
  call_credits: number;
}

export async function publicCatalog(): Promise<PublicModel[]> {
  const sb = supa();
  if (!sb) return [];
  const { data, error } = await sb.rpc('model_catalog');
  if (error) throw new Error(error.message);
  return (data ?? []) as PublicModel[];
}

/**
 * Katalogga kiritilmagan, lekin rejada ochiq modellar.
 *
 * Katalogdan oldin modellar toʻgʻridan-toʻgʻri `plan_models` ga qoʻlda
 * yozilgan boʻlishi mumkin. Ular ishlaydi, lekin provayderi nomaʼlum va
 * narxi eski oʻlchovda qolgan — shuning uchun admin buni koʻrib turishi
 * kerak.
 */
export interface UnlistedModel {
  model: string;
  role: string;
  plans: number;
  input_credits_per_mtok: number;
  output_credits_per_mtok: number;
}

export async function unlistedModels(): Promise<UnlistedModel[]> {
  const { data, error } = await client().rpc('unlisted_models');
  if (error) throw new Error(error.message);
  return (data ?? []) as UnlistedModel[];
}

/**
 * Tez sozlash.
 *
 * OpenRouter roʻyxatidan uchta model tanlab katalogga qoʻshadi va
 * barcha tarifga ochadi: bepul zaxira (Daho Daily), tezkor va kuchli.
 * Model nomlarini qoʻlda yozish shart emas — roʻyxat jonli olinadi.
 */
export interface BootstrapResult {
  qoshildi: Array<{ slug: string; label: string; upstream: string; narx: string }>;
  rejalar: number;
}

export function bootstrapCatalog(): Promise<BootstrapResult> {
  return serverCall<BootstrapResult>('/api/catalog/bootstrap', 'POST');
}
