/**
 * Admin panel uchun so'rovlar. Hammasi RLS bilan himoyalangan —
 * oddiy foydalanuvchi bu funksiyalardan hech narsa ololmaydi.
 */
import { supa } from './client';
import type { CloudPlan, UsageRow } from './types';

function client() {
  const sb = supa();
  if (!sb) throw new Error('Bulut sozlanmagan');
  return sb;
}

export interface AdminStats {
  users: number;
  active_subs: number;
  paid_subs: number;
  mrr_cents: number;
  tokens_today: number;
  tokens_month: number;
  credits_today: number;
  credits_month: number;
  jobs_queued: number;
  pending_requests: number;
  top_models: Array<{ model: string; tokens: number; credits: number; calls: number }>;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  role: 'user' | 'admin';
  blocked: boolean;
  created_at: string;
  plan_name: string | null;
  plan_code: string | null;
  sub_status: string | null;
  expires_at: string | null;
  balance: number | null;
  used: number | null;
  period_end: string | null;
  tokens_month: number;
  credits_month: number;
}

export interface PlanModelRow {
  id: string;
  plan_id: string;
  model: string;
  role: string;
  input_credits_per_mtok: number;
  output_credits_per_mtok: number;
  call_credits: number;
  enabled: boolean;
}

export interface PurchaseRequestRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: 'pending' | 'approved' | 'rejected';
  contact: string;
  note: string;
  created_at: string;
}

export async function adminStats(): Promise<AdminStats> {
  const { data, error } = await client().rpc('admin_stats');
  if (error) throw new Error(error.message);
  return data as AdminStats;
}

export async function adminUsers(search = '', limit = 100): Promise<AdminUser[]> {
  let query = client().from('user_overview').select('*').limit(limit);
  if (search.trim()) {
    const term = `%${search.trim()}%`;
    query = query.or(`email.ilike.${term},full_name.ilike.${term}`);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AdminUser[];
}

export async function adminPlans(): Promise<CloudPlan[]> {
  const { data, error } = await client()
    .from('plans')
    .select('*')
    .order('sort', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CloudPlan[];
}

export async function savePlan(plan: Partial<CloudPlan> & { id?: string }): Promise<void> {
  const { error } = await client().from('plans').upsert(plan);
  if (error) throw new Error(error.message);
}

export async function deletePlan(id: string): Promise<void> {
  const { error } = await client().from('plans').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function planModels(planId: string): Promise<PlanModelRow[]> {
  const { data, error } = await client()
    .from('plan_models')
    .select('*')
    .eq('plan_id', planId)
    .order('role', { ascending: true })
    .order('model', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PlanModelRow[];
}

export async function savePlanModel(row: Partial<PlanModelRow>): Promise<void> {
  const { error } = await client()
    .from('plan_models')
    .upsert(row, { onConflict: 'plan_id,model' });
  if (error) throw new Error(error.message);
}

export async function deletePlanModel(id: string): Promise<void> {
  const { error } = await client().from('plan_models').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function grantPlan(
  userId: string,
  planId: string,
  days: number,
  note = '',
): Promise<void> {
  const { error } = await client().rpc('admin_grant_plan', {
    p_user: userId,
    p_plan: planId,
    p_days: days,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}

export async function addCredits(userId: string, amount: number, note = ''): Promise<void> {
  const { error } = await client().rpc('admin_add_credits', {
    p_user: userId,
    p_amount: amount,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}

/**
 * Hisobga pul tushirish (pay-as-you-go uchun).
 *
 * Kredit obuna bilan beriladi va davr almashganda kuyadi. Pul esa
 * foydalanuvchi toʻlagan mablagʻ — kuymaydi va obuna limiti tugagach
 * shundan yechiladi. Shuning uchun ular alohida turadi.
 */
export async function addWallet(userId: string, amount: number, reason = ''): Promise<number> {
  const { data, error } = await client().rpc('admin_add_wallet', {
    p_user: userId,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return Number((data as { wallet?: number } | null)?.wallet ?? 0);
}

export async function setRole(userId: string, role: 'user' | 'admin'): Promise<void> {
  const { error } = await client().rpc('admin_set_role', { p_user: userId, p_role: role });
  if (error) throw new Error(error.message);
}

export async function setBlocked(userId: string, blocked: boolean): Promise<void> {
  const { error } = await client().rpc('admin_set_blocked', {
    p_user: userId,
    p_blocked: blocked,
  });
  if (error) throw new Error(error.message);
}

export async function pendingRequests(): Promise<PurchaseRequestRow[]> {
  const { data, error } = await client()
    .from('purchase_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as PurchaseRequestRow[];
}

export async function decideRequest(
  id: string,
  approve: boolean,
  days = 30,
): Promise<void> {
  const { error } = await client().rpc('admin_decide_request', {
    p_request: id,
    p_approve: approve,
    p_days: days,
  });
  if (error) throw new Error(error.message);
}

export async function recentUsage(userId?: string, limit = 60): Promise<UsageRow[]> {
  let query = client()
    .from('usage_events')
    .select('id,model,kind,source,input_tokens,output_tokens,total_tokens,credits,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as UsageRow[];
}

export async function getAppSetting<T>(key: string, fallback: T): Promise<T> {
  const { data, error } = await client()
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return ((data?.value ?? fallback) as T) ?? fallback;
}

export async function setAppSetting(key: string, value: unknown): Promise<void> {
  const { error } = await client().from('app_settings').upsert({ key, value });
  if (error) throw new Error(error.message);
}
