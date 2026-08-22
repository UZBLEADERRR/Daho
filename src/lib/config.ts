/**
 * Daho serveri manzili.
 *
 * Endi foydalanuvchi hech narsa kiritmaydi — manzil va ochiq kalit ilovaga
 * yigʻilish paytida qoʻshiladi (`.env` fayli yoki CI sirlari orqali).
 * `anon` kalit ochiq boʻlishi uchun moʻljallangan: barcha himoya Supabase
 * tomonidagi RLS siyosatlari bilan qilinadi.
 */

import { getState } from './store';

const BUILT_IN_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const BUILT_IN_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export interface DahoServer {
  url: string;
  anonKey: string;
}

/**
 * Server manzili. Yigʻilishda berilgan qiymat ustun; berilmagan boʻlsa
 * (masalan ishlab chiqish paytida) sozlamalardagi qiymat ishlatiladi.
 */
export function server(): DahoServer | null {
  const s = getState().settings;
  const url = (BUILT_IN_URL || s.supabaseUrl || '').trim().replace(/\/+$/, '');
  const anonKey = (BUILT_IN_KEY || s.supabaseAnonKey || '').trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function hasServer(): boolean {
  return server() !== null;
}

/** Yigʻilishda server berilganmi — sozlamalarda uni koʻrsatish shart emas. */
export const SERVER_BUILT_IN = Boolean(BUILT_IN_URL && BUILT_IN_KEY);

export function functionsUrl(name: string): string {
  const cfg = server();
  if (!cfg) throw new Error('Daho serveri sozlanmagan.');
  return `${cfg.url}/functions/v1/${name}`;
}

export function restUrl(path: string): string {
  const cfg = server();
  if (!cfg) throw new Error('Daho serveri sozlanmagan.');
  return `${cfg.url}/rest/v1/${path}`;
}

export function authUrl(path: string): string {
  const cfg = server();
  if (!cfg) throw new Error('Daho serveri sozlanmagan.');
  return `${cfg.url}/auth/v1/${path}`;
}
