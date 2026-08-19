/**
 * Xarajat hisoblagichi.
 *
 * OpenRouter va boshqa OpenAI-mos provayderlar javob oxirida `usage`
 * qaytaradi — nechta token kirdi va chiqdi. Model narxi bilan koʻpaytirib,
 * har soʻrovning haqiqiy narxini hisoblaymiz.
 *
 * Nega kerak: Avto rejim qimmat model (claude-sonnet) tanlashi mumkin, u
 * esa flash’dan oʻn barobar qimmat. Qancha sarflayotganingizni koʻrib
 * turmasangiz, oy oxirida kutilmagan hisob keladi.
 *
 * Gemini kaliti bilan ishlaganda narx hisoblanmaydi (Google bepul rejada
 * token qaytarmaydi) — bunda faqat soʻrovlar soni koʻrinadi.
 */

import { modelCaps, parseRef, priceLabel } from './providers';

export interface UsageEntry {
  at: number;
  /** To'liq model havolasi: `openrouter::qwen/qwen3-max` */
  model: string;
  inTokens: number;
  outTokens: number;
  /** USD; narx nomaʼlum boʻlsa 0 */
  cost: number;
  /** Qayerda ishlatilgani: chat, kod, kitob… */
  kind: string;
}

const KEY = 'daho.usage.v1';
/** Koʻpi bilan shuncha yozuv saqlanadi — eskisi oʻchadi. */
const MAX_ENTRIES = 800;

function read(): UsageEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? (list as UsageEntry[]) : [];
  } catch {
    return [];
  }
}

function write(list: UsageEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    /* xotira toʻlgan — hisob muhim emas, ish davom etsin */
  }
}

const listeners = new Set<() => void>();
let snapshot: UsageEntry[] = read();

function emit(): void {
  snapshot = read();
  listeners.forEach((l) => l());
}

/** Model narxidan foydalanib bitta soʻrov narxini hisoblaydi (USD). */
export function costOf(model: string, inTokens: number, outTokens: number): number {
  const caps = modelCaps(model);
  if (!caps) return 0;
  const inPrice = caps.inPrice ?? 0;
  const outPrice = caps.outPrice ?? 0;
  // Narxlar 1 mln token uchun berilgan.
  return (inTokens / 1_000_000) * inPrice + (outTokens / 1_000_000) * outPrice;
}

/** Bitta soʻrovning sarfini yozib qoʻyadi. */
export function recordUsage(
  model: string,
  inTokens: number,
  outTokens: number,
  kind = 'chat',
): void {
  if (!inTokens && !outTokens) return;
  const entry: UsageEntry = {
    at: Date.now(),
    model,
    inTokens,
    outTokens,
    cost: costOf(model, inTokens, outTokens),
    kind,
  };
  write([entry, ...read()]);
  emit();
}

export interface UsageTotals {
  requests: number;
  inTokens: number;
  outTokens: number;
  cost: number;
}

function sum(entries: UsageEntry[]): UsageTotals {
  return entries.reduce<UsageTotals>(
    (acc, e) => ({
      requests: acc.requests + 1,
      inTokens: acc.inTokens + e.inTokens,
      outTokens: acc.outTokens + e.outTokens,
      cost: acc.cost + e.cost,
    }),
    { requests: 0, inTokens: 0, outTokens: 0, cost: 0 },
  );
}

const DAY = 24 * 60 * 60 * 1000;

/** Bugungi, shu haftadagi va umumiy sarf. */
export function totals(): { today: UsageTotals; week: UsageTotals; all: UsageTotals } {
  const entries = read();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return {
    today: sum(entries.filter((e) => e.at >= startOfDay.getTime())),
    week: sum(entries.filter((e) => e.at >= Date.now() - 7 * DAY)),
    all: sum(entries),
  };
}

/** Model boʻyicha sarf — qaysi model koʻp pul yeyayotganini koʻrsatadi. */
export function byModel(sinceDays = 30): Array<{ model: string; label: string } & UsageTotals> {
  const since = Date.now() - sinceDays * DAY;
  const groups = new Map<string, UsageEntry[]>();
  for (const e of read()) {
    if (e.at < since) continue;
    groups.set(e.model, [...(groups.get(e.model) ?? []), e]);
  }
  return [...groups.entries()]
    .map(([model, entries]) => ({
      model,
      label: parseRef(model).model,
      ...sum(entries),
    }))
    .sort((a, b) => b.cost - a.cost || b.requests - a.requests);
}

export function clearUsage(): void {
  write([]);
  emit();
}

/** Narxni koʻrsatish: juda kichik summalar ham koʻrinsin. */
export function money(usd: number): string {
  if (usd <= 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export { priceLabel };

/* ---------- React ---------- */

export function subscribeUsage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usageSnapshot(): UsageEntry[] {
  return snapshot;
}
