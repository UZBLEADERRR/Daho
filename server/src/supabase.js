import { createClient } from '@supabase/supabase-js';
import WsTransport from 'ws';
import { env } from './env.js';
import { cachedUser } from './limits.js';

/*
 * Node 22+ da global `WebSocket` bor — oʻshani ishlatamiz, chunki u
 * platformaning oʻzi. Boʻlmasa `ws` paketiga tushamiz.
 */
const WebSocketImpl = globalThis.WebSocket ?? WsTransport;

let admin = null;

/** Service-role mijoz — RLS ni chetlab oʻtadi, faqat serverda ishlatiladi. */
export function adminClient() {
  if (!admin) {
    admin = createClient(env.supabaseUrl, env.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      /*
       * Realtime bu yerda umuman ishlatilmaydi, lekin kutubxona
       * mijozni yaratishdayoq WebSocket qidiradi. Node 22 da u
       * NATIV bor; Node 20 da esa yoʻq va mijoz «Node.js 20 detected
       * without native WebSocket support» deb yiqilardi — natijada
       * serverning HAMMA chaqiruvi «Supabaseʼga ulanib boʻlmadi»
       * boʻlib qaytardi. `ws` ni ochiq berib qoʻyamiz: ikkala
       * versiyada ham ishlaydi.
       */
      realtime: { transport: WebSocketImpl },
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
export async function verifyToken(token) {
  if (!token) return { user: null, sabab: 'token yoʻq' };
  return cachedUser(token, async (t) => {
    try {
      const { data, error } = await adminClient().auth.getUser(t);
      if (error) return { user: null, sabab: error.message || 'Supabase rad etdi' };
      if (!data?.user) return { user: null, sabab: 'foydalanuvchi topilmadi' };
      return { user: data.user };
    } catch (err) {
      // Tarmoq yoki manzil xatosi — buni «sessiya tugadi» deb koʻrsatmaymiz.
      return { user: null, sabab: `Supabase’ga ulanib boʻlmadi: ${String(err?.message ?? err)}` };
    }
  });
}

/** Eski chaqiruvchilar uchun: faqat foydalanuvchi yoki `null`. */
export async function userFromToken(token) {
  return (await verifyToken(token)).user;
}
