/*
 * Supabase Management API — Daho foydalanuvchi nomidan loyiha ocha oladi.
 *
 * Hozirgi `supabase` vositasi anon kalit bilan ishlaydi: yozuv oʻqiy va
 * yoza oladi, lekin JADVAL YARATA OLMAYDI. Shuning uchun agent har safar
 * «SQL ni oʻzingiz SQL Editor ga qoʻying» deb aytishga majbur edi.
 *
 * Management API (api.supabase.com) Personal Access Token bilan ishlaydi
 * va hammasini qila oladi: loyiha yaratish, SQL bajarish, kalit olish,
 * edge funksiya joylash.
 *
 * CORS: api.supabase.com brauzerdan soʻrovni qabul qilmaydi, shuning
 * uchun soʻrovlar Daho serveri (Railway) orqali uzatiladi. Server
 * ulanmagan boʻlsa bevosita urinib koʻriladi — bazi muhitlarda (Android
 * WebView) bu ishlashi mumkin.
 */

import { getState } from './store';
import { serverReady } from './cloud/server';

const BASE = 'https://api.supabase.com/v1';

export interface SbProject {
  id: string;
  ref?: string;
  name: string;
  region: string;
  status: string;
  organization_id: string;
  created_at?: string;
}

export interface SbOrg {
  id: string;
  name: string;
}

export function sbToken(): string {
  return (getState().settings.supabaseToken ?? '').trim();
}

export function sbAdminReady(): boolean {
  return sbToken().length > 20;
}

/** Serverdagi proxy orqali soʻrov — CORS ni chetlab oʻtadi. */
async function viaServer(
  url: string,
  method: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; text: string }> {
  const base = (getState().settings.serverUrl ?? '').trim().replace(/\/+$/, '');
  const secret = (getState().settings.serverSecret ?? '').trim();

  const res = await fetch(`${base}/proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'x-worker-secret': secret } : {}),
    },
    body: JSON.stringify({
      url,
      method,
      headers: { Authorization: `Bearer ${sbToken()}`, 'Content-Type': 'application/json' },
      body,
    }),
    signal,
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    status?: number;
    body?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? `Proxy xatosi (${res.status})`);
  return { ok: Boolean(data.ok), status: data.status ?? 0, text: data.body ?? '' };
}

async function direct(
  url: string,
  method: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${sbToken()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

async function call<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (!sbAdminReady()) {
    throw new Error(
      'Supabase tokeni kiritilmagan. Sozlamalar → Supabase boʻlimiga '
        + 'supabase.com/dashboard/account/tokens dan olingan tokenni qoʻying.',
    );
  }

  const url = `${BASE}${path}`;
  const send = serverReady() ? viaServer : direct;

  let res;
  try {
    res = await send(url, method, body, signal);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    // Server yoʻq boʻlsa brauzer CORS tufayli toʻxtatishi mumkin.
    throw new Error(
      serverReady()
        ? String((err as Error)?.message ?? err)
        : 'Supabase Management API ga brauzerdan bevosita ulanib boʻlmadi (CORS). '
          + 'Sozlamalar → Daho serveri boʻlimidan Railway manzilini ulang.',
    );
  }

  if (!res.ok) {
    let message = res.text.slice(0, 300);
    try {
      const parsed = JSON.parse(res.text) as { message?: string; error?: string };
      message = parsed.message ?? parsed.error ?? message;
    } catch {
      /* matn holida qoladi */
    }
    throw new Error(`Supabase (${res.status}): ${message}`);
  }

  if (!res.text) return {} as T;
  try {
    return JSON.parse(res.text) as T;
  } catch {
    return res.text as unknown as T;
  }
}

/* ------------------------------------------------------------------ */
/*  Amallar                                                            */
/* ------------------------------------------------------------------ */

export function listOrgs(signal?: AbortSignal): Promise<SbOrg[]> {
  return call<SbOrg[]>('/organizations', 'GET', undefined, signal);
}

export function listProjects(signal?: AbortSignal): Promise<SbProject[]> {
  return call<SbProject[]>('/projects', 'GET', undefined, signal);
}

/**
 * Yangi loyiha ochadi. Bazaning paroli qaytariladi — uni bir joyga
 * yozib qoʻyish kerak, Supabase uni boshqa koʻrsatmaydi.
 */
export async function createProject(
  name: string,
  opts: { org?: string; region?: string; password?: string } = {},
  signal?: AbortSignal,
): Promise<{ project: SbProject; password: string }> {
  let org = opts.org;
  if (!org) {
    const orgs = await listOrgs(signal);
    if (!orgs.length) throw new Error('Supabase hisobingizda tashkilot yoʻq.');
    org = orgs[0].id;
  }

  // Parol yetarlicha kuchli boʻlsin — Supabase zaif parolni rad etadi.
  const password =
    opts.password ||
    `Daho${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6).toUpperCase()}!7`;

  const project = await call<SbProject>(
    '/projects',
    'POST',
    {
      name: name.slice(0, 60),
      organization_id: org,
      region: opts.region || 'eu-central-1',
      db_pass: password,
    },
    signal,
  );

  return { project, password };
}

/** Loyihada SQL bajaradi — CREATE TABLE ham, hammasi. */
export function runSql(
  ref: string,
  query: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return call(`/projects/${encodeURIComponent(ref)}/database/query`, 'POST', { query }, signal);
}

/** Loyihaning API kalitlari (anon va service_role). */
export function projectKeys(
  ref: string,
  signal?: AbortSignal,
): Promise<Array<{ name: string; api_key: string }>> {
  return call(`/projects/${encodeURIComponent(ref)}/api-keys`, 'GET', undefined, signal);
}

/** Loyiha manzili — mijozga shu kerak. */
export function projectUrl(ref: string): string {
  return `https://${ref}.supabase.co`;
}
