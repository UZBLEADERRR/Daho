import { listModels, type RemoteModel } from './gemini';

export type ModelRole = 'chat' | 'image' | 'tts' | 'video' | 'embed' | 'other';

export interface ModelInfo {
  /** "gemini-3.7-flash" koʻrinishida, "models/" prefiksisiz */
  id: string;
  label: string;
  role: ModelRole;
  /** Saralash uchun: katta son = yangiroq/kuchliroq */
  score: number;
  preview: boolean;
  description?: string;
  /** Tashqi provayder id si; boʻsh boʻlsa — Gemini */
  provider?: string;
  providerLabel?: string;
  /** Rasmni koʻra oladimi */
  vision?: boolean;
  /** Vositalarni chaqira oladimi */
  tools?: boolean;
  /** Kontekst oynasi (token) */
  context?: number;
  /** 1 mln kirish tokeni narxi (USD) */
  inPrice?: number;
  /** 1 mln chiqish tokeni narxi (USD) */
  outPrice?: number;
  /** Bepul modelmi */
  free?: boolean;
}

const CACHE_KEY = 'daho.models.v1';
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 soat

interface Cache {
  fetchedAt: number;
  models: ModelInfo[];
}

/** "models/gemini-3.7-flash" → "gemini-3.7-flash" */
function bareId(name: string): string {
  return name.replace(/^models\//, '');
}

function roleOf(model: RemoteModel): ModelRole {
  const id = bareId(model.name);
  const methods = model.supportedGenerationMethods ?? [];

  if (/\btts\b|-tts/.test(id)) return 'tts';
  if (/embedding|embed|aqa/.test(id)) return 'embed';
  if (/^veo|video/.test(id) || methods.includes('predictLongRunning')) return 'video';
  if (/image|imagen/.test(id)) return 'image';
  if (methods.includes('generateContent') || methods.includes('streamGenerateContent')) {
    return 'chat';
  }
  return 'other';
}

/**
 * Model nomidan "yangilik/kuch" bahosini chiqaradi, shunda yangi chiqqan
 * modellar roʻyxatning boshida turadi va standart sifatida tanlanadi.
 */
function scoreOf(id: string): number {
  const version = id.match(/(\d+(?:\.\d+)?)/);
  let score = version ? parseFloat(version[1]) * 100 : 0;

  if (/\bpro\b/.test(id)) score += 30;
  else if (/flash-lite|lite/.test(id)) score += 5;
  else if (/\bflash\b/.test(id)) score += 15;

  if (/preview|exp\b|experimental/.test(id)) score -= 8;
  if (/-\d{3,}$/.test(id)) score -= 3; // sanali nusxalar (…-001, -20250115)
  if (/thinking/.test(id)) score += 2;

  return score;
}

function prettyLabel(id: string): string {
  return id
    .replace(/^models\//, '')
    .split('-')
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
    .replace(/\bTts\b/, 'TTS')
    .replace(/\bLite\b/, 'Lite');
}

function toInfo(model: RemoteModel): ModelInfo {
  const id = bareId(model.name);
  return {
    id,
    label: model.displayName?.trim() || prettyLabel(id),
    role: roleOf(model),
    score: scoreOf(id),
    preview: /preview|exp\b|experimental/.test(id),
    description: model.description,
  };
}

function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cache;
    if (!Array.isArray(parsed.models) || !parsed.models.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(models: ModelInfo[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), models }));
  } catch {
    /* xotira toʻlgan boʻlishi mumkin */
  }
}

let inflight: Promise<ModelInfo[]> | null = null;

/**
 * Mavjud modellar roʻyxati. Kesh yangi boʻlsa keshdan, aks holda API dan.
 * `force` — keshni chetlab, majburan yangilash.
 */
export async function getModels(apiKey: string, force = false): Promise<ModelInfo[]> {
  const cache = readCache();
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.models;
  if (!apiKey) return cache?.models ?? [];

  if (inflight && !force) return inflight;

  inflight = (async () => {
    try {
      const remote = await listModels(apiKey);
      const models = remote
        .map(toInfo)
        .filter((m) => m.role !== 'embed' && m.role !== 'other')
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      if (models.length) writeCache(models);
      return models;
    } catch (err) {
      // Tarmoq yoki kalit muammosi — bor keshni qaytaramiz.
      if (cache?.models.length) return cache.models;
      throw err;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Keshdagi roʻyxat (soʻrovsiz). */
export function cachedModels(): ModelInfo[] {
  return readCache()?.models ?? [];
}

export function byRole(models: ModelInfo[], role: ModelRole): ModelInfo[] {
  return models.filter((m) => m.role === role);
}

/**
 * Berilgan rol uchun eng maʼqul modelni tanlaydi.
 * `preferred` hali ham mavjud boʻlsa — oʻsha qoladi.
 */
export function pickModel(
  models: ModelInfo[],
  role: ModelRole,
  preferred?: string,
): string | null {
  const pool = byRole(models, role);
  if (!pool.length) return preferred ?? null;
  if (preferred && pool.some((m) => m.id === preferred)) return preferred;

  // Barqaror (preview boʻlmagan) modelga ustunlik beramiz.
  const stable = pool.filter((m) => !m.preview);
  return (stable[0] ?? pool[0]).id;
}

/**
 * Gemini-ga xos ishlar uchun model nomi.
 *
 * Sxema boʻyicha JSON, Google qidiruvi, audio va PDF oʻqish — bularni
 * faqat Gemini bajaradi. Foydalanuvchi asosiy modelni tashqi provayderga
 * (Kimi, Qwen, GPT…) almashtirgan boʻlsa, shu vositalar baribir ishlashi
 * uchun bu yerda Gemini modeliga qaytamiz.
 */
export function geminiModel(preferred?: string): string {
  if (preferred && !preferred.includes('::')) return preferred;
  const list = cachedModels().filter((m) => m.role === 'chat' && !m.provider);
  const stable = list.find((m) => !m.preview);
  return (stable ?? list[0])?.id ?? FALLBACK_MODELS.chat;
}

/** Standart taxminlar — API hali soʻralmaganda ishlatiladi. */
export const FALLBACK_MODELS: Record<Exclude<ModelRole, 'embed' | 'other'>, string> = {
  chat: 'gemini-flash-latest',
  image: 'gemini-2.5-flash-image',
  tts: 'gemini-2.5-flash-tts',
  video: 'veo-3.0-generate-001',
};
