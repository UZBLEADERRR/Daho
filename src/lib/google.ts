/*
 * Google xizmatlari — Gmail, Drive, Calendar.
 *
 * Ulanish OAuth 2.0 + PKCE orqali: client secret kerak emas, shuning
 * uchun brauzerdagi ilova ham xavfsiz ulana oladi. Foydalanuvchi bir
 * marta Google Cloud Console da OAuth mijoz ochib, uning ID sini
 * kiritadi — keyin hammasi avtomatik.
 *
 * Tokenlar faqat shu qurilmada saqlanadi va bulutga sinxronlanmaydi.
 * Access token bir soatda tugaydi; refresh token bilan oʻzi yangilanadi.
 */

import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { getState, updateSettings } from './store';
import { serverReady } from './cloud/server';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Nimalarga ruxsat soʻraymiz. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar',
  // Oʻz kanalidagi izohlarni oʻqish va ularga javob berish uchun
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

/** Google API ga umumiy chaqiruv — boshqa modullar ham ishlatadi. */
export async function googleApi<T>(
  url: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  return api<T>(url, init);
}

export interface GoogleAuth {
  accessToken: string;
  refreshToken: string;
  /** Qachon tugaydi (ms) */
  expiresAt: number;
  email?: string;
}

/* ------------------------------------------------------------------ */
/*  PKCE                                                               */
/* ------------------------------------------------------------------ */

function randomString(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

function base64Url(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(digest);
}

const VERIFIER_KEY = 'daho.google.verifier';

/** Ilova telefondagi APK ichida ishlayaptimi. */
function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Sozlamalardagi server manzili — oxiridagi slashlarsiz. */
function serverBase(): string {
  return (getState().settings.serverUrl ?? '').trim().replace(/\/+$/, '');
}

/**
 * Google shu manzilga qaytaradi.
 *
 * Vebda bu sahifaning oʻz manzili. Telefonda esa ilova `https://localhost`
 * ichida ishlaydi va Google bunday manzilni qabul qilmaydi. Shuning uchun
 * Daho serveridagi `/oauth/callback` ishlatiladi: u kodni olib,
 * `uz.daho.app://oauth?code=…` deep link bilan ilovaga qaytaradi.
 */
export function redirectUri(): string {
  if (isNative()) {
    const base = serverBase();
    if (base) return `${base}/oauth/callback`;
  }
  const { origin, pathname } = window.location;
  return `${origin}${pathname}`.replace(/\/index\.html$/, '/');
}

/**
 * Ulanishni boshlaydi — Google sahifasiga oʻtkazadi.
 * Qaytgach `finishGoogleAuth()` chaqirilishi kerak.
 */
export async function startGoogleAuth(): Promise<void> {
  const clientId = (getState().settings.googleClientId ?? '').trim();
  if (!clientId) throw new Error('Google mijoz ID si kiritilmagan.');

  if (isNative() && !serverBase()) {
    throw new Error(
      'Telefonda Google ulanishi uchun avval Sozlamalar → Daho serveri '
        + 'boʻlimida server manzilini kiriting: Google «localhost» ga qaytara olmaydi.',
    );
  }

  const verifier = randomString();
  // localStorage — telefonda Google tizim brauzerida ochiladi va ilova
  // fonga tushadi; sessionStorage bunda yoʻqolib ketishi mumkin.
  localStorage.setItem(VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: 'S256',
    // Refresh token faqat shu ikkisi bilan beriladi.
    access_type: 'offline',
    prompt: 'consent',
  });

  const url = `${AUTH_URL}?${params.toString()}`;

  if (isNative()) {
    // Google oʻrnatilgan WebView da OAuth ga ruxsat bermaydi
    // («disallowed_useragent»), shuning uchun tizim brauzeri ochiladi.
    await Browser.open({ url });
    return;
  }
  window.location.assign(url);
}

/**
 * Telefonda qaytishni kutadi.
 *
 * Server `uz.daho.app://oauth?code=…` deep link yuboradi; shu kelganda
 * brauzer yopiladi va kod tokenga almashtiriladi.
 */
export function listenGoogleRedirect(
  onDone?: (ok: boolean, error?: string) => void,
): void {
  if (!isNative()) return;

  void CapApp.addListener('appUrlOpen', (event: { url: string }) => {
    let code: string | null = null;
    let error: string | null = null;
    try {
      const link = new URL(event.url);
      code = link.searchParams.get('code');
      error = link.searchParams.get('error');
    } catch {
      return; // Bizga tegishli boʻlmagan havola
    }
    if (!code && !error) return;

    void Browser.close().catch(() => undefined);
    if (error) {
      onDone?.(false, error);
      return;
    }

    void finishGoogleAuth(code ?? undefined).then(
      (ok) => onDone?.(ok),
      (err) => onDone?.(false, String((err as Error)?.message ?? err)),
    );
  });
}

/** Token almashinuvi — server bor boʻlsa oʻsha orqali. */
async function tokenRequest(body: URLSearchParams): Promise<Record<string, unknown>> {
  const settings = getState().settings;

  if (serverReady()) {
    const base = (settings.serverUrl ?? '').trim().replace(/\/+$/, '');
    const res = await fetch(`${base}/proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.serverSecret ? { 'x-worker-secret': settings.serverSecret } : {}),
      },
      body: JSON.stringify({
        url: TOKEN_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }),
    });
    const wrapped = (await res.json()) as { ok?: boolean; body?: string };
    const parsed = JSON.parse(wrapped.body || '{}') as Record<string, unknown>;
    if (!wrapped.ok) throw new Error(String(parsed.error_description ?? parsed.error ?? 'token xatosi'));
    return parsed;
  }

  // Google token manzili PKCE mijozlari uchun CORS ga ruxsat beradi.
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const parsed = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(parsed.error_description ?? parsed.error ?? 'token xatosi'));
  return parsed;
}

/**
 * Google qaytargan `code` ni tokenga almashtiradi.
 * Manzilda `code` boʻlmasa hech narsa qilmaydi.
 */
export async function finishGoogleAuth(codeFromLink?: string): Promise<boolean> {
  let code = codeFromLink ?? null;

  if (!code) {
    const url = new URL(window.location.href);
    code = url.searchParams.get('code');
    if (code) {
      // Manzilni tozalaymiz — kod bir marta ishlatiladi, tarixda qolmasin.
      url.searchParams.delete('code');
      url.searchParams.delete('scope');
      url.searchParams.delete('authuser');
      url.searchParams.delete('prompt');
      window.history.replaceState({}, '', url.toString());
    }
  }
  if (!code) return false;

  const verifier = localStorage.getItem(VERIFIER_KEY) ?? sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) return false;
  localStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);

  const clientId = (getState().settings.googleClientId ?? '').trim();
  const data = await tokenRequest(
    new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
    }),
  );

  updateSettings({
    googleAuth: {
      accessToken: String(data.access_token ?? ''),
      refreshToken: String(data.refresh_token ?? ''),
      expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    },
  });
  return true;
}

/** Amaldagi token — kerak boʻlsa yangilanadi. */
export async function googleToken(): Promise<string> {
  const auth = getState().settings.googleAuth;
  if (!auth?.accessToken) throw new Error('Google hisobi ulanmagan.');

  // 60 soniya zaxira bilan yangilaymiz — soʻrov yoʻlda tugab qolmasin.
  if (auth.expiresAt > Date.now() + 60_000) return auth.accessToken;
  if (!auth.refreshToken) throw new Error('Google ulanishi eskirgan — qaytadan ulang.');

  const clientId = (getState().settings.googleClientId ?? '').trim();
  const data = await tokenRequest(
    new URLSearchParams({
      client_id: clientId,
      refresh_token: auth.refreshToken,
      grant_type: 'refresh_token',
    }),
  );

  const next: GoogleAuth = {
    ...auth,
    accessToken: String(data.access_token ?? ''),
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
  };
  updateSettings({ googleAuth: next });
  return next.accessToken;
}

export function googleReady(): boolean {
  return Boolean(getState().settings.googleAuth?.accessToken);
}

export function disconnectGoogle(): void {
  updateSettings({ googleAuth: undefined });
}

/* ------------------------------------------------------------------ */
/*  API chaqiruvlari                                                   */
/* ------------------------------------------------------------------ */

async function api<T>(
  url: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const token = await googleToken();
  const settings = getState().settings;

  // Google API lari brauzerdan CORS bilan ishlaydi, lekin server bor
  // boʻlsa oʻsha orqali yuboramiz — ishonchliroq.
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
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: init.body,
      }),
      signal: init.signal,
    });
    const wrapped = (await res.json()) as { ok?: boolean; status?: number; body?: string };
    if (!wrapped.ok) {
      throw new Error(`Google (${wrapped.status}): ${(wrapped.body ?? '').slice(0, 200)}`);
    }
    return JSON.parse(wrapped.body || '{}') as T;
  }

  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google (${res.status}): ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/* ---------- Gmail ---------- */

export interface MailSummary {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

function headerOf(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export async function searchMail(query: string, limit = 10): Promise<MailSummary[]> {
  const list = await api<{ messages?: Array<{ id: string }> }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`,
  );
  const ids = (list.messages ?? []).slice(0, limit);

  return Promise.all(
    ids.map(async ({ id }) => {
      const msg = await api<{
        snippet?: string;
        payload?: { headers?: Array<{ name: string; value: string }> };
      }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata`
          + '&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date',
      );
      const headers = msg.payload?.headers ?? [];
      return {
        id,
        from: headerOf(headers, 'From'),
        subject: headerOf(headers, 'Subject'),
        date: headerOf(headers, 'Date'),
        snippet: msg.snippet ?? '',
      };
    }),
  );
}

/** Xatning toʻliq matni. */
export async function readMail(id: string): Promise<string> {
  const msg = await api<{
    payload?: {
      body?: { data?: string };
      parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
    };
  }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);

  const decode = (data?: string): string => {
    if (!data) return '';
    try {
      return decodeURIComponent(
        escape(atob(data.replace(/-/g, '+').replace(/_/g, '/'))),
      );
    } catch {
      return '';
    }
  };

  const parts = msg.payload?.parts ?? [];
  const plain = parts.find((p) => p.mimeType === 'text/plain')?.body?.data;
  return (decode(plain) || decode(msg.payload?.body?.data) || '').slice(0, 20000);
}

export async function sendMail(to: string, subject: string, body: string): Promise<string> {
  // RFC 2822 xat, keyin base64url. Sarlavhada oʻzbekcha harf boʻlishi
  // mumkin — shuning uchun MIME kodlash ishlatamiz.
  const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
  const raw = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ].join('\r\n');

  const encoded = btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const res = await api<{ id: string }>(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    { method: 'POST', body: { raw: encoded } },
  );
  return res.id;
}

/* ---------- Drive ---------- */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

export async function listDrive(query = '', limit = 20): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    pageSize: String(limit),
    fields: 'files(id,name,mimeType,modifiedTime)',
    orderBy: 'modifiedTime desc',
  });
  if (query) params.set('q', `name contains '${query.replace(/'/g, "\\'")}'`);
  const res = await api<{ files?: DriveFile[] }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
  );
  return res.files ?? [];
}

/** Matnli faylni oʻqiydi. Google Docs boʻlsa oddiy matnga oʻgiriladi. */
export async function readDrive(id: string): Promise<string> {
  const meta = await api<{ mimeType: string; name: string }>(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=mimeType,name`,
  );

  const url = meta.mimeType.startsWith('application/vnd.google-apps')
    ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`
    : `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;

  const token = await googleToken();
  const settings = getState().settings;

  if (serverReady()) {
    const base = (settings.serverUrl ?? '').trim().replace(/\/+$/, '');
    const res = await fetch(`${base}/proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.serverSecret ? { 'x-worker-secret': settings.serverSecret } : {}),
      },
      body: JSON.stringify({ url, method: 'GET', headers: { Authorization: `Bearer ${token}` } }),
    });
    const wrapped = (await res.json()) as { ok?: boolean; body?: string };
    if (!wrapped.ok) throw new Error('Faylni oʻqib boʻlmadi');
    return (wrapped.body ?? '').slice(0, 20000);
  }

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive (${res.status})`);
  return (await res.text()).slice(0, 20000);
}

/* ---------- Calendar ---------- */

export interface CalEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
}

export async function listEvents(days = 7): Promise<CalEvent[]> {
  const now = new Date();
  const until = new Date(now.getTime() + days * 86400000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: until.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '25',
  });

  const res = await api<{
    items?: Array<{
      id: string;
      summary?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`);

  return (res.items ?? []).map((e) => ({
    id: e.id,
    summary: e.summary ?? '(nomsiz)',
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    location: e.location,
  }));
}

export async function addEvent(
  summary: string,
  startIso: string,
  endIso: string,
  description = '',
): Promise<string> {
  const res = await api<{ id: string; htmlLink?: string }>(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      body: {
        summary,
        description,
        start: { dateTime: startIso },
        end: { dateTime: endIso },
      },
    },
  );
  return res.htmlLink ?? res.id;
}
