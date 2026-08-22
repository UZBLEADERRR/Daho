/**
 * Suhbatlarni bulut orqali sinxronlash.
 *
 * Telefon, veb va brauzer kengaytmasi bitta hisobga kirgani uchun suhbatlar
 * uchalasida ham bir xil boʻlishi kerak. Qoida oddiy: kim keyinroq
 * oʻzgartirgan boʻlsa — oʻshaniki (`updated_at` boʻyicha).
 *
 * Rasm va biriktirmalar bulutga chiqmaydi: ular katta va qurilmada qoladi.
 * Bu suhbat matnini yengil saqlaydi va bepul limitni tejaydi.
 */

import { accessToken, session } from './auth';
import { restUrl, server } from './config';
import { getState, setState } from './store';
import type { Chat, Message } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

const LAST_PULL_KEY = 'daho.sync.at';
/** Bulutga chiqmaydigan ogʻir maydonlar. */
const HEAVY = new Set(['attachments']);

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let lastPushed = '';

function trim(message: Message): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(message)) {
    if (HEAVY.has(key)) continue;
    out[key] = value;
  }
  return out;
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = server();
  if (!cfg) throw new Error('server yoʻq');
  const token = await accessToken();
  if (!token) throw new Error('kirilmagan');
  const res = await fetch(restUrl(path), {
    ...init,
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Qaysi manbadan yozilayotgani — admin uchun foydali. */
function source(): string {
  if (typeof navigator !== 'undefined' && /Android|iPhone/i.test(navigator.userAgent)) return 'app';
  return 'web';
}

/* ------------------------------------------------------------------ */
/*  Yuklash (bulutdan)                                                 */
/* ------------------------------------------------------------------ */

export async function pullChats(): Promise<number> {
  if (!session()) return 0;

  const rows = await rest<any[]>(
    'chats?deleted=eq.false&select=id,title,messages,updated_at,created_at&order=updated_at.desc&limit=200',
  );

  const local = new Map(getState().chats.map((c) => [c.id, c]));
  let changed = 0;

  for (const row of rows) {
    const remoteAt = new Date(row.updated_at).getTime();
    const mine = local.get(row.id);
    // Qurilmadagi nusxa yangiroq boʻlsa — tegmaymiz.
    if (mine && mine.updatedAt >= remoteAt) continue;

    const messages = (Array.isArray(row.messages) ? row.messages : []) as Message[];
    local.set(row.id, {
      id: row.id,
      title: row.title ?? '',
      // Bulutda biriktirma yoʻq — qurilmadagisini saqlab qolamiz.
      messages: mine ? mergeMessages(mine.messages, messages) : messages,
      createdAt: new Date(row.created_at ?? row.updated_at).getTime(),
      updatedAt: remoteAt,
    });
    changed += 1;
  }

  if (changed) {
    const next = [...local.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    setState({ chats: next });
  }
  localStorage.setItem(LAST_PULL_KEY, String(Date.now()));
  return changed;
}

/** Bulutdagi matnga qurilmadagi biriktirmalarni qaytarib qoʻyadi. */
function mergeMessages(local: Message[], remote: Message[]): Message[] {
  const byId = new Map(local.map((m) => [m.id, m]));
  return remote.map((m) => {
    const mine = byId.get(m.id);
    return mine?.attachments?.length ? { ...m, attachments: mine.attachments } : m;
  });
}

/* ------------------------------------------------------------------ */
/*  Yuborish (bulutga)                                                 */
/* ------------------------------------------------------------------ */

async function pushChats(): Promise<void> {
  const s = session();
  if (!s || running) return;

  const chats = getState().chats.filter((c) => c.messages.length > 0).slice(0, 200);
  const signature = chats.map((c) => `${c.id}:${c.updatedAt}`).join('|');
  if (signature === lastPushed) return;

  running = true;
  try {
    const rows = chats.map((c: Chat) => ({
      id: c.id,
      user_id: s.userId,
      title: c.title.slice(0, 200),
      messages: c.messages.map(trim),
      source: source(),
      updated_at: new Date(c.updatedAt).toISOString(),
      created_at: new Date(c.createdAt).toISOString(),
    }));

    // Bir soʻrovda hammasi — mavjudlari yangilanadi.
    for (let i = 0; i < rows.length; i += 25) {
      await rest('chats', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows.slice(i, i + 25)),
      });
    }
    lastPushed = signature;
  } catch {
    /* internet yoʻq — keyingi urinishda yuboriladi */
  } finally {
    running = false;
  }
}

/** Oʻchirilgan suhbatni bulutda ham belgilaydi. */
export async function markDeleted(chatId: string): Promise<void> {
  if (!session()) return;
  try {
    await rest(`chats?id=eq.${chatId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ deleted: true, updated_at: new Date().toISOString() }),
    });
  } catch {
    /* keyin urinamiz */
  }
}

/* ------------------------------------------------------------------ */
/*  Ishga tushirish                                                    */
/* ------------------------------------------------------------------ */

/**
 * Sinxronlashni yoqadi: kirilganda bir marta yuklab oladi, keyin
 * oʻzgarishlarni 8 soniyalik oraliq bilan yuborib turadi.
 */
export function startSync(): () => void {
  if (!session()) return () => undefined;

  void pullChats().catch(() => undefined);

  const push = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void pushChats(), 8000);
  };

  // Har oʻzgarishda emas — orada kutib, bitta soʻrovda yuboramiz.
  const stopStore = subscribeChats(push);
  const interval = setInterval(() => void pullChats().catch(() => undefined), 5 * 60_000);

  // Ilova yopilayotganda oxirgi holatni yuborishga urinamiz.
  const onHide = () => {
    if (document.visibilityState === 'hidden') void pushChats();
  };
  document.addEventListener('visibilitychange', onHide);

  return () => {
    stopStore();
    clearInterval(interval);
    document.removeEventListener('visibilitychange', onHide);
    if (timer) clearTimeout(timer);
  };
}

/** Suhbatlar oʻzgarganda xabar beradi (boshqa maydonlarga eʼtibor bermaydi). */
function subscribeChats(listener: () => void): () => void {
  let previous = getState().chats;
  const check = () => {
    const now = getState().chats;
    if (now !== previous) {
      previous = now;
      listener();
    }
  };
  const id = setInterval(check, 2000);
  return () => clearInterval(id);
}
