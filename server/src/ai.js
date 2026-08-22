/*
 * Daho AI shlyuzi — bitta manzil, koʻp provayder.
 *
 * Ilova soʻrovni Gemini shaklida yuboradi:
 *   POST /api/ai/v1beta/models/<daho-nomi>:streamGenerateContent?alt=sse
 *
 * Bu yerda:
 *   1. Foydalanuvchi tanib olinadi (Supabase JWT);
 *   2. `can_use_model` — reja ruxsat beradimi, kredit yetadimi;
 *   3. `resolve_model` — «Dahonator» ortida qaysi provayder turgani;
 *   4. Soʻrov OpenRouter yoki Google ga uzatiladi (oqim ham);
 *   5. `charge_usage` — sarflangan token yozib, hisobdan yechiladi.
 *
 * Provayder kalitlari FAQAT shu serverda (Railway muhit oʻzgaruvchilari).
 * Ular hech qachon bazaga yozilmaydi va brauzerga chiqmaydi.
 */

import { env } from './env.js';
import { createCache, createGate, rateLimit } from './limits.js';
import { adminClient, userFromToken } from './supabase.js';
import { fromOpenAi, streamTranslator, toOpenAi, usageFrom } from './translate.js';

const GOOGLE_BASE = process.env.GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const OPENROUTER_BASE = process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1';

/*
 * Yuk boshqaruvi.
 *
 * `max` — provayderga bir vaqtda ochiladigan ulanish soni. Railway’dagi
 * bitta nusxa uchun 24 tinch raqam: AI soʻrovi asosan kutish, protsessor
 * emas. `perUser` — bitta odam navbatni egallab qolmasin.
 *
 * Muhit oʻzgaruvchisi bilan sozlanadi, chunki toʻgʻri raqam rejaga va
 * provayder limitiga bogʻliq.
 */
const gate = createGate({
  max: Number(process.env.AI_CONCURRENCY || 24),
  perUser: Number(process.env.AI_PER_USER || 3),
  maxWaitMs: Number(process.env.AI_QUEUE_WAIT_MS || 30_000),
});

/*
 * Daqiqasiga nechta soʻrov.
 *
 * Agent sikli bir topshiriq uchun oʻnlab chaqiruv qilishi mumkin,
 * shuning uchun chegara baland: maqsad — suiisteʼmolni toʻxtatish,
 * halol ishni boʻlish emas.
 */
const RATE_PER_MIN = Number(process.env.AI_RATE_PER_MIN || 90);
const RATE_BURST = Number(process.env.AI_RATE_BURST || 30);

/*
 * Model tavsifi kamdan-kam oʻzgaradi, lekin har soʻrovda bazadan
 * olinardi. Bir daqiqalik kesh minglab soʻrovni tejaydi.
 */
const modelCache = createCache(60_000, 300);

export function loadStats() {
  return { ...gate.stats(), modelCache: modelCache.size() };
}

/** Provayder kaliti bormi. Panel shu roʻyxatni koʻrsatadi. */
export function providerStatus() {
  return {
    google: { key: Boolean(env.geminiKey), base: GOOGLE_BASE },
    openrouter: { key: Boolean(env.openrouterKey), base: OPENROUTER_BASE },
  };
}

function keyFor(provider) {
  return provider === 'openrouter' ? env.openrouterKey : env.geminiKey;
}

/* ------------------------------------------------------------------ */
/*  OpenRouter katalogi                                                */
/* ------------------------------------------------------------------ */

let catalogCache = { at: 0, list: [] };

/**
 * OpenRouter dagi barcha modellar, haqiqiy narxi bilan.
 *
 * Narx u yerda «1 token uchun USD» satri boʻlib keladi — biz odam
 * oʻqiydigan «1M token uchun USD» ga aylantiramiz. Roʻyxat katta va
 * kamdan-kam oʻzgaradi, shuning uchun 10 daqiqa keshlanadi.
 */
export async function openrouterCatalog(force = false) {
  const fresh = Date.now() - catalogCache.at < 10 * 60_000;
  if (!force && fresh && catalogCache.list.length) return catalogCache.list;
  if (!env.openrouterKey) throw new Error('OPENROUTER_API_KEY sozlanmagan');

  const res = await fetch(`${OPENROUTER_BASE}/models`, {
    headers: { Authorization: `Bearer ${env.openrouterKey}` },
  });
  if (!res.ok) throw new Error(`OpenRouter javob bermadi (${res.status})`);
  const data = await res.json();

  const list = (data?.data ?? []).map((m) => {
    const p = m.pricing ?? {};
    const modality = String(m.architecture?.input_modalities ?? '') || String(m.architecture?.modality ?? '');
    return {
      id: m.id,
      name: m.name || m.id,
      description: String(m.description || '').slice(0, 400),
      context: Number(m.context_length ?? 0),
      // USD / 1M token
      input_usd: Number(p.prompt ?? 0) * 1e6,
      output_usd: Number(p.completion ?? 0) * 1e6,
      image_usd: Number(p.image ?? 0),
      free: Number(p.prompt ?? 0) === 0 && Number(p.completion ?? 0) === 0,
      supports_tools: Array.isArray(m.supported_parameters)
        ? m.supported_parameters.includes('tools')
        : true,
      supports_vision: /image/i.test(modality),
      created: m.created ?? 0,
    };
  });

  list.sort((a, b) => a.name.localeCompare(b.name));
  catalogCache = { at: Date.now(), list };
  return list;
}

/* ------------------------------------------------------------------ */
/*  Soʻrovni uzatish                                                   */
/* ------------------------------------------------------------------ */

function sseLine(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** Google ga oʻzgartirmasdan uzatadi — ilova allaqachon shu shaklda. */
async function callGoogle({ upstream, method, raw, query, signal }) {
  const url = new URL(`${GOOGLE_BASE}/models/${encodeURIComponent(upstream)}:${method}`);
  for (const [k, v] of query) url.searchParams.set(k, v);
  return fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.geminiKey },
    body: raw,
    signal,
  });
}

async function callOpenRouter({ upstream, body, stream, signal, referer }) {
  const payload = toOpenAi(body, upstream, stream);
  return fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.openrouterKey}`,
      // OpenRouter shu ikkisini reyting uchun soʻraydi; majburiy emas.
      'HTTP-Referer': referer || 'https://daho.uz',
      'X-Title': 'Daho',
    },
    body: JSON.stringify(payload),
    signal,
  });
}

/** Google javobidan token hisobini oladi. */
function googleUsage(data) {
  const u = data?.usageMetadata;
  if (!u) return null;
  return {
    input: Number(u.promptTokenCount ?? 0),
    output: Number(u.candidatesTokenCount ?? 0) + Number(u.thoughtsTokenCount ?? 0),
  };
}

function kindOf(method, body) {
  if (/embed/i.test(method)) return 'embed';
  const parts = JSON.stringify(body?.contents ?? []).slice(0, 4000);
  if (/inlineData/.test(parts)) return 'vision';
  return 'chat';
}

/* ------------------------------------------------------------------ */
/*  Express ulagichi                                                   */
/* ------------------------------------------------------------------ */

export function mountAi(app) {
  /** Qaysi provayder kaliti bor — panelda koʻrsatiladi. */
  app.get('/api/providers', async (req, res) => {
    const user = await userFromToken((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
    if (!user) return res.status(401).json({ error: 'Avval tizimga kiring' });
    res.json({ providers: providerStatus() });
  });

  /** OpenRouter katalogi — faqat admin uchun (tannarx koʻrinadi). */
  app.get('/api/catalog/openrouter', async (req, res) => {
    const user = await userFromToken((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
    if (!user) return res.status(401).json({ error: 'Avval tizimga kiring' });

    const { data: isAdmin } = await adminClient().rpc('is_admin', { p_user: user.id });
    if (!isAdmin) return res.status(403).json({ error: 'Faqat admin' });

    try {
      const list = await openrouterCatalog(req.query.force === '1');
      res.json({ models: list, count: list.length });
    } catch (err) {
      res.status(502).json({ error: String(err?.message ?? err) });
    }
  });

  /** Foydalanuvchiga ochiq modellar — ilovadagi tanlov roʻyxati. */
  app.get('/api/ai/v1beta/models', async (req, res) => {
    const user = await userFromToken((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
    if (!user) return res.status(401).json({ error: 'Avval tizimga kiring' });

    const { data, error } = await adminClient().rpc('allowed_models', { p_user: user.id });
    if (error) return res.status(500).json({ error: error.message });

    const models = (data ?? []).map((m) => ({
      name: `models/${m.model}`,
      displayName: m.model,
      supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
    }));
    res.json({ models });
  });

  /** Asosiy shlyuz. */
  /*
   * `*` ishlatiladi, chunki model nomida ham `/` boʻlishi mumkin
   * (masalan `openai/gpt-4o-mini` toʻgʻridan-toʻgʻri soʻralganda).
   */
  app.post('/api/ai/v1beta/models/*', async (req, res) => {
    const started = Date.now();
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const user = await userFromToken(token);
    if (!user) return res.status(401).json({ error: 'Avval tizimga kiring' });

    const match = /^(.+):([A-Za-z]+)$/.exec(req.params[0] ?? '');
    if (!match) return res.status(404).json({ error: 'Bunday manzil yoʻq' });
    const requested = decodeURIComponent(match[1]);
    const method = match[2];

    // ---- suiisteʼmolga qarshi
    const limit = rateLimit(`ai:${user.id}`, RATE_PER_MIN, RATE_BURST);
    if (!limit.ok) {
      res.set('Retry-After', String(limit.retryAfter));
      return res.status(429).json({
        error: `Juda tez-tez soʻrov yuborilyapti. ${limit.retryAfter} soniyadan soʻng urining.`,
      });
    }

    const admin = adminClient();

    // ---- reja va kredit
    const { data: check, error: checkError } = await admin.rpc('can_use_model', {
      p_user: user.id,
      p_model: requested,
    });
    if (checkError) return res.status(500).json({ error: checkError.message });
    const verdict = check ?? {};
    if (!verdict.allowed) {
      return res.status(402).json({
        error: `${verdict.reason ?? 'ruxsat yoʻq'}. Obunani yangilang yoki hisobingizni toʻldiring.`,
      });
    }

    const slug = verdict.use_model ?? requested;
    const chargeSource = verdict.source ?? 'plan';

    // ---- slug ortida kim turadi (bir daqiqa keshlanadi)
    let target;
    try {
      target = await modelCache.get(slug, async () => {
        const { data, error } = await admin.rpc('resolve_model', { p_slug: slug });
        if (error) throw new Error(error.message);
        return data ?? { provider: 'google', upstream: slug };
      });
    } catch (err) {
      return res.status(500).json({ error: String(err?.message ?? err) });
    }
    const provider = target.provider === 'openrouter' ? 'openrouter' : 'google';

    if (!keyFor(provider)) {
      return res.status(503).json({
        error:
          provider === 'openrouter'
            ? 'OpenRouter kaliti serverda sozlanmagan (OPENROUTER_API_KEY).'
            : 'Google kaliti serverda sozlanmagan (GEMINI_API_KEY).',
      });
    }

    const body = req.body ?? {};
    const raw = JSON.stringify(body);
    const stream = /stream/i.test(method) || req.query.alt === 'sse';
    const kind = kindOf(method, body);

    if (verdict.note) {
      res.set('X-Daho-Notice', encodeURIComponent(verdict.note));
      res.set('X-Daho-Model', slug);
    }
    res.set('X-Daho-Provider', provider);

    const charge = async (usage) => {
      if (!usage || (!usage.input && !usage.output)) return;
      const { error } = await admin.rpc('charge_usage', {
        p_user: user.id,
        p_model: slug,
        p_kind: kind,
        p_input: usage.input,
        p_output: usage.output,
        p_source: 'gateway',
        p_job: null,
        p_meta: {
          method,
          charge_source: chargeSource,
          requested,
          provider,
          upstream: target.upstream,
          ms: Date.now() - started,
        },
      });
      if (error) console.error('charge_usage:', error.message);
    };

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    /*
     * Navbat. Yuk koʻtarilganda soʻrov rad etilmaydi — bir necha soniya
     * kutadi. AI javobi baribir soniyalarda keladi, foydalanuvchi farqni
     * sezmaydi, server esa tiqilib qolmaydi.
     */
    let leave;
    try {
      leave = await gate.enter(user.id);
    } catch (err) {
      res.set('Retry-After', '5');
      return res.status(503).json({ error: String(err?.message ?? err) });
    }
    let chiqdi = false;
    const release = () => {
      if (chiqdi) return;
      chiqdi = true;
      leave();
    };
    res.on('close', release);
    res.on('finish', release);

    let upstreamRes;
    try {
      upstreamRes =
        provider === 'openrouter'
          ? await callOpenRouter({
              upstream: target.upstream,
              body,
              stream,
              signal: controller.signal,
              referer: req.get('origin'),
            })
          : await callGoogle({
              upstream: target.upstream,
              method,
              raw,
              query: Object.entries(req.query ?? {}),
              signal: controller.signal,
            });
    } catch (err) {
      release();
      if (controller.signal.aborted) return;
      return res.status(502).json({ error: `Provayderga ulanib boʻlmadi: ${err?.message ?? err}` });
    }

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text().catch(() => '');
      let message = text;
      try {
        const parsed = JSON.parse(text);
        message = parsed?.error?.message || parsed?.error || text;
      } catch {
        /* xom matn qoladi */
      }
      release();
      return res
        .status(upstreamRes.status)
        .json({ error: { message: String(message).slice(0, 2000), code: upstreamRes.status } });
    }

    /* ---------------- Google: oʻzgartirmasdan oʻtkazamiz ---------------- */
    if (provider === 'google') {
      const isStream = (upstreamRes.headers.get('content-type') ?? '').includes('event-stream');
      if (!isStream || !upstreamRes.body) {
        const text = await upstreamRes.text();
        try {
          await charge(googleUsage(JSON.parse(text)));
        } catch {
          /* hisobsiz oʻtadi */
        }
        return res.type('application/json').send(text);
      }

      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      /*
       * `fetch` javobi Uint8Array beradi, Buffer emas — uning
       * `toString('utf8')` i ishlamaydi (raqamlar roʻyxatini qaytaradi).
       * Shuning uchun TextDecoder.
       */
      const decoder = new TextDecoder();
      let buffer = '';
      let usage = null;
      for await (const chunk of upstreamRes.body) {
        res.write(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (!line.includes('usageMetadata')) continue;
          try {
            const found = googleUsage(JSON.parse(line.replace(/^data:\s*/, '')));
            if (found) usage = found;
          } catch {
            /* toʻliq boʻlmagan boʻlak */
          }
        }
        if (buffer.length > 1_000_000) buffer = buffer.slice(-4096);
      }
      await charge(usage);
      return res.end();
    }

    /* ---------------- OpenRouter: tarjima qilamiz ---------------- */
    if (!stream) {
      const data = await upstreamRes.json().catch(() => ({}));
      const geminiShape = fromOpenAi(data);
      const meta = usageFrom(data?.usage);
      if (meta) {
        await charge({ input: meta.promptTokenCount, output: meta.candidatesTokenCount });
      }
      return res.json(geminiShape);
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const tr = streamTranslator();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of upstreamRes.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let parsed;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          const out = tr.chunk(parsed);
          if (out) res.write(sseLine(out));
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) console.error('oqim uzildi:', err?.message ?? err);
    }

    const tail = tr.flush();
    if (tail) res.write(sseLine(tail));
    const meta = tr.usage();
    if (meta) {
      await charge({ input: meta.promptTokenCount, output: meta.candidatesTokenCount });
    }
    res.end();
  });
}
