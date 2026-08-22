/**
 * Admin amallari.
 *
 * Hammasi oddiy PostgREST soʻrovlari — himoya RLS da: `is_admin()` rost
 * boʻlmasa Supabase bu qatorlarni koʻrsatmaydi ham, oʻzgartirtirmaydi ham.
 * Shu sababli bu yerda alohida «admin kaliti» yoʻq.
 */

import { accessToken } from './auth';
import { restUrl, server } from './config';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = server();
  if (!cfg) throw new Error('Daho serveri sozlanmagan.');
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
      message = JSON.parse(body)?.message ?? message;
    } catch {
      /* matn holicha */
    }
    throw new Error(message || `Server xatosi (${res.status}).`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/*  Modellar                                                           */
/* ------------------------------------------------------------------ */

export interface AdminModel {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  upstreamRef: string;
  upstream: string;
  minRank: number;
  tokenMultiplier: number;
  contextTokens: number;
  vision: boolean;
  tools: boolean;
  images: boolean;
  sort: number;
  active: boolean;
}

function toModel(r: any): AdminModel {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    tagline: r.tagline ?? '',
    upstreamRef: r.upstream_ref ?? '',
    upstream: r.upstream ?? 'openrouter',
    minRank: Number(r.min_rank ?? 0),
    tokenMultiplier: Number(r.token_multiplier ?? 1),
    contextTokens: Number(r.context_tokens ?? 32000),
    vision: Boolean(r.vision),
    tools: Boolean(r.tools),
    images: Boolean(r.images),
    sort: Number(r.sort ?? 100),
    active: Boolean(r.active),
  };
}

function fromModel(m: Partial<AdminModel>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (m.slug !== undefined) out.slug = m.slug;
  if (m.name !== undefined) out.name = m.name;
  if (m.tagline !== undefined) out.tagline = m.tagline;
  if (m.upstreamRef !== undefined) out.upstream_ref = m.upstreamRef;
  if (m.upstream !== undefined) out.upstream = m.upstream;
  if (m.minRank !== undefined) out.min_rank = m.minRank;
  if (m.tokenMultiplier !== undefined) out.token_multiplier = m.tokenMultiplier;
  if (m.contextTokens !== undefined) out.context_tokens = m.contextTokens;
  if (m.vision !== undefined) out.vision = m.vision;
  if (m.tools !== undefined) out.tools = m.tools;
  if (m.images !== undefined) out.images = m.images;
  if (m.sort !== undefined) out.sort = m.sort;
  if (m.active !== undefined) out.active = m.active;
  return out;
}

export async function adminModels(): Promise<AdminModel[]> {
  const rows = await rest<any[]>('daho_models?select=*&order=sort.asc');
  return rows.map(toModel);
}

export async function saveModel(model: Partial<AdminModel> & { id?: string }): Promise<void> {
  if (model.id) {
    await rest(`daho_models?id=eq.${model.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(fromModel(model)),
    });
  } else {
    await rest('daho_models', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(fromModel(model)),
    });
  }
}

export async function deleteModel(id: string): Promise<void> {
  await rest(`daho_models?id=eq.${id}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}

/* ------------------------------------------------------------------ */
/*  Tariflar                                                           */
/* ------------------------------------------------------------------ */

export interface AdminPlan {
  id: string;
  code: string;
  name: string;
  tagline: string;
  rank: number;
  priceUzs: number;
  monthlyTokens: number;
  features: string[];
  active: boolean;
}

export async function adminPlans(): Promise<AdminPlan[]> {
  const rows = await rest<any[]>('plans?select=*&order=rank.asc');
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    tagline: r.tagline ?? '',
    rank: Number(r.rank ?? 0),
    priceUzs: Number(r.price_uzs ?? 0),
    monthlyTokens: Number(r.monthly_tokens ?? 0),
    features: Array.isArray(r.features) ? r.features : [],
    active: Boolean(r.active),
  }));
}

export async function savePlan(plan: Partial<AdminPlan> & { id?: string }): Promise<void> {
  const body: Record<string, unknown> = {};
  if (plan.code !== undefined) body.code = plan.code;
  if (plan.name !== undefined) body.name = plan.name;
  if (plan.tagline !== undefined) body.tagline = plan.tagline;
  if (plan.rank !== undefined) body.rank = plan.rank;
  if (plan.priceUzs !== undefined) body.price_uzs = plan.priceUzs;
  if (plan.monthlyTokens !== undefined) body.monthly_tokens = plan.monthlyTokens;
  if (plan.features !== undefined) body.features = plan.features;
  if (plan.active !== undefined) body.active = plan.active;

  if (plan.id) {
    await rest(`plans?id=eq.${plan.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    });
  } else {
    await rest('plans', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Foydalanuvchilar                                                   */
/* ------------------------------------------------------------------ */

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  planCode: string;
  planExpiresAt: string | null;
  tokensUsed: number;
  blocked: boolean;
  createdAt: string;
}

export async function adminUsers(search = ''): Promise<AdminUser[]> {
  const q = search.trim()
    ? `&or=(email.ilike.*${encodeURIComponent(search.trim())}*,full_name.ilike.*${encodeURIComponent(search.trim())}*)`
    : '';
  const rows = await rest<any[]>(
    `profiles?select=*&order=created_at.desc&limit=100${q}`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email ?? '',
    fullName: r.full_name ?? '',
    role: r.role ?? 'user',
    planCode: r.plan_code ?? 'free',
    planExpiresAt: r.plan_expires_at ?? null,
    tokensUsed: Number(r.tokens_used ?? 0),
    blocked: Boolean(r.blocked),
    createdAt: r.created_at,
  }));
}

/** Foydalanuvchiga tarif beradi (yoki muddatini uzaytiradi). */
export async function grantPlan(userId: string, planCode: string, months: number): Promise<void> {
  const until = new Date();
  until.setMonth(until.getMonth() + Math.max(months, 1));
  await rest(`profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      plan_code: planCode,
      plan_expires_at: planCode === 'free' ? null : until.toISOString(),
    }),
  });
}

export async function setBlocked(userId: string, blocked: boolean): Promise<void> {
  await rest(`profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ blocked }),
  });
}

export async function setRole(userId: string, role: 'user' | 'admin'): Promise<void> {
  await rest(`profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ role }),
  });
}

/** Oylik token hisobini nolga tushiradi. */
export async function resetTokens(userId: string): Promise<void> {
  await rest(`profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ tokens_used: 0, period_start: new Date().toISOString() }),
  });
}

/* ------------------------------------------------------------------ */
/*  Obuna soʻrovlari                                                   */
/* ------------------------------------------------------------------ */

export interface AdminRequest {
  id: string;
  userId: string;
  email: string;
  planCode: string;
  months: number;
  status: string;
  contact: string;
  message: string;
  createdAt: string;
}

export async function adminRequests(status = 'pending'): Promise<AdminRequest[]> {
  const filter = status === 'all' ? '' : `status=eq.${status}&`;
  const rows = await rest<any[]>(
    `subscription_requests?${filter}select=*,profiles(email)&order=created_at.desc&limit=100`,
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    email: r.profiles?.email ?? '',
    planCode: r.plan_code,
    months: Number(r.months ?? 1),
    status: r.status,
    contact: r.contact ?? '',
    message: r.message ?? '',
    createdAt: r.created_at,
  }));
}

/** Soʻrovni tasdiqlaydi: tarif beriladi va soʻrov yopiladi. */
export async function approveRequest(req: AdminRequest, note = ''): Promise<void> {
  await grantPlan(req.userId, req.planCode, req.months);
  await rest(`subscription_requests?id=eq.${req.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'approved',
      admin_note: note,
      decided_at: new Date().toISOString(),
    }),
  });
}

export async function rejectRequest(id: string, note = ''): Promise<void> {
  await rest(`subscription_requests?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'rejected',
      admin_note: note,
      decided_at: new Date().toISOString(),
    }),
  });
}

/* ------------------------------------------------------------------ */
/*  Koʻrsatkichlar va sozlamalar                                       */
/* ------------------------------------------------------------------ */

export interface AdminStats {
  users: number;
  paidUsers: number;
  pending: number;
  tokensMonth: number;
  tokensToday: number;
  topModels: Array<{ slug: string; tokens: number }>;
}

export async function adminStats(): Promise<AdminStats> {
  const raw = await rest<any>('rpc/admin_stats', { method: 'POST', body: '{}' });
  return {
    users: Number(raw?.users ?? 0),
    paidUsers: Number(raw?.paid_users ?? 0),
    pending: Number(raw?.pending ?? 0),
    tokensMonth: Number(raw?.tokens_month ?? 0),
    tokensToday: Number(raw?.tokens_today ?? 0),
    topModels: Array.isArray(raw?.top_models)
      ? raw.top_models.map((t: any) => ({ slug: t.slug ?? '', tokens: Number(t.tokens ?? 0) }))
      : [],
  };
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await rest('app_settings', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value }),
  });
}

export async function readSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const rows = await rest<any[]>(`app_settings?key=eq.${key}&select=value`);
    return (rows[0]?.value as T) ?? fallback;
  } catch {
    return fallback;
  }
}
