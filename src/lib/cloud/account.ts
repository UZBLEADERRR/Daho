import { useSyncExternalStore } from 'react';
import { supa } from './client';
import { cloudEnabled } from './config';
import type { Account } from './types';

export type CloudStatus = 'off' | 'yuklanmoqda' | 'kirilmagan' | 'kirgan';

interface CloudState {
  status: CloudStatus;
  account: Account | null;
  error: string;
}

let state: CloudState = {
  status: cloudEnabled ? 'yuklanmoqda' : 'off',
  account: null,
  error: '',
};

const listeners = new Set<() => void>();

function emit(patch: Partial<CloudState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function cloudState(): CloudState {
  return state;
}

/** Joriy hisob ma'lumoti (so'rovsiz, keshdan). */
export function accountSnapshot(): Account | null {
  return state.account;
}

export function useCloud(): CloudState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

let refreshing: Promise<Account | null> | null = null;

/** Reja, kredit va limitlarni serverdan yangilaydi. */
export async function refreshAccount(): Promise<Account | null> {
  const sb = supa();
  if (!sb) return null;
  if (refreshing) return refreshing;

  refreshing = (async () => {
    try {
      const { data: sessionData } = await sb.auth.getSession();
      if (!sessionData.session) {
        emit({ status: 'kirilmagan', account: null });
        return null;
      }
      const { data, error } = await sb.rpc('my_account');
      if (error) throw error;
      const account = data as Account;
      if (!account?.signed_in) {
        emit({ status: 'kirilmagan', account: null });
        return null;
      }
      emit({ status: 'kirgan', account, error: '' });
      return account;
    } catch (err) {
      emit({ error: String((err as Error)?.message ?? err) });
      return state.account;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

/** Sarf bo'lgandan keyin balansni jimgina yangilab qo'yish. */
let softTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleAccountRefresh(delay = 4000): void {
  if (!cloudEnabled || state.status !== 'kirgan') return;
  if (softTimer) clearTimeout(softTimer);
  softTimer = setTimeout(() => void refreshAccount(), delay);
}

/* ---------------------------------------------------------------- kirish */

export async function signUp(
  email: string,
  password: string,
  fullName: string,
): Promise<{ ok: boolean; message: string }> {
  const sb = supa();
  if (!sb) return { ok: false, message: 'Bulut sozlanmagan' };
  const { data, error } = await sb.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: fullName.trim() } },
  });
  if (error) return { ok: false, message: error.message };
  if (!data.session) {
    return { ok: true, message: 'Pochtangizga tasdiqlash xati yuborildi.' };
  }
  await refreshAccount();
  return { ok: true, message: 'Hisob yaratildi.' };
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ ok: boolean; message: string }> {
  const sb = supa();
  if (!sb) return { ok: false, message: 'Bulut sozlanmagan' };
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { ok: false, message: error.message };
  await refreshAccount();
  return { ok: true, message: 'Xush kelibsiz!' };
}

/** Parolsiz kirish — pochtaga havola yuboriladi. */
export async function signInWithLink(email: string): Promise<{ ok: boolean; message: string }> {
  const sb = supa();
  if (!sb) return { ok: false, message: 'Bulut sozlanmagan' };
  const { error } = await sb.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: 'Pochtangizga kirish havolasi yuborildi.' };
}

export async function resetPassword(email: string): Promise<{ ok: boolean; message: string }> {
  const sb = supa();
  if (!sb) return { ok: false, message: 'Bulut sozlanmagan' };
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: window.location.origin,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: 'Parolni tiklash havolasi yuborildi.' };
}

export async function signOut(): Promise<void> {
  const sb = supa();
  if (!sb) return;
  await sb.auth.signOut();
  emit({ status: 'kirilmagan', account: null });
}

/** Auth o'zgarishlarini kuzatish — App ishga tushganda bir marta. */
export function watchAuth(onChange: (signedIn: boolean) => void): () => void {
  const sb = supa();
  if (!sb) return () => undefined;
  const { data } = sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      emit({ status: 'kirilmagan', account: null });
      onChange(false);
      return;
    }
    void refreshAccount().then((account) => onChange(Boolean(account)));
  });
  return () => data.subscription.unsubscribe();
}
