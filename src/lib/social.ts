/*
 * Ijtimoiy tarmoqlar — Instagram va YouTube bilan RASMIY API orqali ishlash.
 *
 * Nega brauzerni bosib turadigan usul emas: kuniga minglab DM va izohga
 * javob berish kerak boʻlsa, sahifani bosib turish soatiga 20-30 tada
 * tiqiladi, selektorlar har yangilanishda buziladi va hisob bloklanadi.
 * Instagram Graph API aynan shu ish uchun qilingan — cheklovi minglab va
 * u rasman qoʻllab-quvvatlanadi.
 *
 * Kerak boʻladi:
 * - Instagram: Business yoki Creator hisob + Facebook sahifasi + token
 * - YouTube: oddiy Google ulanishi (youtube.force-ssl qamrovi)
 */

import { getState } from './store';
import { googleApi } from './google';
import { serverReady } from './cloud/server';

const FB = 'https://graph.facebook.com/v21.0';
const YT = 'https://www.googleapis.com/youtube/v3';

/* ------------------------------------------------------------------ */
/*  Instagram                                                          */
/* ------------------------------------------------------------------ */

export function igReady(): boolean {
  const s = getState().settings;
  return Boolean(s.igToken && s.igUserId);
}

/** Facebook Graph ga soʻrov — server bor boʻlsa proxy orqali. */
async function fb<T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const settings = getState().settings;
  const token = (settings.igToken ?? '').trim();
  if (!token) throw new Error('Instagram tokeni kiritilmagan.');

  const sep = path.includes('?') ? '&' : '?';
  const url = `${FB}${path}${sep}access_token=${encodeURIComponent(token)}`;

  const run = async (): Promise<{ ok: boolean; status: number; text: string }> => {
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
          method: init.method ?? 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: init.body,
        }),
        signal: init.signal,
      });
      const w = (await res.json()) as { ok?: boolean; status?: number; body?: string };
      return { ok: Boolean(w.ok), status: w.status ?? 0, text: w.body ?? '' };
    }

    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  };

  const res = await run();
  if (!res.ok) {
    let message = res.text.slice(0, 300);
    try {
      const parsed = JSON.parse(res.text) as { error?: { message?: string } };
      message = parsed.error?.message ?? message;
    } catch {
      /* matn holida */
    }
    throw new Error(`Instagram (${res.status}): ${message}`);
  }
  return (res.text ? JSON.parse(res.text) : {}) as T;
}

export interface IgMedia {
  id: string;
  caption?: string;
  media_type: string;
  permalink: string;
  timestamp: string;
  comments_count?: number;
  like_count?: number;
}

export interface IgComment {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  /** Shu izohga allaqachon javob berilganmi */
  replied?: boolean;
}

/** Oxirgi postlar va videolar. */
export async function igMedia(limit = 10, signal?: AbortSignal): Promise<IgMedia[]> {
  const user = getState().settings.igUserId;
  const res = await fb<{ data?: IgMedia[] }>(
    `/${user}/media?fields=id,caption,media_type,permalink,timestamp,comments_count,like_count&limit=${limit}`,
    { signal },
  );
  return res.data ?? [];
}

/** Bitta postdagi izohlar — javob berilganlari belgilanadi. */
export async function igComments(
  mediaId: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<IgComment[]> {
  const res = await fb<{
    data?: Array<{
      id: string;
      text: string;
      username: string;
      timestamp: string;
      replies?: { data?: unknown[] };
    }>;
  }>(
    `/${mediaId}/comments?fields=id,text,username,timestamp,replies{id}&limit=${limit}`,
    { signal },
  );

  return (res.data ?? []).map((c) => ({
    id: c.id,
    text: c.text,
    username: c.username,
    timestamp: c.timestamp,
    replied: Boolean(c.replies?.data?.length),
  }));
}

/** Izohga javob yozadi. */
export async function igReply(
  commentId: string,
  message: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fb<{ id: string }>(`/${commentId}/replies`, {
    method: 'POST',
    body: { message: message.slice(0, 2200) },
    signal,
  });
  return res.id;
}

/** Izohni yashirish — spam yoki haqorat boʻlsa. */
export async function igHide(commentId: string, hide = true, signal?: AbortSignal): Promise<void> {
  await fb(`/${commentId}?hide=${hide}`, { method: 'POST', signal });
}

export interface IgConversation {
  id: string;
  /** Suhbatdosh */
  username: string;
  userId: string;
  lastMessage: string;
  updatedAt: string;
}

/**
 * Direct suhbatlar.
 *
 * Diqqat: Instagram faqat foydalanuvchi SIZGA yozgan boʻlsa va oxirgi
 * xabardan 24 soat oʻtmagan boʻlsa javob berishga ruxsat beradi. Bu
 * Meta ning qoidasi — API shundan tashqarisiga yoʻl qoʻymaydi.
 */
export async function igConversations(
  limit = 20,
  signal?: AbortSignal,
): Promise<IgConversation[]> {
  const user = getState().settings.igUserId;
  const res = await fb<{
    data?: Array<{
      id: string;
      updated_time?: string;
      participants?: { data?: Array<{ id: string; username?: string }> };
      messages?: { data?: Array<{ message?: string }> };
    }>;
  }>(
    `/${user}/conversations?platform=instagram&fields=id,updated_time,participants,messages.limit(1){message}&limit=${limit}`,
    { signal },
  );

  return (res.data ?? []).map((c) => {
    // Ikki qatnashchidan biri — oʻzimiz, ikkinchisi suhbatdosh.
    const other = (c.participants?.data ?? []).find((p) => p.id !== user);
    return {
      id: c.id,
      username: other?.username ?? '(nomaʼlum)',
      userId: other?.id ?? '',
      lastMessage: c.messages?.data?.[0]?.message ?? '',
      updatedAt: c.updated_time ?? '',
    };
  });
}

/** Suhbatdagi xabarlar. */
export async function igMessages(
  conversationId: string,
  limit = 25,
  signal?: AbortSignal,
): Promise<Array<{ from: string; text: string; at: string }>> {
  const user = getState().settings.igUserId;
  const res = await fb<{
    messages?: {
      data?: Array<{ id: string; message?: string; from?: { id: string; username?: string }; created_time?: string }>;
    };
  }>(
    `/${conversationId}?fields=messages.limit(${limit}){message,from,created_time}`,
    { signal },
  );

  return (res.messages?.data ?? [])
    .reverse()
    .map((m) => ({
      from: m.from?.id === user ? 'men' : m.from?.username ?? 'suhbatdosh',
      text: m.message ?? '',
      at: m.created_time ?? '',
    }))
    .filter((m) => m.text);
}

/** Direct xabar yuboradi. */
export async function igSend(
  recipientId: string,
  message: string,
  signal?: AbortSignal,
): Promise<string> {
  const user = getState().settings.igUserId;
  const res = await fb<{ message_id?: string }>(`/${user}/messages`, {
    method: 'POST',
    body: {
      recipient: { id: recipientId },
      message: { text: message.slice(0, 1000) },
    },
    signal,
  });
  return res.message_id ?? 'yuborildi';
}

/* ------------------------------------------------------------------ */
/*  YouTube                                                            */
/* ------------------------------------------------------------------ */

export interface YtVideo {
  id: string;
  title: string;
  publishedAt: string;
  views?: string;
  comments?: string;
}

/** Oʻz kanalidagi oxirgi videolar. */
export async function ytVideos(limit = 10, signal?: AbortSignal): Promise<YtVideo[]> {
  const mine = await googleApi<{
    items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
  }>(`${YT}/channels?part=contentDetails&mine=true`, { signal });

  const uploads = mine.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];

  const list = await googleApi<{
    items?: Array<{ snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } } }>;
  }>(`${YT}/playlistItems?part=snippet&playlistId=${uploads}&maxResults=${limit}`, { signal });

  const ids = (list.items ?? [])
    .map((i) => i.snippet?.resourceId?.videoId)
    .filter(Boolean) as string[];
  if (!ids.length) return [];

  const stats = await googleApi<{
    items?: Array<{ id: string; statistics?: { viewCount?: string; commentCount?: string } }>;
  }>(`${YT}/videos?part=statistics&id=${ids.join(',')}`, { signal });

  const byId = new Map((stats.items ?? []).map((v) => [v.id, v.statistics]));
  return (list.items ?? []).map((i) => {
    const id = i.snippet?.resourceId?.videoId ?? '';
    return {
      id,
      title: i.snippet?.title ?? '',
      publishedAt: i.snippet?.publishedAt ?? '',
      views: byId.get(id)?.viewCount,
      comments: byId.get(id)?.commentCount,
    };
  });
}

export interface YtComment {
  id: string;
  text: string;
  author: string;
  publishedAt: string;
  likes: number;
  replyCount: number;
}

/** Videodagi izohlar. */
export async function ytComments(
  videoId: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<YtComment[]> {
  const res = await googleApi<{
    items?: Array<{
      snippet?: {
        topLevelComment?: {
          id: string;
          snippet?: {
            textDisplay?: string;
            authorDisplayName?: string;
            publishedAt?: string;
            likeCount?: number;
          };
        };
        totalReplyCount?: number;
      };
    }>;
  }>(
    `${YT}/commentThreads?part=snippet&videoId=${videoId}&maxResults=${Math.min(100, limit)}&order=time`,
    { signal },
  );

  return (res.items ?? []).map((i) => {
    const c = i.snippet?.topLevelComment;
    return {
      id: c?.id ?? '',
      text: (c?.snippet?.textDisplay ?? '').replace(/<[^>]+>/g, ''),
      author: c?.snippet?.authorDisplayName ?? '',
      publishedAt: c?.snippet?.publishedAt ?? '',
      likes: c?.snippet?.likeCount ?? 0,
      replyCount: i.snippet?.totalReplyCount ?? 0,
    };
  });
}

/** Izohga javob yozadi. */
export async function ytReply(
  commentId: string,
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await googleApi<{ id: string }>(`${YT}/comments?part=snippet`, {
    method: 'POST',
    body: { snippet: { parentId: commentId, textOriginal: text.slice(0, 9000) } },
    signal,
  });
  return res.id;
}
