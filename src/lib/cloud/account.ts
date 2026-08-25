import { useSyncExternalStore } from 'react';
import { supa } from './client';
import { clearUserData } from '../store';
import { clearUsage } from '../usage';
import { clearCache } from '../context/cache';
import { cloudEnabled } from './config';
import type { Account } from './types';

/**
 * Qurilmadagi maʼlumot KIMNIKI ekani.
 *
 * Chiqmasdan turib boshqa hisobga kirish mumkin (ilova yopilib qayta
 * ochilgan, sessiya almashgan). Shunda ham eski suhbatlar koʻrinib
 * qolmasligi kerak — shuning uchun har safar hisob oʻqilganda id
 * solishtiriladi.
 */
const OXIRGI = 'daho.owner';

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

/**
 * Soʻrov osilib qolmasin.
 *
 * Tarmoq yoʻq yoki server javob bermasa `fetch` juda uzoq kutadi va
 * ilova «Yuklanmoqda…» holatida qotib qoladi. 15 soniya — yetarli.
 */
async function withTimeout<T>(promise: PromiseLike<T>, nima: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Server javob bermadi (${nima}).`)),
          15_000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Texnik xatoni odam tushunadigan matnga oʻgiradi. */
function humanError(err: unknown): string {
  const raw = String((err as Error)?.message ?? err);

  if (/function .*my_account.* does not exist|PGRST202|schema cache/i.test(raw)) {
    return 'Bazada jadvallar yaratilmagan. Supabase → SQL Editor da migratsiyalarni ishga tushiring.';
  }
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return 'Serverga ulanib boʻlmadi. Internetni yoki server manzilini tekshiring.';
  }
  if (/invalid api key|jwt|apikey/i.test(raw)) {
    return 'Server kaliti notoʻgʻri. VITE_SUPABASE_ANON_KEY ni tekshiring.';
  }
  if (/javob bermadi/i.test(raw)) return raw;
  return raw;
}

let refreshing: Promise<Account | null> | null = null;

/** Reja, kredit va limitlarni serverdan yangilaydi. */
export async function refreshAccount(): Promise<Account | null> {
  const sb = supa();
  if (!sb) return null;
  if (refreshing) return refreshing;

  refreshing = (async () => {
    try {
      const { data: sessionData } = await withTimeout(sb.auth.getSession(), 'sessiya');
      if (!sessionData.session) {
        emit({ status: 'kirilmagan', account: null, error: '' });
        return null;
      }
      const { data, error } = await withTimeout(sb.rpc('my_account'), 'hisob');
      if (error) throw error;
      const account = data as Account;
      if (account?.signed_in) egasiniTekshir(account.user_id);
      if (!account?.signed_in) {
        emit({ status: 'kirilmagan', account: null, error: '' });
        return null;
      }
      /*
       * Bazada profil qatori yoʻq boʻlsa pochta boʻsh kelardi — varaqda
       * «pochtasiz roʻyxatdan oʻtgan» kabi koʻrinardi. Baza tuzatilgunicha
       * sessiyaning oʻzidan olib turamiz.
       */
      const user = sessionData.session.user;
      if (!account.email) account.email = user?.email ?? '';
      if (!account.full_name) {
        const meta = user?.user_metadata as { full_name?: string } | undefined;
        account.full_name = meta?.full_name ?? '';
      }
      emit({ status: 'kirgan', account, error: '' });
      return account;
    } catch (err) {
      /*
       * Xato boʻlganda ham holatni ANIQ qilib qoʻyamiz.
       *
       * Avval bu yerda faqat `error` yozilardi, `status` esa
       * «yuklanmoqda» boʻlib qolaverardi — natijada varaq abadiy
       * «Yuklanmoqda…» deb turardi va foydalanuvchi sababini bilmasdi.
       * Endi kirish oynasi koʻrsatiladi va xato matni ham chiqadi.
       */
      emit({
        status: state.account ? 'kirgan' : 'kirilmagan',
        error: humanError(err),
      });
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

/**
 * Ism-familyani oʻzgartiradi.
 *
 * Ikki joyda saqlanadi: `profiles` jadvalida (admin va qidiruv shu yerdan
 * oʻqiydi) va Auth metadatasida (keyingi kirishda ham qolsin). Rol va
 * blok holatiga tegib boʻlmaydi — buni baza tomonidagi qoʻriqchi
 * (`guard_profile_update`) taʼminlaydi.
 */
export async function saveProfile(fullName: string): Promise<{ ok: boolean; message: string }> {
  const sb = supa();
  if (!sb) return { ok: false, message: 'Bulut sozlanmagan' };

  const name = fullName.trim();
  const { data: sessionData } = await sb.auth.getSession();
  const uid = sessionData.session?.user?.id;
  if (!uid) return { ok: false, message: 'Avval tizimga kiring' };

  const { error } = await sb.from('profiles').update({ full_name: name }).eq('id', uid);
  if (error) return { ok: false, message: error.message };

  await sb.auth.updateUser({ data: { full_name: name } });
  await refreshAccount();
  return { ok: true, message: 'Saqlandi' };
}

/** Parolni almashtiradi. */
export async function changePassword(password: string): Promise<{ ok: boolean; message: string }> {
  const sb = supa();
  if (!sb) return { ok: false, message: 'Bulut sozlanmagan' };
  if (password.length < 6) return { ok: false, message: 'Parol kamida 6 ta belgi boʻlsin' };

  const { error } = await sb.auth.updateUser({ password });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: 'Parol almashtirildi' };
}

export async function signOut(): Promise<void> {
  const sb = supa();
  if (!sb) return;
  await sb.auth.signOut();
  /*
   * Qurilmadagi maʼlumot ham tozalanadi.
   *
   * Suhbatlar, loyihalar va sarf hisoboti IndexedDB da turadi. Ilgari
   * ular chiqishdan keyin ham joyida qolardi va keyingi odam kirganda
   * OʻZGANING suhbatlarini koʻrardi. Bir telefonni ikki kishi
   * ishlatsa — bu maʼlumot sizib chiqishi.
   */
  forgetDevice();
  emit({ status: 'kirilmagan', account: null });
}

/**
 * Qurilmadagi maʼlumot boshqa odamniki boʻlsa — tozalanadi.
 *
 * Birinchi kirishda (belgi yoʻq) hech nima oʻchirilmaydi: bu oddiy
 * holat, oʻz maʼlumotini yoʻqotib qoʻymasin.
 */
function egasiniTekshir(userId: string): void {
  try {
    const oldingi = localStorage.getItem(OXIRGI);
    if (oldingi && oldingi !== userId) tozala();
    localStorage.setItem(OXIRGI, userId);
  } catch {
    /* xotira yopiq — tekshiruvsiz davom etadi */
  }
}

/** Qurilmadagi foydalanuvchi izini oʻchiradi. */
function forgetDevice(): void {
  tozala();
  try {
    localStorage.removeItem(OXIRGI);
  } catch {
    /* xotira yopiq boʻlsa ham davom etadi */
  }
}

/**
 * Odamga tegishli hamma narsani oʻchiradi.
 *
 * Suhbatlar va loyihalar (store), sarf hisoboti (usage), javob keshi
 * (avvalgi savol-javoblar) va sinxronizatsiya soyasi. Sozlamalar
 * qoladi — ular qurilmaniki.
 *
 * `sync.ts` bu yerga import qilinmaydi: u `account.ts` ga tayanadi va
 * halqa hosil boʻlardi. Shuning uchun kalit toʻgʻridan-toʻgʻri
 * oʻchiriladi.
 */
function tozala(): void {
  clearUserData();
  clearUsage();
  clearCache();
  try {
    localStorage.removeItem('daho.sync.v1');
  } catch {
    /* xotira yopiq */
  }
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
