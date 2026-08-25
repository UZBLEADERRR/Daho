import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, cloudEnabled } from './config';

let client: SupabaseClient | null = null;

/** Bulut o'chirilgan bo'lsa `null` qaytaradi — chaqiruvchi shuni tekshiradi. */
export function supa(): SupabaseClient | null {
  if (!cloudEnabled) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'daho.auth.v1',
      },
      global: { headers: { 'x-daho-client': 'web' } },
    });
  }
  return client;
}

/** Joriy sessiya tokeni (gateway so'rovlari uchun). */
export async function accessToken(): Promise<string> {
  const sb = supa();
  if (!sb) return '';
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? '';
}
