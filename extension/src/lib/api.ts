/**
 * Daho serveri bilan ishlash: modellar, suhbat oqimi va sinxronlash.
 */

import { accessToken, session } from './auth';
import { need } from './config';

export interface Model {
  slug: string;
  name: string;
  tagline: string;
}

export interface Quota {
  plan: string;
  tokensLeft: number;
  monthlyTokens: number;
}

async function authHeaders(): Promise<Record<string, string>> {
  const cfg = await need();
  const token = await accessToken();
  if (!token) throw new Error('Avval hisobingizga kiring.');
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function models(): Promise<Model[]> {
  const cfg = await need();
  const res = await fetch(`${cfg.url}/functions/v1/ai/models`, { headers: await authHeaders() });
  if (!res.ok) throw new Error('Modellarni olib boʻlmadi.');
  const data = await res.json();
  return ((data?.data ?? []) as any[]).map((m) => ({
    slug: m.id,
    name: m.name ?? m.id,
    tagline: m.description ?? '',
  }));
}

export async function quota(): Promise<Quota | null> {
  try {
    const cfg = await need();
    const res = await fetch(`${cfg.url}/functions/v1/ai/quota`, { headers: await authHeaders() });
    if (!res.ok) return null;
    const d = await res.json();
    return {
      plan: d.plan ?? 'free',
      tokensLeft: Number(d.tokens_left ?? 0),
      monthlyTokens: Number(d.monthly_tokens ?? 0),
    };
  } catch {
    return null;
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Javobni boʻlak-boʻlak oʻqiydi.
 * `onChunk` har kelgan matn boʻlagi bilan chaqiriladi.
 */
export async function stream(
  model: string,
  messages: ChatTurn[],
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const cfg = await need();
  const res = await fetch(`${cfg.url}/functions/v1/ai/chat/completions`, {
    method: 'POST',
    headers: await authHeaders(),
    signal,
    body: JSON.stringify({ model, messages, stream: true, daho_kind: 'kengaytma' }),
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `Xato (${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          full += delta;
          onChunk(delta);
        }
      } catch {
        /* yarim boʻlak — keyingi oʻqishda toʻliq keladi */
      }
    }
  }
  return full;
}

/* ------------------------------------------------------------------ */
/*  Suhbatlarni sinxronlash                                            */
/* ------------------------------------------------------------------ */

export interface CloudChat {
  id: string;
  title: string;
  messages: Array<{ id: string; role: string; text: string; createdAt: number }>;
  updatedAt: number;
}

export async function recentChats(limit = 12): Promise<CloudChat[]> {
  const cfg = await need();
  const res = await fetch(
    `${cfg.url}/rest/v1/chats?deleted=eq.false&select=id,title,messages,updated_at` +
      `&order=updated_at.desc&limit=${limit}`,
    { headers: await authHeaders() },
  );
  if (!res.ok) return [];
  return ((await res.json()) as any[]).map((r) => ({
    id: r.id,
    title: r.title ?? '',
    messages: Array.isArray(r.messages) ? r.messages : [],
    updatedAt: new Date(r.updated_at).getTime(),
  }));
}

/** Suhbatni bulutga yozadi — ilova va veb ham shu suhbatni koʻradi. */
export async function saveChat(chat: CloudChat): Promise<void> {
  const s = await session();
  if (!s) return;
  const cfg = await need();
  await fetch(`${cfg.url}/rest/v1/chats`, {
    method: 'POST',
    headers: {
      ...(await authHeaders()),
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([
      {
        id: chat.id,
        user_id: s.userId,
        title: chat.title.slice(0, 200),
        messages: chat.messages,
        source: 'extension',
        updated_at: new Date(chat.updatedAt).toISOString(),
      },
    ]),
  });
}

export function newId(): string {
  return crypto.randomUUID();
}
