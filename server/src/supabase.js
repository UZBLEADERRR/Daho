import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

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
export async function userFromToken(token) {
  if (!token) return null;
  try {
    const { data, error } = await adminClient().auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}
