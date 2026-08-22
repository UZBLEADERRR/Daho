/**
 * Kengaytmadagi hisob.
 *
 * Ilovadagi bilan bir xil Supabase Auth. Sessiya `chrome.storage.local`
 * da turadi, shuning uchun brauzer yopilib ochilsa ham kirgan holda qoladi.
 */

import { need } from './config';

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email: string;
}

const KEY = 'session';

export async function session(): Promise<Session | null> {
  const saved = await chrome.storage.local.get(KEY);
  return (saved[KEY] as Session) ?? null;
}

async function save(s: Session | null): Promise<void> {
  if (s) await chrome.storage.local.set({ [KEY]: s });
  else await chrome.storage.local.remove(KEY);
}

const MESSAGES: Array<[RegExp, string]> = [
  [/invalid login credentials/i, 'Email yoki parol notoʻgʻri.'],
  [/email not confirmed/i, 'Emailingiz hali tasdiqlanmagan.'],
  [/rate limit|too many/i, 'Juda koʻp urinish. Biroz kuting.'],
];

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  let raw = body.slice(0, 200);
  try {
    const parsed = JSON.parse(body);
    raw = parsed?.error_description ?? parsed?.msg ?? parsed?.message ?? raw;
  } catch {
    /* matn holicha */
  }
  for (const [pattern, text] of MESSAGES) if (pattern.test(raw)) return text;
  return raw || 'Nomaʼlum xato.';
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: { id: string; email?: string };
}

async function adopt(data: TokenResponse): Promise<Session> {
  const next: Session = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    userId: data.user?.id ?? '',
    email: data.user?.email ?? '',
  };
  await save(next);
  return next;
}

export async function signIn(email: string, password: string): Promise<Session> {
  const cfg = await need();
  const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return adopt((await res.json()) as TokenResponse);
}

export async function signOut(): Promise<void> {
  await save(null);
}

/** Amaldagi token; muddati tugayotgan boʻlsa yangilaydi. */
export async function accessToken(): Promise<string | null> {
  const s = await session();
  if (!s) return null;
  if (Date.now() < s.expiresAt - 60_000) return s.accessToken;

  const cfg = await need();
  const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: s.refreshToken }),
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) await save(null);
    return null;
  }
  return (await adopt((await res.json()) as TokenResponse)).accessToken;
}
