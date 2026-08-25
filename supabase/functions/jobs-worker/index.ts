// Daho fon ishchisi — obunachining navbatdagi vazifalarini bajaradi.
//
// Ilova yopiq bo'lsa ham ish davom etadi: foydalanuvchi vazifani navbatga
// qo'yadi (enqueue_job), bu funksiya esa pg_cron yoki tashqi chaqiruv bilan
// ishga tushib, natijani jobs.result ga yozadi. Ilova ochilganda natija
// realtime orqali darhol ko'rinadi.
//
// Chaqirish:
//   POST /functions/v1/jobs-worker   header: x-worker-secret: <WORKER_SECRET>
//   ixtiyoriy body: { "limit": 5 }

import {
  CORS,
  GOOGLE_BASE,
  adminClient,
  apiError,
  json,
  readUsage,
} from '../_shared/common.ts';

const PLATFORM_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const WORKER_SECRET = Deno.env.get('WORKER_SECRET') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const DEFAULT_MODEL: Record<string, string> = {
  chat: 'gemini-flash-latest',
  search: 'gemini-flash-latest',
  json: 'gemini-flash-latest',
  plan: 'gemini-flash-latest',
  image: 'gemini-2.5-flash-image',
};

interface Job {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  model: string | null;
  payload: Record<string, unknown>;
}

interface Outcome {
  result: Record<string, unknown>;
  input: number;
  output: number;
  model: string;
}

async function callGemini(
  model: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${GOOGLE_BASE}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': PLATFORM_KEY },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Google xatosi (${res.status})`);
  }
  return data;
}

function textOf(data: Record<string, unknown>): string {
  const parts =
    ((data as any)?.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string; thought?: boolean }>;
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

async function runJob(job: Job): Promise<Outcome> {
  const model = job.model || DEFAULT_MODEL[job.kind] || DEFAULT_MODEL.chat;
  const payload = job.payload ?? {};
  const prompt = String(payload.prompt ?? payload.question ?? payload.goal ?? job.title ?? '');
  if (!prompt) throw new Error('Vazifa matni bo‘sh.');

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: Number(payload.temperature ?? 0.7) },
  };
  if (payload.system) {
    body.systemInstruction = { parts: [{ text: String(payload.system) }] };
  }

  if (job.kind === 'search') {
    body.tools = [{ google_search: {} }];
    delete body.generationConfig;
  }
  if (job.kind === 'json' || job.kind === 'plan') {
    body.generationConfig = {
      temperature: 0.6,
      responseMimeType: 'application/json',
      ...(payload.schema ? { responseSchema: payload.schema } : {}),
    };
  }
  if (job.kind === 'image') {
    body.generationConfig = { responseModalities: ['IMAGE', 'TEXT'] };
  }

  const data = await callGemini(model, body);
  const usage = readUsage(data) ?? { input: 0, output: 0 };

  let result: Record<string, unknown>;
  if (job.kind === 'image') {
    const parts =
      ((data as any)?.candidates?.[0]?.content?.parts ?? []) as Array<{
        inlineData?: { mimeType: string; data: string };
        text?: string;
      }>;
    const image = parts.find((p) => p.inlineData?.data)?.inlineData;
    if (!image) throw new Error('Model rasm qaytarmadi.');
    result = { kind: 'image', mimeType: image.mimeType, data: image.data };
  } else if (job.kind === 'json' || job.kind === 'plan') {
    const text = textOf(data);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      parsed = fenced ? JSON.parse(fenced[1]) : { text };
    }
    result = { kind: job.kind, data: parsed };
  } else {
    const sources =
      (((data as any)?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) as Array<{
        web?: { uri?: string; title?: string };
      }>)
        .map((c) => ({ title: c.web?.title ?? '', url: c.web?.uri ?? '' }))
        .filter((s) => s.url)
        .slice(0, 6);
    result = { kind: 'text', text: textOf(data), sources };
  }

  return { result, input: usage.input, output: usage.output, model };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const secret = req.headers.get('x-worker-secret') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const authorized =
    (WORKER_SECRET && secret === WORKER_SECRET) || (SERVICE_KEY && bearer === SERVICE_KEY);
  if (!authorized) return apiError('Ruxsat yo‘q.', 401);
  if (!PLATFORM_KEY) return apiError('GEMINI_API_KEY sozlanmagan.', 500);

  let limit = 3;
  try {
    const body = await req.json();
    limit = Math.max(1, Math.min(10, Number(body?.limit ?? 3)));
  } catch {
    /* bo'sh body — standart limit */
  }

  const admin = adminClient();
  const { data: jobs, error } = await admin.rpc('claim_jobs', { p_limit: limit });
  if (error) return apiError(error.message, 500);

  const picked = (jobs ?? []) as Job[];
  const report: Array<Record<string, unknown>> = [];

  for (const job of picked) {
    try {
      const { data: check } = await admin.rpc('can_use_model', {
        p_user: job.user_id,
        p_model: job.model || DEFAULT_MODEL[job.kind] || DEFAULT_MODEL.chat,
      });
      const verdict = (check ?? {}) as { allowed?: boolean; reason?: string };
      if (!verdict.allowed) throw new Error(verdict.reason ?? 'ruxsat yo‘q');

      const outcome = await runJob(job);

      const { data: charged } = await admin.rpc('charge_usage', {
        p_user: job.user_id,
        p_model: outcome.model,
        p_kind: 'job',
        p_input: outcome.input,
        p_output: outcome.output,
        p_source: 'job',
        p_job: job.id,
        p_meta: { kind: job.kind },
      });

      await admin
        .from('jobs')
        .update({
          status: 'done',
          result: outcome.result,
          error: null,
          credits: Number((charged as { credits?: number })?.credits ?? 0),
          finished_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      report.push({ id: job.id, status: 'done' });
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      await admin
        .from('jobs')
        .update({ status: 'error', error: message, finished_at: new Date().toISOString() })
        .eq('id', job.id);
      report.push({ id: job.id, status: 'error', error: message });
    }
  }

  return json({ picked: picked.length, jobs: report });
});
