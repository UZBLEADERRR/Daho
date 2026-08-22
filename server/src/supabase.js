import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';
import { cachedUser } from './limits.js';

let admin = null;

/** Service-role mijoz — RLS ni chetlab oʻtadi, faqat serverda ishlatiladi. */
export function adminClient() {
  if (!admin) {
    admin = createClient(env.supabaseUrl, env.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

/**
 * Foydalanuvchi tokenini tekshiradi va uning id sini qaytaradi.
 * Token yaroqsiz boʻlsa null.
 */
/*
 * Tokenni tekshiradi.
 *
 * Natija keshlanadi: aks holda har bir soʻrov Supabase Auth’ga borardi
 * va 1000 foydalanuvchida birinchi boʻlib oʻsha tiqilardi. Kesh
 * tokenning oʻz muddatidan oshmaydi.
 */
export async function userFromToken(token) {
  if (!token) return null;
  return cachedUser(token, async (t) => {
    try {
      const { data, error } = await adminClient().auth.getUser(t);
      if (error || !data?.user) return null;
      return data.user;
    } catch {
      return null;
    }
  });
}
