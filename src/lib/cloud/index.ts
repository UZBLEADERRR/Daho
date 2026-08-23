/** Bulut qatlamining yagona kirish nuqtasi. */
import { getState } from '../store';
import { refreshAccount, watchAuth, accountSnapshot } from './account';
import { supa } from './client';
import { cloudEnabled } from './config';
import { clearSyncShadow, startSync, stopSync } from './sync';
import type { CloudPlan } from './types';

export * from './config';
export * from './account';
export * from './types';
export { syncNow, getSyncState, subscribeSync, type SyncState } from './sync';

/** Sotuvdagi rejalar (kirmagan foydalanuvchi ham ko'radi). */
export async function publicPlans(): Promise<CloudPlan[]> {
  const sb = supa();
  if (!sb) return [];
  const { data, error } = await sb
    .from('plans')
    .select('*')
    .eq('is_active', true)
    .order('sort', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CloudPlan[];
}

/** Obuna so'rovi — admin tasdiqlagach reja ochiladi. */
export async function requestPlan(planId: string, contact: string, note = ''): Promise<void> {
  const sb = supa();
  const account = accountSnapshot();
  if (!sb || !account?.signed_in) throw new Error('Avval tizimga kiring');
  const { error } = await sb.from('purchase_requests').insert({
    user_id: account.user_id,
    plan_id: planId,
    contact,
    note,
  });
  if (error) throw new Error(error.message);
}

export async function myRequests(): Promise<Array<{ id: string; plan_id: string; status: string; created_at: string }>> {
  const sb = supa();
  if (!sb) return [];
  const { data, error } = await sb
    .from('purchase_requests')
    .select('id,plan_id,status,created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Kirish holati tashxisi.
 *
 * «Admin panel koʻrinmayapti» degan savolga aniq javob beradi: rolingiz
 * nima, admin roʻyxatida bormisiz va umuman admin bormi.
 */
export async function whoami(): Promise<Record<string, unknown> | null> {
  const sb = supa();
  if (!sb) return null;
  const { data, error } = await sb.rpc('whoami');
  if (error) throw new Error(error.message);
  return (data ?? null) as Record<string, unknown> | null;
}

/** Bitta oynaning holati: cheksizmi va necha foiz qolgani. */
export interface WindowState {
  unlimited: boolean;
  left_percent: number;
  /** Shu oynada sarflangan kredit va chegara — aniq raqam. */
  used?: number;
  cap?: number | null;
}

/**
 * Limitlar holati.
 *
 * Foydalanuvchiga token soni koʻrsatilmaydi — u «haftalik limitning 64% i
 * qoldi» degan tushunarli raqamni koʻradi.
 */
export interface UsageWindows {
  plan: string;
  hour: WindowState;
  day: WindowState;
  week: WindowState;
  period: WindowState;
  wallet: number;
  allow_payg: boolean;
  daily_model: {
    access: 'none' | 'limited' | 'unlimited';
    used: number;
    quota: number;
    tokens?: number;
    credits?: number;
  };
  /** Bugungi haqiqiy xarajat (bepul yoʻl ham kiradi) va token soni. */
  spend_today?: number;
  tokens_today?: number;
  period_end: string | null;
}

export async function usageWindows(): Promise<UsageWindows | null> {
  const sb = supa();
  if (!sb) return null;
  const { data, error } = await sb.rpc('usage_windows');
  if (error) throw new Error(error.message);
  return (data ?? null) as UsageWindows | null;
}

/** Ilova ishga tushganda bir marta chaqiriladi. */
export function initCloud(): () => void {
  if (!cloudEnabled) return () => undefined;

  void refreshAccount().then((account) => {
    if (account && getState().settings.cloudBackup) startSync();
  });

  const stopWatch = watchAuth((signedIn) => {
    if (signedIn && getState().settings.cloudBackup) startSync();
    if (!signedIn) {
      stopSync();
      clearSyncShadow();
    }
  });

  return () => {
    stopWatch();
    stopSync();
  };
}

/** Sozlamada sinxronizatsiya yoqilsa/o'chirilsa. */
export function applyBackupSetting(enabled: boolean): void {
  if (!cloudEnabled) return;
  if (enabled) startSync();
  else stopSync();
}
