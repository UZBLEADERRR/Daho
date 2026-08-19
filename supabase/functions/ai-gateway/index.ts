// Daho AI Gateway — obunachilar uchun Gemini proksisi.
//
// Vazifasi:
//   1. Foydalanuvchini JWT bo'yicha tanish;
//   2. Reja shu modelga ruxsat beradimi va kredit yetadimi — tekshirish;
//   3. So'rovni platforma kaliti bilan Google'ga uzatish (oqim ham);
//   4. Sarflangan tokenni yozib, kreditdan yechish.
//
// Mijoz uchun URL Google'nikiga o'xshaydi, shuning uchun ilova kodi
// deyarli o'zgarmaydi:
//   POST /functions/v1/ai-gateway/v1beta/models/<model>:streamGenerateContent?alt=sse
//   GET  /functions/v1/ai-gateway/v1beta/models

import {
  CORS,
  GOOGLE_BASE,
  adminClient,
  apiError,
  json,
  kindOf,
  readUsage,
  whoIs,
  type Usage,
} from '../_shared/common.ts';

const PLATFORM_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

interface Allowed {
  allowed: boolean;
  reason?: string;
  balance?: number;
  plan?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!PLATFORM_KEY) {
    return apiError('Server kaliti sozlanmagan (GEMINI_API_KEY).', 500);
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/(functions\/v1\/)?ai-gateway/, '') || '/';
  const admin = adminClient();

  const caller = await whoIs(req, admin);
  if (!caller) return apiError('Avval tizimga kiring.', 401);

  // ---- modellar ro'yxati: rejaga kiradiganlarini qaytaramiz
  if (req.method === 'GET' && /^\/v1beta\/models\/?$/.test(path)) {
    const { data, error } = await admin.rpc('allowed_models', { p_user: caller.id });
    if (error) return apiError(error.message, 500);
    const allowed = new Set(
      ((data ?? []) as Array<{ model: string }>).map((m) => m.model),
    );

    const upstream = await fetch(`${GOOGLE_BASE}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': PLATFORM_KEY },
    });
    if (!upstream.ok) {
      return apiError('Model ro‘yxatini olib bo‘lmadi.', upstream.status);
    }
    const list = await upstream.json();
    const models = ((list?.models ?? []) as Array<{ name: string }>).filter((m) =>
      allowed.has(String(m.name).replace(/^models\//, '')),
    );
    return json({ models });
  }

  const match = path.match(/^\/v1beta\/models\/(.+):([A-Za-z]+)$/);
  if (!match || req.method !== 'POST') return apiError('Bunday manzil yo‘q.', 404);

  const model = decodeURIComponent(match[1]);
  const method = match[2];

  // ---- ruxsat va kredit
  const { data: check, error: checkError } = await admin.rpc('can_use_model', {
    p_user: caller.id,
    p_model: model,
  });
  if (checkError) return apiError(checkError.message, 500);
  const verdict = (check ?? {}) as Allowed;
  if (!verdict.allowed) {
    return apiError(
      `${verdict.reason ?? 'ruxsat yo‘q'}. Obunani yangilang yoki Sozlamalarda o‘z API kalitingizni kiriting.`,
      402,
    );
  }

  let body: Record<string, unknown> = {};
  const raw = await req.text();
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return apiError('So‘rov JSON emas.', 400);
  }
  const kind = kindOf(method, body);

  const target = new URL(`${GOOGLE_BASE}/models/${encodeURIComponent(model)}:${method}`);
  url.searchParams.forEach((value, key) => target.searchParams.set(key, value));

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': PLATFORM_KEY },
      body: raw,
    });
  } catch {
    return apiError('Google serveriga ulanib bo‘lmadi.', 502);
  }

  const charge = async (usage: Usage | null) => {
    if (!usage) return;
    const { error } = await admin.rpc('charge_usage', {
      p_user: caller.id,
      p_model: model,
      p_kind: kind,
      p_input: usage.input,
      p_output: usage.output,
      p_source: 'gateway',
      p_job: null,
      p_meta: { method },
    });
    if (error) console.error('charge_usage:', error.message);
  };

  if (!upstream.ok) {
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const isStream = (upstream.headers.get('content-type') ?? '').includes('text/event-stream');

  // ---- oqimsiz javob
  if (!isStream || !upstream.body) {
    const text = await upstream.text();
    let usage: Usage | null = null;
    try {
      usage = readUsage(JSON.parse(text));
    } catch {
      /* hisobsiz o'tadi */
    }
    await charge(usage);
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  // ---- oqim: mijozga uzatib turib, oxirgi usageMetadata ni ilib olamiz
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: Usage | null = null;

  const meter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.includes('usageMetadata')) continue;
        try {
          const found = readUsage(JSON.parse(line.replace(/^data:\s*/, '')));
          if (found) usage = found;
        } catch {
          /* to'liq bo'lmagan bo'lak — keyingisida keladi */
        }
      }
      // Buferni cheklab turamiz: rasm bo'laklari xotirani to'ldirmasin.
      if (buffer.length > 1_000_000) buffer = buffer.slice(-4096);
    },
    async flush() {
      if (buffer.includes('usageMetadata')) {
        try {
          const found = readUsage(JSON.parse(buffer.replace(/^data:\s*/, '')));
          if (found) usage = found;
        } catch {
          /* e'tiborsiz */
        }
      }
      await charge(usage);
    },
  });

  return new Response(upstream.body.pipeThrough(meter), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...CORS,
    },
  });
});
