/**
 * Daho AI proxy.
 *
 * Foydalanuvchi endi oʻz API kalitini kiritmaydi — ilova shu funksiyaga
 * murojaat qiladi, funksiya esa serverdagi bitta OpenRouter kaliti bilan
 * ishlaydi. Bu yerda tarif, kvota va token hisobi nazorat qilinadi.
 *
 * Yoʻllar (OpenAI bilan mos, shuning uchun klientdagi mavjud kod oʻzgarmaydi):
 *   GET  /ai/models             — foydalanuvchiga ochiq Daho modellari
 *   POST /ai/chat/completions   — suhbat (stream ham, streamsiz ham)
 *
 * Kerakli sirlar (Supabase → Edge Functions → Secrets):
 *   OPENROUTER_API_KEY   — asosiy kalit
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY — avtomatik
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { CORS, fail, json } from '../_shared/cors.ts';

const UPSTREAM: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const OPENROUTER_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface Caller {
  id: string;
  rank: number;
  planCode: string;
  monthlyTokens: number;
  tokensUsed: number;
  periodStart: string;
  blocked: boolean;
}

/** Bearer tokendan foydalanuvchini aniqlaydi va tarif holatini oʻqiydi. */
async function whoIs(req: Request): Promise<Caller | null> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const guest = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await guest.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: row } = await admin
    .from('profiles')
    .select('plan_code, plan_expires_at, tokens_used, period_start, blocked, plans(rank, monthly_tokens)')
    .eq('id', data.user.id)
    .single();

  const plan = (row?.plans ?? null) as { rank: number; monthly_tokens: number } | null;
  const expired = row?.plan_expires_at ? new Date(row.plan_expires_at as string) < new Date() : false;

  return {
    id: data.user.id,
    planCode: expired ? 'free' : ((row?.plan_code as string) ?? 'free'),
    rank: expired ? 0 : (plan?.rank ?? 0),
    monthlyTokens: expired ? 0 : (plan?.monthly_tokens ?? 0),
    tokensUsed: Number(row?.tokens_used ?? 0),
    periodStart: (row?.period_start as string) ?? new Date().toISOString(),
    blocked: Boolean(row?.blocked),
  };
}

/** Oy almashgan boʻlsa sarf nolga tushadi. */
function usedThisMonth(caller: Caller): number {
  const start = new Date(caller.periodStart);
  const now = new Date();
  const sameMonth =
    start.getUTCFullYear() === now.getUTCFullYear() && start.getUTCMonth() === now.getUTCMonth();
  return sameMonth ? caller.tokensUsed : 0;
}

/** Bepul tarifda ham ishlashi uchun eng kam chegara. */
function quotaLeft(caller: Caller): number {
  return Math.max(caller.monthlyTokens - usedThisMonth(caller), 0);
}

/** Sarfni yozadi va profildagi hisobni yangilaydi. */
async function recordUsage(
  caller: Caller,
  slug: string,
  promptTokens: number,
  completionTokens: number,
  multiplier: number,
  kind: string,
) {
  const billed = Math.round((promptTokens + completionTokens) * (multiplier || 1));
  if (!billed) return;

  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const fresh = usedThisMonth(caller);

  await admin.from('usage_events').insert({
    user_id: caller.id,
    model_slug: slug,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    billed_tokens: billed,
    kind,
  });

  await admin
    .from('profiles')
    .update({ tokens_used: fresh + billed, period_start: monthStart.toISOString() })
    .eq('id', caller.id);
}

/** Usage kelmasa — belgilar soniga qarab taxminiy hisob. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 3.6));
}

async function listModels(caller: Caller): Promise<Response> {
  const { data, error } = await admin
    .from('daho_models')
    .select('slug, name, tagline, min_rank, context_tokens, vision, tools, images, sort')
    .eq('active', true)
    .order('sort', { ascending: true });

  if (error) return fail(error.message, 500);

  // OpenAI /models shakli — klientdagi mavjud roʻyxat oʻqigichi shuni kutadi.
  return json({
    object: 'list',
    data: (data ?? [])
      .filter((m) => (m.min_rank as number) <= caller.rank)
      .map((m) => ({
        id: m.slug,
        object: 'model',
        name: m.name,
        description: m.tagline,
        context_length: m.context_tokens,
        architecture: {
          input_modalities: m.vision ? ['text', 'image'] : ['text'],
          output_modalities: m.images ? ['text', 'image'] : ['text'],
        },
        supported_parameters: m.tools ? ['tools', 'tool_choice', 'temperature'] : ['temperature'],
        // Narx foydalanuvchiga koʻrsatilmaydi — u tarif bilan ishlaydi.
        pricing: { prompt: '0', completion: '0' },
        // Klient Auto tanlovi uchun: daraja va imkoniyatlar.
        daho: { slug: m.slug, tier: m.min_rank, images: m.images, vision: m.vision },
      })),
  });
}

async function chat(req: Request, caller: Caller): Promise<Response> {
  if (!OPENROUTER_KEY) return fail('Server kaliti sozlanmagan. Admin bilan bogʻlaning.', 503);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail('Notoʻgʻri soʻrov.', 400);
  }

  const slug = String(body.model ?? '').trim();
  if (!slug) return fail('Model tanlanmagan.', 400);

  const { data: model } = await admin
    .from('daho_models')
    .select('slug, name, upstream, upstream_ref, min_rank, token_multiplier, active')
    .eq('slug', slug)
    .single();

  if (!model || !model.active) return fail('Bunday model yoʻq.', 404, 'model_not_found');

  if ((model.min_rank as number) > caller.rank) {
    return fail(
      `«${model.name}» modeli sizning tarifingizda ochiq emas. Tariflar boʻlimiga oʻting.`,
      402,
      'plan_required',
    );
  }

  const left = quotaLeft(caller);
  if (left <= 0) {
    return fail(
      'Oylik token chegarangiz tugadi. Tarifni koʻtarish uchun admin bilan bogʻlaning.',
      402,
      'quota_exceeded',
    );
  }

  const stream = body.stream !== false;
  const base = UPSTREAM[(model.upstream as string) ?? 'openrouter'] ?? UPSTREAM.openrouter;

  const upstreamBody = {
    ...body,
    model: model.upstream_ref,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  };

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://daho.app',
      'X-Title': 'Daho',
    },
    body: JSON.stringify(upstreamBody),
  });

  const multiplier = Number(model.token_multiplier ?? 1);
  const kind = String(body.daho_kind ?? 'chat');

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    return fail(
      text.slice(0, 400) || `Model javob bermadi (HTTP ${res.status}).`,
      res.status === 429 ? 429 : 502,
    );
  }

  if (!stream) {
    const data = await res.json();
    const usage = data?.usage ?? {};
    await recordUsage(
      caller,
      slug,
      Number(usage.prompt_tokens ?? 0),
      Number(usage.completion_tokens ?? 0),
      multiplier,
      kind,
    );
    return json({ ...data, model: slug });
  }

  // Oqimni foydalanuvchiga uzatamiz, yoʻl-yoʻlakay sarfni oʻqib qolamiz.
  let promptTokens = 0;
  let completionTokens = 0;
  let seenUsage = false;
  let textLen = 0;
  let tail = '';

  const meter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      tail += new TextDecoder().decode(chunk, { stream: true });
      const lines = tail.split('\n');
      tail = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          if (parsed?.usage) {
            promptTokens = Number(parsed.usage.prompt_tokens ?? promptTokens);
            completionTokens = Number(parsed.usage.completion_tokens ?? completionTokens);
            seenUsage = true;
          }
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string') textLen += delta.length;
        } catch {
          /* boʻlak yarim kelgan — keyingi oʻqishda toʻliq boʻladi */
        }
      }
    },
    flush() {
      if (!seenUsage) {
        // Provayder sarfni aytmadi — taxminiy hisoblaymiz, aks holda
        // chegara umuman ishlamay qoladi.
        completionTokens = estimateTokens('x'.repeat(textLen));
        promptTokens = Math.round(JSON.stringify(body.messages ?? []).length / 3.6);
      }
      // Javob tugagach yozamiz; foydalanuvchini kutdirmaymiz.
      void recordUsage(caller, slug, promptTokens, completionTokens, multiplier, kind);
    },
  });

  return new Response(res.body.pipeThrough(meter), {
    headers: {
      ...CORS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const path = new URL(req.url).pathname.replace(/^\/ai/, '').replace(/\/+$/, '') || '/';

  const caller = await whoIs(req);
  if (!caller) return fail('Kirish talab qilinadi.', 401, 'unauthorized');
  if (caller.blocked) return fail('Hisobingiz vaqtincha toʻxtatilgan.', 403, 'blocked');

  if (req.method === 'GET' && path === '/models') return listModels(caller);
  if (req.method === 'POST' && (path === '/chat/completions' || path === '/completions')) {
    return chat(req, caller);
  }
  if (req.method === 'GET' && path === '/quota') {
    return json({
      plan: caller.planCode,
      rank: caller.rank,
      monthly_tokens: caller.monthlyTokens,
      tokens_used: usedThisMonth(caller),
      tokens_left: quotaLeft(caller),
    });
  }

  return fail('Bunday yoʻl yoʻq.', 404);
});
