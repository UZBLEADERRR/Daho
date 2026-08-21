/*
 * Telegram — bot orqali toʻliq ishlash.
 *
 * Avval Telegram oddiy «connector» edi: faqat bitta xabar yubora
 * olardi. Endi bu alohida modul, chunki haqiqiy ish shundan boshlanadi:
 * kim yozganini bilish, 24 soatlik mijozlarga javob berish, guruh va
 * kanalga eʼlon qoʻyish, keyinga rejalashtirish.
 *
 * Nega bot, shaxsiy hisob emas: Telegram shaxsiy hisobdan avtomatik
 * yozishni taqiqlaydi va buning uchun hisobni bloklaydi. Bot esa aynan
 * shu ish uchun qilingan, cheklovi kuniga millionlab va rasmiy.
 *
 * Kerak boʻladi: @BotFather dan olingan token. Guruh yoki kanalga
 * boshqara olishi uchun botni oʻsha yerga ADMIN qilish kerak.
 */

import { idbGet, idbSet } from './storage';
import { getState } from './store';
import { serverReady } from './cloud/server';
import { supa } from './cloud/client';
import { enqueueJob } from './cloud/jobs';

const API = 'https://api.telegram.org';

/** Telegram sekundiga ~30 xabarga ruxsat beradi; xavfsiz oraliq. */
const SEND_GAP_MS = 60;

const STORE_KEY = 'daho.telegram.v1';

/* ------------------------------------------------------------------ */
/*  Saqlanadigan holat                                                 */
/* ------------------------------------------------------------------ */

export interface TgContact {
  id: number;
  name: string;
  username?: string;
  /** Oxirgi marta qachon yozgan (ms) */
  lastAt: number;
  lastText: string;
  /** Nechta xabar yozgan — faolligini koʻrsatadi */
  count: number;
}

export interface TgChat {
  id: number;
  type: 'group' | 'supergroup' | 'channel';
  title: string;
  username?: string;
  lastAt: number;
}

interface TgStore {
  /** getUpdates uchun keyingi oʻrin — bir xabarni ikki marta oʻqimaymiz */
  offset: number;
  contacts: Record<string, TgContact>;
  chats: Record<string, TgChat>;
}

const EMPTY: TgStore = { offset: 0, contacts: {}, chats: {} };
let cache: TgStore | null = null;

async function load(): Promise<TgStore> {
  if (cache) return cache;
  cache = (await idbGet<TgStore>(STORE_KEY)) ?? { ...EMPTY };
  // Eski yozuvlar toʻliqmas boʻlishi mumkin.
  cache.contacts ??= {};
  cache.chats ??= {};
  cache.offset ??= 0;
  return cache;
}

async function save(): Promise<void> {
  if (cache) await idbSet(STORE_KEY, cache);
}

/* ------------------------------------------------------------------ */
/*  Chaqiruv                                                           */
/* ------------------------------------------------------------------ */

export function tgToken(): string {
  return (getState().settings.tgToken ?? '').trim();
}

export function tgReady(): boolean {
  // Token koʻrinishi: `123456789:AA...` — raqam, ikki nuqta, kalit.
  return /^\d{6,}:[\w-]{20,}$/.test(tgToken());
}

/** Bot API ga soʻrov. Server bor boʻlsa oʻsha orqali. */
async function call<T>(method: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = tgToken();
  if (!token) throw new Error('Telegram bot tokeni kiritilmagan.');

  const url = `${API}/bot${token}/${method}`;
  const settings = getState().settings;

  let raw: { ok: boolean; status: number; text: string };

  if (serverReady()) {
    const base = (settings.serverUrl ?? '').trim().replace(/\/+$/, '');
    const res = await fetch(`${base}/proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.serverSecret ? { 'x-worker-secret': settings.serverSecret } : {}),
      },
      body: JSON.stringify({
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ?? {},
      }),
      signal,
    });
    const w = (await res.json()) as { ok?: boolean; status?: number; body?: string };
    raw = { ok: Boolean(w.ok), status: w.status ?? 0, text: w.body ?? '' };
  } else {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal,
    });
    raw = { ok: res.ok, status: res.status, text: await res.text() };
  }

  let parsed: { ok?: boolean; result?: T; description?: string };
  try {
    parsed = JSON.parse(raw.text) as typeof parsed;
  } catch {
    throw new Error(`Telegram javobi tushunarsiz (${raw.status}).`);
  }

  if (!parsed.ok) {
    throw new Error(`Telegram: ${parsed.description ?? `xato ${raw.status}`}`);
  }
  return parsed.result as T;
}

/* ------------------------------------------------------------------ */
/*  Bot haqida                                                         */
/* ------------------------------------------------------------------ */

export interface TgMe {
  id: number;
  username: string;
  first_name: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
}

export function tgMe(signal?: AbortSignal): Promise<TgMe> {
  return call<TgMe>('getMe', undefined, signal);
}

/* ------------------------------------------------------------------ */
/*  Yangi xabarlarni oʻqish                                            */
/* ------------------------------------------------------------------ */

interface RawUpdate {
  update_id: number;
  message?: RawMessage;
  channel_post?: RawMessage;
  my_chat_member?: { chat: RawChat };
}

interface RawMessage {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  from?: { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
  chat: RawChat;
}

interface RawChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
}

export interface TgMessage {
  chatId: number;
  chatTitle: string;
  chatType: string;
  messageId: number;
  from: string;
  fromId: number;
  text: string;
  at: number;
}

/**
 * Yangi xabarlarni oladi va kim yozganini eslab qoladi.
 *
 * Telegram xabarlarni 24 soat saqlaydi va oʻqilganini `offset` bilan
 * belgilaymiz — shuning uchun bir xabar ikki marta kelmaydi.
 */
export async function tgSync(signal?: AbortSignal): Promise<TgMessage[]> {
  const store = await load();

  const updates = await call<RawUpdate[]>(
    'getUpdates',
    { offset: store.offset || undefined, limit: 100, timeout: 0 },
    signal,
  );

  const out: TgMessage[] = [];

  for (const u of updates) {
    store.offset = Math.max(store.offset, u.update_id + 1);

    // Botni guruhga qoʻshishgan boʻlsa — roʻyxatga olamiz.
    const joined = u.my_chat_member?.chat;
    if (joined && joined.type !== 'private') {
      store.chats[joined.id] = {
        id: joined.id,
        type: joined.type as TgChat['type'],
        title: joined.title ?? '(nomsiz)',
        username: joined.username,
        lastAt: Date.now(),
      };
    }

    const m = u.message ?? u.channel_post;
    if (!m) continue;

    const text = m.text ?? m.caption ?? '';
    const at = m.date * 1000;
    const chat = m.chat;

    if (chat.type === 'private') {
      const id = chat.id;
      const name =
        [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ')
        || chat.first_name
        || chat.username
        || String(id);
      const prev = store.contacts[id];
      store.contacts[id] = {
        id,
        name,
        username: m.from?.username ?? chat.username,
        lastAt: Math.max(at, prev?.lastAt ?? 0),
        lastText: text || prev?.lastText || '',
        count: (prev?.count ?? 0) + 1,
      };
    } else {
      store.chats[chat.id] = {
        id: chat.id,
        type: chat.type as TgChat['type'],
        title: chat.title ?? '(nomsiz)',
        username: chat.username,
        lastAt: at,
      };
    }

    if (!text) continue;
    out.push({
      chatId: chat.id,
      chatTitle: chat.title ?? chat.first_name ?? chat.username ?? String(chat.id),
      chatType: chat.type,
      messageId: m.message_id,
      from:
        [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ')
        || m.from?.username
        || '(nomaʼlum)',
      fromId: m.from?.id ?? chat.id,
      text,
      at,
    });
  }

  await save();
  return out;
}

/* ------------------------------------------------------------------ */
/*  Kimlar bor                                                         */
/* ------------------------------------------------------------------ */

/** Yozganlar — eng yangisidan boshlab. */
export async function tgContacts(hours = 0): Promise<TgContact[]> {
  const store = await load();
  const since = hours > 0 ? Date.now() - hours * 3600_000 : 0;
  return Object.values(store.contacts)
    .filter((c) => c.lastAt >= since)
    .sort((a, b) => b.lastAt - a.lastAt);
}

/** Bot aʼzo boʻlgan guruh va kanallar. */
export async function tgChats(): Promise<TgChat[]> {
  const store = await load();
  return Object.values(store.chats).sort((a, b) => b.lastAt - a.lastAt);
}

/** Roʻyxatni tozalash — testdan keyin yoki bot almashtirilganda. */
export async function tgForget(): Promise<void> {
  cache = { ...EMPTY, contacts: {}, chats: {} };
  await save();
}

/* ------------------------------------------------------------------ */
/*  Yuborish                                                           */
/* ------------------------------------------------------------------ */

export interface TgSendOpts {
  /** Markdown yoki HTML — belgilanmasa oddiy matn */
  format?: 'Markdown' | 'MarkdownV2' | 'HTML';
  /** Javob berilayotgan xabar */
  replyTo?: number;
  /** Ovozsiz yuborish */
  silent?: boolean;
  /** Tugmalar: [[{matn, havola}]] */
  buttons?: Array<Array<{ text: string; url: string }>>;
}

export async function tgSend(
  chatId: number | string,
  text: string,
  opts: TgSendOpts = {},
  signal?: AbortSignal,
): Promise<number> {
  const res = await call<{ message_id: number }>(
    'sendMessage',
    {
      chat_id: chatId,
      // Telegram chegarasi — 4096 belgi.
      text: text.slice(0, 4096),
      parse_mode: opts.format,
      reply_to_message_id: opts.replyTo,
      disable_notification: opts.silent,
      reply_markup: opts.buttons ? { inline_keyboard: opts.buttons } : undefined,
    },
    signal,
  );
  return res.message_id;
}

export async function tgSendPhoto(
  chatId: number | string,
  photo: string,
  caption = '',
  signal?: AbortSignal,
): Promise<number> {
  const res = await call<{ message_id: number }>(
    'sendPhoto',
    { chat_id: chatId, photo, caption: caption.slice(0, 1024) },
    signal,
  );
  return res.message_id;
}

export interface TgBroadcastResult {
  sent: number;
  failed: Array<{ id: number; error: string }>;
}

/**
 * Bir necha kishiga yuboradi.
 *
 * Ketma-ket va oraliq bilan: birdan yuborilsa Telegram 429 qaytaradi va
 * botni vaqtincha jimlatadi. Bloklagan odamlar xatoga tushadi, qolgani
 * davom etadi — bittasi tufayli hammasi toʻxtab qolmasin.
 */
export async function tgBroadcast(
  targets: Array<number | string>,
  text: string | ((index: number) => string),
  opts: TgSendOpts & { onProgress?: (done: number, total: number) => void } = {},
  signal?: AbortSignal,
): Promise<TgBroadcastResult> {
  const failed: TgBroadcastResult['failed'] = [];
  let sent = 0;

  for (let i = 0; i < targets.length; i += 1) {
    if (signal?.aborted) break;
    const id = targets[i];
    try {
      await tgSend(id, typeof text === 'function' ? text(i) : text, opts, signal);
      sent += 1;
    } catch (err) {
      failed.push({ id: Number(id), error: String((err as Error)?.message ?? err) });
    }
    opts.onProgress?.(i + 1, targets.length);
    if (i < targets.length - 1) await new Promise((r) => setTimeout(r, SEND_GAP_MS));
  }

  return { sent, failed };
}

/* ------------------------------------------------------------------ */
/*  Guruh va kanal boshqaruvi                                          */
/* ------------------------------------------------------------------ */

export async function tgPin(
  chatId: number | string,
  messageId: number,
  signal?: AbortSignal,
): Promise<void> {
  await call('pinChatMessage', { chat_id: chatId, message_id: messageId }, signal);
}

export async function tgDelete(
  chatId: number | string,
  messageId: number,
  signal?: AbortSignal,
): Promise<void> {
  await call('deleteMessage', { chat_id: chatId, message_id: messageId }, signal);
}

/** Guruhdan chiqarish — spam boʻlsa. */
export async function tgBan(
  chatId: number | string,
  userId: number,
  signal?: AbortSignal,
): Promise<void> {
  await call('banChatMember', { chat_id: chatId, user_id: userId }, signal);
}

export interface TgChatInfo {
  id: number;
  title: string;
  type: string;
  members?: number;
  description?: string;
  /** Bot shu yerda adminmi — boshqara olishi shunga bogʻliq */
  botIsAdmin: boolean;
}

export async function tgChatInfo(
  chatId: number | string,
  signal?: AbortSignal,
): Promise<TgChatInfo> {
  const chat = await call<RawChat & { description?: string }>(
    'getChat',
    { chat_id: chatId },
    signal,
  );

  let members: number | undefined;
  try {
    members = await call<number>('getChatMemberCount', { chat_id: chatId }, signal);
  } catch {
    /* kanalda ruxsat boʻlmasligi mumkin */
  }

  let botIsAdmin = false;
  try {
    const me = await tgMe(signal);
    const member = await call<{ status: string }>(
      'getChatMember',
      { chat_id: chatId, user_id: me.id },
      signal,
    );
    botIsAdmin = member.status === 'administrator' || member.status === 'creator';
  } catch {
    /* shaxsiy suhbatda bu tushuncha yoʻq */
  }

  return {
    id: chat.id,
    title: chat.title ?? chat.first_name ?? String(chat.id),
    type: chat.type,
    members,
    description: chat.description,
    botIsAdmin,
  };
}

/** Botning menyusidagi buyruqlar — foydalanuvchi «/» bosganda koʻradi. */
export async function tgSetCommands(
  commands: Array<{ command: string; description: string }>,
  signal?: AbortSignal,
): Promise<void> {
  await call('setMyCommands', { commands }, signal);
}

/* ------------------------------------------------------------------ */
/*  Rejalashtirish                                                     */
/* ------------------------------------------------------------------ */

/**
 * Tokenni bulutga saqlaydi.
 *
 * Rejalashtirilgan xabarni server yuboradi, demak token unga kerak.
 * Alohida jadvalda turadi (RLS — faqat oʻzingiz koʻrasiz), vazifa
 * ichida emas: vazifa natijasi koʻrsatiladi va tarixda qoladi.
 */
export async function tgSaveToken(): Promise<void> {
  const sb = supa();
  if (!sb) throw new Error('Bulut sozlanmagan — rejalashtirish ishlamaydi.');

  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) throw new Error('Avval hisobingizga kiring.');

  const { error } = await sb.from('bot_tokens').upsert({
    user_id: auth.user.id,
    provider: 'telegram',
    token: tgToken(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/**
 * Xabarni keyinga qoʻyadi — telefon oʻchiq boʻlsa ham yuboriladi.
 * Vaqti kelganda Daho serveri bajaradi.
 */
export async function tgSchedule(
  chatIds: Array<number | string>,
  message: string,
  at: Date,
  format?: 'Markdown' | 'HTML',
): Promise<string> {
  if (!chatIds.length) throw new Error('Kimga yuborish koʻrsatilmagan.');
  if (!message.trim()) throw new Error('Xabar matni boʻsh.');

  // Token har safar yangilanadi — foydalanuvchi botni almashtirgan
  // boʻlishi mumkin, eski token bilan yuborilib qolmasin.
  await tgSaveToken();

  const job = await enqueueJob(
    'telegram',
    `Telegram: ${message.slice(0, 60)}`,
    { chat_ids: chatIds.map((c) => String(c)), message: message.slice(0, 4096), format },
    undefined,
    at,
  );
  return job.id;
}
