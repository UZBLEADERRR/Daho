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
