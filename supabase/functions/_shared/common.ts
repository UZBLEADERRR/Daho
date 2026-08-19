// Edge funksiyalar uchun umumiy yordamchilar.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-goog-api-key, x-worker-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });
}

/** Xatoni Gemini formatida qaytaramiz — mijoz kodi o'zgarishsiz tushunadi. */
export function apiError(message: string, status = 400): Response {
  return json({ error: { code: status, message, status: 'DAHO' } }, status);
}

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export interface Caller {
  id: string;
  email: string;
}

/** So'rov egasini JWT bo'yicha aniqlaydi. */
export async function whoIs(req: Request, admin: SupabaseClient): Promise<Caller | null> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? '' };
}

export interface Usage {
  input: number;
  output: number;
}

/** Gemini javobidagi token hisobini o'qiydi (fikrlash tokenlari ham chiqimga qo'shiladi). */
export function readUsage(payload: unknown): Usage | null {
  const meta = (payload as { usageMetadata?: Record<string, number> } | null)?.usageMetadata;
  if (!meta) return null;
  const input = Number(meta.promptTokenCount ?? 0);
  const output =
    Number(meta.candidatesTokenCount ?? 0) + Number(meta.thoughtsTokenCount ?? 0);
  if (!input && !output) return null;
  return { input, output };
}

/** So'rov turini aniqlaydi — narx va statistika uchun. */
export function kindOf(method: string, body: Record<string, unknown>): string {
  const config = (body.generationConfig ?? {}) as { responseModalities?: string[] };
  const modalities = config.responseModalities ?? [];
  if (modalities.includes('AUDIO')) return 'tts';
  if (modalities.includes('IMAGE')) return 'image';
  if (Array.isArray(body.tools) && JSON.stringify(body.tools).includes('google_search')) {
    return 'search';
  }
  if (method.startsWith('stream')) return 'chat';
  return 'chat';
}
