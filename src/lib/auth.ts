/**
 * Daho hisobi — roʻyxatdan oʻtish, kirish, sessiya.
 *
 * Supabase Auth (GoTrue) ning REST API si bilan toʻgʻridan-toʻgʻri ishlaydi.
 * `@supabase/supabase-js` qoʻshilmaydi: ilova hajmi ~400 KB ga oshmasin.
 *
 * Sessiya `localStorage` da saqlanadi va muddati tugashidan oldin oʻzi
 * yangilanadi, shuning uchun foydalanuvchi har safar qaytadan kirmaydi.
 */

import { authUrl, server } from './config';

const SESSION_KEY = 'daho.session.v1';

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Millisekundlarda — qachon tugaydi */
  expiresAt: number;
  userId: string;
  email: string;
}

export class AuthError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

let current: Session | null = load();
const listeners = new Set<(s: Session | null) => void>();

function load(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.accessToken || !parsed?.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function save(next: Session | null): void {
  current = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* xotira toʻlgan boʻlsa sessiya faqat shu seansda qoladi */
  }
  listeners.forEach((l) => l(next));
}

export function onAuth(listener: (s: Session | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function session(): Session | null {
  return current;
}

export function signedIn(): boolean {
  return current !== null;
}

/* ------------------------------------------------------------------ */
/*  Xatolarni oʻzbekchaga oʻgirish                                     */
/* ------------------------------------------------------------------ */

const MESSAGES: Array<[RegExp, string]> = [
  [/invalid login credentials/i, 'Email yoki parol notoʻgʻri.'],
  [/email not confirmed/i, 'Emailingiz tasdiqlanmagan. Pochtangizdagi havolani bosing.'],
  [/user already registered|already been registered/i, 'Bu email allaqachon roʻyxatdan oʻtgan.'],
  [/password should be at least/i, 'Parol kamida 8 ta belgidan iborat boʻlsin.'],
  [/unable to validate email|invalid email/i, 'Email notoʻgʻri yozilgan.'],
  [/rate limit|too many requests/i, 'Juda koʻp urinish. Bir necha daqiqadan soʻng qayta urinib koʻring.'],
  [/signups not allowed/i, 'Hozircha yangi hisob ochish yopilgan.'],
];

function humanize(raw: string): string {
  for (const [pattern, text] of MESSAGES) if (pattern.test(raw)) return text;
  return raw || 'Nomaʼlum xato.';
}

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(body);
    return humanize(
      parsed?.error_description ?? parsed?.msg ?? parsed?.message ?? parsed?.error ?? body,
    );
  } catch {
    return humanize(body.slice(0, 200));
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const cfg = server();
  if (!cfg) throw new AuthError('Daho serveri sozlanmagan.');
  return { apikey: cfg.anonKey, 'Content-Type': 'application/json', ...extra };
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: { id: string; email?: string };
}

function adopt(data: TokenResponse): Session {
  const next: Session = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    userId: data.user?.id ?? '',
    email: data.user?.email ?? '',
  };
  save(next);
  return next;
}

/* ------------------------------------------------------------------ */
/*  Amallar                                                            */
/* ------------------------------------------------------------------ */

export interface SignUpResult {
  /** Email tasdiqlash kerakmi */
  needsConfirm: boolean;
}

export async function signUp(
  email: string,
  password: string,
  fullName: string,
): Promise<SignUpResult> {
  const res = await fetch(authUrl('signup'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
      data: { full_name: fullName.trim() },
    }),
  });
  if (!res.ok) throw new AuthError(await readError(res), res.status);

  const data = (await res.json()) as TokenResponse & { id?: string };
  // Tasdiqlash yoqilgan boʻlsa token kelmaydi.
  if (!data.access_token) return { needsConfirm: true };
  adopt(data);
  return { needsConfirm: false };
}

export async function signIn(email: string, password: string): Promise<Session> {
  const res = await fetch(authUrl('token?grant_type=password'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  if (!res.ok) throw new AuthError(await readError(res), res.status);
  return adopt((await res.json()) as TokenResponse);
}

export async function signOut(): Promise<void> {
  const s = current;
  save(null);
  if (!s) return;
  try {
    await fetch(authUrl('logout'), {
      method: 'POST',
      headers: headers({ Authorization: `Bearer ${s.accessToken}` }),
    });
  } catch {
    /* internet yoʻq boʻlsa ham qurilmada chiqib boʻlingan */
  }
}

export async function resetPassword(email: string): Promise<void> {
  const res = await fetch(authUrl('recover'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  if (!res.ok) throw new AuthError(await readError(res), res.status);
}

export async function changePassword(password: string): Promise<void> {
  const token = await accessToken();
  if (!token) throw new AuthError('Avval hisobingizga kiring.');
  const res = await fetch(authUrl('user'), {
    method: 'PUT',
    headers: headers({ Authorization: `Bearer ${token}` }),
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new AuthError(await readError(res), res.status);
}

/* ------------------------------------------------------------------ */
/*  Token yangilash                                                    */
/* ------------------------------------------------------------------ */

let refreshing: Promise<Session | null> | null = null;

async function refresh(): Promise<Session | null> {
  const s = current;
  if (!s) return null;

  const res = await fetch(authUrl('token?grant_type=refresh_token'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ refresh_token: s.refreshToken }),
  });

  if (!res.ok) {
    // Refresh token ham yaroqsiz — qaytadan kirish kerak.
    if (res.status === 400 || res.status === 401) save(null);
    return current;
  }
  return adopt((await res.json()) as TokenResponse);
}

/**
 * Amaldagi kirish tokeni. Muddati tugashiga 60 soniya qolganda oʻzi
 * yangilanadi. Bir vaqtda bir nechta soʻrov chaqirsa ham yangilash bitta
 * marta ketadi.
 */
export async function accessToken(): Promise<string | null> {
  const s = current;
  if (!s) return null;
  if (Date.now() < s.expiresAt - 60_000) return s.accessToken;

  refreshing ??= refresh().finally(() => {
    refreshing = null;
  });
  const next = await refreshing;
  return next?.accessToken ?? null;
}

/** Sessiyani fon rejimida tekshirib turadi (ilova uzoq ochiq qolsa). */
export function startAuthKeeper(): () => void {
  const timer = setInterval(() => void accessToken(), 4 * 60_000);
  return () => clearInterval(timer);
}
