/**
 * Server manzili.
 *
 * Yigʻish paytida `DAHO_SUPABASE_URL` / `DAHO_SUPABASE_ANON_KEY` berilsa
 * shular ishlatiladi. Berilmasa foydalanuvchi sozlamalar sahifasidan
 * kiritadi — shunda kengaytmani oʻzingiz yigʻmasdan ham sinash mumkin.
 */

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

export interface Server {
  url: string;
  anonKey: string;
}

let cached: Server | null = null;

export async function server(): Promise<Server | null> {
  if (cached) return cached;

  const built = {
    url: (__SUPABASE_URL__ || '').replace(/\/+$/, ''),
    anonKey: __SUPABASE_ANON_KEY__ || '',
  };
  if (built.url && built.anonKey) {
    cached = built;
    return cached;
  }

  const saved = await chrome.storage.local.get(['serverUrl', 'anonKey']);
  if (saved.serverUrl && saved.anonKey) {
    cached = { url: String(saved.serverUrl).replace(/\/+$/, ''), anonKey: String(saved.anonKey) };
    return cached;
  }
  return null;
}

export async function setServer(url: string, anonKey: string): Promise<void> {
  cached = null;
  await chrome.storage.local.set({ serverUrl: url.trim(), anonKey: anonKey.trim() });
}

export async function need(): Promise<Server> {
  const s = await server();
  if (!s) throw new Error('Daho serveri sozlanmagan.');
  return s;
}
