/**
 * Hisob maʼlumotlari: profil, tarif, kvota, Daho modellari, obuna soʻrovi.
 *
 * Hammasi Supabase ustida RLS bilan himoyalangan — klient faqat oʻziga
 * ruxsat berilgan qatorlarni koʻradi. Modellarning haqiqiy (OpenRouter)
 * nomi bu yerga umuman kelmaydi: server uni `models` koʻrinishida yashiradi.
 */

import { accessToken, onAuth, session } from './auth';
import { functionsUrl, restUrl, server } from './config';

/* ------------------------------------------------------------------ */
/*  Turlar                                                             */
/* ------------------------------------------------------------------ */

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  role: 'user' | 'admin';
  planCode: string;
  planExpiresAt: string | null;
  blocked: boolean;
}

export interface Plan {
  code: string;
  name: string;
  tagline: string;
  rank: number;
  priceUzs: number;
  monthlyTokens: number;
  dailyMessages: number;
  features: string[];
  active: boolean;
}

export interface DahoModel {
  slug: string;
  name: string;
  tagline: string;
  minRank: number;
  contextTokens: number;
  vision: boolean;
  tools: boolean;
  images: boolean;
  sort: number;
  locked: boolean;
}

export interface Quota {
  planCode: string;
  planName: string;
  planRank: number;
  monthlyTokens: number;
  tokensUsed: number;
  tokensLeft: number;
  resetsAt: string;
  planExpiresAt: string | null;
}

export interface SubscriptionRequest {
  id: string;
  userId: string;
  planCode: string;
  months: number;
  status: 'pending' | 'approved' | 'rejected';
  contact: string;
  message: string;
  adminNote: string;
  createdAt: string;
}

export interface Contact {
  telegram: string;
  phone: string;
  email: string;
}

/* ------------------------------------------------------------------ */
/*  REST yordamchisi                                                   */
/* ------------------------------------------------------------------ */

export class AccountError extends Error {}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = server();
  if (!cfg) throw new AccountError('Daho serveri sozlanmagan.');
  const token = await accessToken();

  const res = await fetch(restUrl(path), {
    ...init,
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${token ?? cfg.anonKey}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let message = body.slice(0, 240);
    try {
      const parsed = JSON.parse(body);
      message = parsed?.message ?? parsed?.hint ?? message;
    } catch {
      /* matn holicha qoladi */
    }
    throw new AccountError(message || `Server xatosi (${res.status}).`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Saqlangan RPC chaqiruvi. */
async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return rest<T>(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
}

/* ------------------------------------------------------------------ */
/*  Oʻqish                                                             */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function fetchProfile(): Promise<Profile | null> {
  const s = session();
  if (!s) return null;
  const rows = await rest<any[]>(
    `profiles?id=eq.${s.userId}&select=id,email,full_name,role,plan_code,plan_expires_at,blocked`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email ?? s.email,
    fullName: row.full_name ?? '',
    role: row.role === 'admin' ? 'admin' : 'user',
    planCode: row.plan_code ?? 'free',
    planExpiresAt: row.plan_expires_at ?? null,
    blocked: Boolean(row.blocked),
  };
}

export async function saveProfile(patch: { fullName?: string }): Promise<void> {
  const s = session();
  if (!s) throw new AccountError('Avval hisobingizga kiring.');
  await rest(`profiles?id=eq.${s.userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ full_name: patch.fullName ?? '' }),
  });
}

export async function fetchPlans(): Promise<Plan[]> {
  const rows = await rest<any[]>('plans?select=*&order=rank.asc');
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    tagline: r.tagline ?? '',
    rank: Number(r.rank ?? 0),
    priceUzs: Number(r.price_uzs ?? 0),
    monthlyTokens: Number(r.monthly_tokens ?? 0),
    dailyMessages: Number(r.daily_messages ?? 0),
    features: Array.isArray(r.features) ? r.features : [],
    active: Boolean(r.active),
  }));
}

export async function fetchModels(): Promise<DahoModel[]> {
  const rows = await rest<any[]>('models?select=*&order=sort.asc');
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    tagline: r.tagline ?? '',
    minRank: Number(r.min_rank ?? 0),
    contextTokens: Number(r.context_tokens ?? 0),
    vision: Boolean(r.vision),
    tools: Boolean(r.tools),
    images: Boolean(r.images),
    sort: Number(r.sort ?? 0),
    locked: Boolean(r.locked),
  }));
}

export async function fetchQuota(): Promise<Quota | null> {
  const rows = await rpc<any[]>('quota_state');
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) return null;
  return {
    planCode: row.plan_code ?? 'free',
    planName: row.plan_name ?? 'Bepul',
    planRank: Number(row.plan_rank ?? 0),
    monthlyTokens: Number(row.monthly_tokens ?? 0),
    tokensUsed: Number(row.tokens_used ?? 0),
    tokensLeft: Number(row.tokens_left ?? 0),
    resetsAt: row.resets_at ?? '',
    planExpiresAt: row.plan_expires_at ?? null,
  };
}

export async function fetchContact(): Promise<Contact> {
  try {
    const rows = await rest<any[]>('app_settings?key=eq.contact&select=value');
    const v = rows[0]?.value ?? {};
    return { telegram: v.telegram ?? '', phone: v.phone ?? '', email: v.email ?? '' };
  } catch {
    return { telegram: '', phone: '', email: '' };
  }
}

export async function fetchDownloads(): Promise<{ apk: string; extension: string }> {
  try {
    const rows = await rest<any[]>('app_settings?key=eq.downloads&select=value');
    const v = rows[0]?.value ?? {};
    return { apk: v.apk ?? '', extension: v.extension ?? '' };
  } catch {
    return { apk: '', extension: '' };
  }
}

/* ------------------------------------------------------------------ */
/*  Obuna soʻrovi                                                      */
/* ------------------------------------------------------------------ */

export async function requestSubscription(input: {
  planCode: string;
  months: number;
  contact: string;
  message: string;
}): Promise<void> {
  const s = session();
  if (!s) throw new AccountError('Avval hisobingizga kiring.');
  await rest('subscription_requests', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: s.userId,
      plan_code: input.planCode,
      months: input.months,
      contact: input.contact,
      message: input.message,
    }),
  });
}

export async function myRequests(): Promise<SubscriptionRequest[]> {
  const s = session();
  if (!s) return [];
  const rows = await rest<any[]>(
    `subscription_requests?user_id=eq.${s.userId}&select=*&order=created_at.desc&limit=10`,
  );
  return rows.map(toRequest);
}

function toRequest(r: any): SubscriptionRequest {
  return {
    id: r.id,
    userId: r.user_id,
    planCode: r.plan_code,
    months: Number(r.months ?? 1),
    status: r.status,
    contact: r.contact ?? '',
    message: r.message ?? '',
    adminNote: r.admin_note ?? '',
    createdAt: r.created_at,
  };
}

/* ------------------------------------------------------------------ */
/*  Sarf tarixi                                                        */
/* ------------------------------------------------------------------ */

export interface UsageRow {
  modelSlug: string;
  billed: number;
  createdAt: string;
}

export async function fetchUsage(days = 30): Promise<UsageRow[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = await rest<any[]>(
    `usage_events?created_at=gte.${since}&select=model_slug,billed_tokens,created_at` +
      `&order=created_at.desc&limit=500`,
  );
  return rows.map((r) => ({
    modelSlug: r.model_slug ?? '',
    billed: Number(r.billed_tokens ?? 0),
    createdAt: r.created_at,
  }));
}

/* ------------------------------------------------------------------ */
/*  Kesh — UI har safar tarmoqqa chiqmasin                             */
/* ------------------------------------------------------------------ */

interface Cache {
  profile: Profile | null;
  plans: Plan[];
  models: DahoModel[];
  quota: Quota | null;
  contact: Contact | null;
  loaded: boolean;
}

let cache: Cache = { profile: null, plans: [], models: [], quota: null, contact: null, loaded: false };
const cacheListeners = new Set<() => void>();

export function accountSnapshot(): Cache {
  return cache;
}

export function onAccount(listener: () => void): () => void {
  cacheListeners.add(listener);
  return () => cacheListeners.delete(listener);
}

function publish(patch: Partial<Cache>): void {
  cache = { ...cache, ...patch };
  cacheListeners.forEach((l) => l());
}

/** Hisobga oid hamma narsani qaytadan oʻqiydi. */
export async function refreshAccount(): Promise<void> {
  if (!session()) {
    publish({ profile: null, quota: null, models: [], loaded: true });
    return;
  }
  const [profile, plans, models, quota, contact] = await Promise.all([
    fetchProfile().catch(() => null),
    fetchPlans().catch(() => [] as Plan[]),
    fetchModels().catch(() => [] as DahoModel[]),
    fetchQuota().catch(() => null),
    fetchContact().catch(() => null),
  ]);
  publish({ profile, plans, models, quota, contact, loaded: true });
}

/** Faqat kvotani yangilaydi — har javobdan keyin chaqiriladi. */
export async function refreshQuota(): Promise<void> {
  if (!session()) return;
  const quota = await fetchQuota().catch(() => null);
  if (quota) publish({ quota });
}

export function isAdmin(): boolean {
  return cache.profile?.role === 'admin';
}

/** Kirish/chiqishda kesh oʻzi yangilanadi. */
onAuth(() => {
  cache = { ...cache, loaded: false };
  void refreshAccount();
});

/* ------------------------------------------------------------------ */
/*  Server holati                                                      */
/* ------------------------------------------------------------------ */

export async function pingServer(): Promise<{ ok: boolean; message: string }> {
  try {
    const token = await accessToken();
    const res = await fetch(`${functionsUrl('ai')}/quota`, {
      headers: { Authorization: `Bearer ${token ?? ''}` },
    });
    if (res.ok) return { ok: true, message: 'Server ishlayapti' };
    const body = await res.json().catch(() => ({}));
    return { ok: false, message: body?.error?.message ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: String((err as Error)?.message ?? err) };
  }
}
