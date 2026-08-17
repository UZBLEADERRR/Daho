/**
 * Koʻp provayderli model qatlami.
 *
 * Daho faqat Gemini bilan cheklanmaydi: OpenRouter, OpenAI, Kimi (Moonshot),
 * Qwen (DashScope), DeepSeek, Groq va boshqa "OpenAI-mos" API lar ham
 * ulanadi. Ichkarida hamma narsa Gemini shaklida (GeminiContent/parts)
 * yuritiladi — bu yerda faqat tarjima qilinadi. Shu tufayli agent kodi
 * oʻzgarmaydi, lekin istalgan model bilan ishlayveradi.
 *
 * Model nomi: gemini uchun oddiy `gemini-3-flash`, boshqalar uchun
 * `provayder::model` (masalan `openrouter::moonshotai/kimi-k2`).
 */

import {
  GeminiError,
  streamGenerate,
  type FunctionDeclaration,
  type GeminiContent,
  type GeminiPart,
  type StreamOptions,
  type StreamResult,
} from './gemini';
import { cachedModels, getModels, type ModelInfo, type ModelRole } from './models';
import { getState } from './store';
import type { Attachment, ProviderConfig } from './types';

export const REF_SEPARATOR = '::';

/* ------------------------------------------------------------------ */
/*  Tayyor provayderlar                                                */
/* ------------------------------------------------------------------ */

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  /** Kalit qayerdan olinadi */
  keyUrl: string;
  note: string;
  /** Roʻyxat olinmasa koʻrsatiladigan mashhur modellar */
  suggested: string[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Bitta kalit bilan 300+ model: Kimi, Qwen, DeepSeek, GPT, Claude, Llama.',
    suggested: [
      'moonshotai/kimi-k2',
      'qwen/qwen3-coder',
      'deepseek/deepseek-chat',
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
      'meta-llama/llama-3.3-70b-instruct',
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    note: 'GPT oilasi.',
    suggested: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  },
  {
    id: 'moonshot',
    label: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.ai/v1',
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
    note: 'Kimi K2 — uzun kontekst va kuchli agentlik.',
    suggested: ['kimi-k2-0905-preview', 'moonshot-v1-128k', 'moonshot-v1-32k'],
  },
  {
    id: 'dashscope',
    label: 'Qwen (DashScope)',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    keyUrl: 'https://dashscope.console.aliyun.com',
    note: 'Alibaba Qwen — kod yozishda kuchli.',
    suggested: ['qwen-max', 'qwen-plus', 'qwen3-coder-plus'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: 'Narx/samaradorlik boʻyicha yetakchi.',
    suggested: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    note: 'Juda tez — kichik vazifalar uchun.',
    suggested: ['llama-3.3-70b-versatile', 'qwen/qwen3-32b'],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys',
    note: 'Yevropa modellari.',
    suggested: ['mistral-large-latest', 'codestral-latest'],
  },
  {
    id: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    note: 'Ochiq modellar toʻplami.',
    suggested: ['Qwen/Qwen2.5-Coder-32B-Instruct', 'deepseek-ai/DeepSeek-V3'],
  },
];

export function presetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/* ------------------------------------------------------------------ */
/*  Model havolasi                                                     */
/* ------------------------------------------------------------------ */

export interface ModelRef {
  /** '' — Gemini (asosiy kalit bilan) */
  provider: string;
  model: string;
}

export function parseRef(ref: string): ModelRef {
  const idx = ref.indexOf(REF_SEPARATOR);
  if (idx < 0) return { provider: '', model: ref };
  return { provider: ref.slice(0, idx), model: ref.slice(idx + REF_SEPARATOR.length) };
}

export function makeRef(provider: string, model: string): string {
  return provider ? `${provider}${REF_SEPARATOR}${model}` : model;
}

export function isGeminiRef(ref: string): boolean {
  return !parseRef(ref).provider;
}

/** Sozlamalardagi provayder (yoqilgan boʻlsa). */
export function providerConfig(id: string): ProviderConfig | undefined {
  return getState().settings.providers?.find((p) => p.id === id);
}

/** Ishlashga tayyor provayderlar — kaliti bor va yoqilgan. */
export function activeProviders(): ProviderConfig[] {
  return (getState().settings.providers ?? []).filter((p) => p.enabled && p.apiKey.trim());
}

/* ------------------------------------------------------------------ */
/*  Nima ishlashga tayyor                                              */
/* ------------------------------------------------------------------ */

/** Gemini kaliti kiritilganmi. */
export function hasGemini(): boolean {
  return Boolean(getState().settings.apiKey.trim());
}

/**
 * Suhbat qilish mumkinmi. Gemini kaliti SHART EMAS — faqat OpenRouter
 * (yoki boshqa provayder) ulangan boʻlsa ham ilova toʻliq gaplashadi.
 */
export function canChat(): boolean {
  return hasGemini() || activeProviders().length > 0;
}

/**
 * Rasm yasash mumkinmi. Gemini kaliti bilan — toʻgʻridan-toʻgʻri;
 * kalitsiz — provayder orqali rasm chiqaradigan model boʻlsa.
 */
export function canMakeImages(): boolean {
  return hasGemini() || Boolean(imageCapableRef());
}

/**
 * Provayderlar ichidan rasm chiqara oladigan model topadi.
 * OpenRouter’da Gemini ning rasm modellari bor — shuning uchun Google
 * kalitisiz ham muqova va illyustratsiya yasash mumkin.
 */
export function imageCapableRef(): string | null {
  const IMAGE = /image|imagen|flux|dall-e|sdxl|stable-diffusion/i;
  const hidden = new Set(getState().settings.hiddenModels ?? []);
  for (const cfg of activeProviders()) {
    const ids = [...new Set([...(cfg.manual ?? []), ...cachedProviderModels(cfg.id)])];
    const hit = ids.find((id) => IMAGE.test(id) && !hidden.has(makeRef(cfg.id, id)));
    if (hit) return makeRef(cfg.id, hit);
  }
  return null;
}

/** Google qidiruvi faqat Gemini bilan ishlaydi. */
export function canSearchWeb(): boolean {
  return hasGemini();
}

/* ------------------------------------------------------------------ */
/*  Gemini ↔ OpenAI tarjimasi                                          */
/* ------------------------------------------------------------------ */

/** Gemini sxemasidagi katta harfli turlarni OpenAI ko'rinishiga o'giradi. */
function lowerSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(lowerSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'type' && typeof value === 'string') out.type = value.toLowerCase();
    else out[key] = lowerSchema(value);
  }
  return out;
}

function toOpenAiTools(tools?: FunctionDeclaration[]): unknown[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: lowerSchema({
        type: 'object',
        properties: t.parameters.properties ?? {},
        required: t.parameters.required ?? [],
      }),
    },
  }));
}

interface OaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: unknown;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

/**
 * Gemini suhbatini OpenAI xabarlariga oʻgiradi.
 *
 * Gemini funksiya chaqiruvlarida id boʻlmaydi — shu sabab tartib boʻyicha
 * `call_<n>` id lari yasab, javoblarni oʻsha tartibda bogʻlaymiz.
 */
function toOpenAiMessages(contents: GeminiContent[], system?: string): OaMessage[] {
  const out: OaMessage[] = [];
  if (system) out.push({ role: 'system', content: system });

  let counter = 0;
  /** Oxirgi model xabarida yaratilgan chaqiruv id lari (javob navbati) */
  let pendingIds: string[] = [];

  for (const content of contents) {
    const calls = content.parts.filter((p) => p.functionCall?.name);
    const responses = content.parts.filter((p) => p.functionResponse?.name);
    const texts = content.parts
      .filter((p) => typeof p.text === 'string' && p.text && !p.thought)
      .map((p) => p.text as string);
    const images = content.parts.filter((p) => p.inlineData?.data);

    if (content.role === 'model') {
      const msg: OaMessage = { role: 'assistant', content: texts.join('') || null };
      if (calls.length) {
        pendingIds = [];
        msg.tool_calls = calls.map((p) => {
          const id = `call_${(counter += 1)}`;
          pendingIds.push(id);
          return {
            id,
            type: 'function' as const,
            function: {
              name: p.functionCall!.name,
              arguments: JSON.stringify(p.functionCall!.args ?? {}),
            },
          };
        });
      }
      if (msg.content || msg.tool_calls) out.push(msg);
      continue;
    }

    // Foydalanuvchi tomonidagi funksiya javoblari alohida 'tool' xabar boʻladi.
    if (responses.length) {
      responses.forEach((p, i) => {
        out.push({
          role: 'tool',
          tool_call_id: pendingIds[i] ?? `call_${(counter += 1)}`,
          content: JSON.stringify(p.functionResponse!.response ?? {}),
        });
      });
      pendingIds = pendingIds.slice(responses.length);
    }

    if (texts.length || images.length) {
      if (images.length) {
        const parts: unknown[] = images.map((p) => ({
          type: 'image_url',
          image_url: {
            url: `data:${p.inlineData!.mimeType};base64,${p.inlineData!.data}`,
          },
        }));
        if (texts.join('').trim()) parts.push({ type: 'text', text: texts.join('') });
        out.push({ role: 'user', content: parts });
      } else {
        out.push({ role: 'user', content: texts.join('') });
      }
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/*  OpenAI-mos oqim                                                    */
/* ------------------------------------------------------------------ */

function humanHttpError(status: number, body: string, label: string): string {
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message ?? parsed?.message ?? detail;
  } catch {
    /* xom matn qoladi */
  }
  switch (status) {
    case 401:
    case 403:
      return `${label}: kalit qabul qilinmadi. Sozlamalar → AI modellar boʻlimidan tekshiring. (${detail})`;
    case 402:
      return `${label}: hisobda mablagʻ tugagan. (${detail})`;
    case 404:
      return `${label}: bunday model yoʻq. Roʻyxatni yangilang. (${detail})`;
    case 429:
      return `${label}: limit tugadi — biroz kutib qayta urining.`;
    case 500:
    case 502:
    case 503:
    case 504:
      return `${label} serveri band. Bir necha soniyadan soʻng qayta urinaman.`;
    default:
      return `${label}: ${detail || `xato (HTTP ${status})`}`;
  }
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/** OpenAI-mos API ga stream soʻrovi. Band boʻlsa oʻzi kutib qayta uradi. */
async function streamOpenAi(
  cfg: ProviderConfig,
  opts: StreamOptions,
  model: string,
): Promise<StreamResult> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAiMessages(opts.contents, opts.systemInstruction),
    temperature: opts.temperature ?? 0.8,
    stream: true,
  };
  const tools = toOpenAiTools(opts.tools);
  if (tools) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey.trim()}`,
  };
  // OpenRouter brauzerdan kelgan soʻrovlarda shu sarlavhalarni kutadi.
  if (cfg.baseUrl.includes('openrouter')) {
    headers['HTTP-Referer'] = 'https://daho.app';
    headers['X-Title'] = 'Daho';
  }

  let res: Response | null = null;
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: opts.signal,
      });
      if (r.ok) {
        res = r;
        break;
      }
      const text = await r.text().catch(() => '');
      const err = new GeminiError(humanHttpError(r.status, text, cfg.label), r.status);
      if (!RETRYABLE.has(r.status) || attempt === 4) throw err;
      lastError = err;
      opts.onRetry?.(attempt + 1, Math.round(Math.min(30000, 2000 * 2 ** attempt) / 1000));
      await wait(Math.min(30000, 2000 * 2 ** attempt), opts.signal);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      if (err instanceof GeminiError && !RETRYABLE.has(err.status)) throw err;
      lastError = err;
      if (attempt === 4) throw err;
      await wait(Math.min(30000, 2000 * 2 ** attempt), opts.signal);
    }
  }
  if (!res) throw lastError ?? new GeminiError(`${cfg.label}: ulanib boʻlmadi.`, 0);
  if (!res.body) throw new GeminiError(`${cfg.label}: javob oqimi boʻsh keldi.`, 0);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finishReason = '';
  const images: Attachment[] = [];
  /** index → yigʻilayotgan chaqiruv */
  const calls = new Map<number, { name: string; args: string }>();

  const handle = (raw: string) => {
    if (!raw || raw === '[DONE]') return;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (parsed?.error) {
      throw new GeminiError(
        `${cfg.label}: ${parsed.error.message ?? 'nomaʼlum xato'}`,
        Number(parsed.error.code) || 0,
      );
    }
    const choice = parsed?.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = String(choice.finish_reason);

    const delta = choice.delta ?? choice.message ?? {};
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content;
      opts.onText(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const index = Number(tc.index ?? calls.size);
      const entry = calls.get(index) ?? { name: '', args: '' };
      if (tc.function?.name) entry.name = tc.function.name;
      if (typeof tc.function?.arguments === 'string') entry.args += tc.function.arguments;
      calls.set(index, entry);
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) handle(line.slice(5).trim());
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith('data:')) handle(tail.slice(5).trim());

  const functionCalls = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => {
      let args: Record<string, unknown> = {};
      try {
        args = c.args ? (JSON.parse(c.args) as Record<string, unknown>) : {};
      } catch {
        /* model buzuq JSON qaytardi — boʻsh argument bilan davom etamiz */
      }
      return { name: c.name, args };
    })
    .filter((c) => c.name);

  // Suhbat tarixiga qaytariladigan qismlar — Gemini shaklida.
  const parts: GeminiPart[] = [];
  if (text) parts.push({ text });
  for (const call of functionCalls) parts.push({ functionCall: call });

  return {
    text,
    functionCalls,
    images,
    parts,
    // OpenAI 'length' deydi, Gemini 'MAX_TOKENS' — bittaga keltiramiz.
    finishReason: finishReason === 'length' ? 'MAX_TOKENS' : finishReason.toUpperCase(),
  };
}

/* ------------------------------------------------------------------ */
/*  Umumiy kirish nuqtasi                                              */
/* ------------------------------------------------------------------ */

/**
 * Model qaysi provayderniki boʻlsa — oʻshanga yuboradi.
 * Agent kodi shu bitta funksiyani chaqiradi.
 */
export async function streamAny(opts: StreamOptions): Promise<StreamResult> {
  const ref = parseRef(opts.model);
  if (!ref.provider) return streamGenerate(opts);

  const cfg = providerConfig(ref.provider);
  if (!cfg || !cfg.apiKey.trim()) {
    throw new GeminiError(
      `«${ref.provider}» provayderining kaliti kiritilmagan. Sozlamalar → AI modellar.`,
      0,
    );
  }
  return streamOpenAi(cfg, opts, ref.model);
}

/** Streamsiz qisqa soʻrov — sarlavha, xulosa kabi mayda ishlar uchun. */
export async function completeAny(
  model: string,
  prompt: string,
  opts: { system?: string; temperature?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const { settings } = getState();
  let out = '';
  const res = await streamAny({
    apiKey: settings.apiKey,
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: opts.system,
    temperature: opts.temperature ?? 0.4,
    signal: opts.signal,
    onText: (chunk) => {
      out += chunk;
    },
  });
  return (res.text || out).trim();
}

/* ------------------------------------------------------------------ */
/*  Sxema boʻyicha JSON — provayderdan qatʼi nazar                     */
/* ------------------------------------------------------------------ */

/** Matn ichidan JSON obyektini ajratib oladi (kod bloki, izoh boʻlsa ham). */
function extractJson<T>(raw: string): T {
  const text = raw.trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    /* pastdagi urinishlarga oʻtamiz */
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]) as T;
    } catch {
      /* davom etamiz */
    }
  }
  // Eng tashqi { … } ni topamiz — model oldiga izoh yozib qoʻygan boʻlishi mumkin.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1)) as T;
  }
  throw new GeminiError('Model tushunarli JSON qaytarmadi. Qaytadan urining.', 0);
}

/**
 * Sxema boʻyicha JSON oladi.
 *
 * Gemini kaliti boʻlsa — `responseSchema` bilan (ishonchli). Boʻlmasa
 * (masalan faqat OpenRouter ulangan) — sxemani soʻrov matniga qoʻshib
 * beramiz va javobdan JSON ni ajratib olamiz. Shu tufayli kitob rejasi va
 * savollar Google kalitisiz ham ishlaydi.
 */
export async function jsonAny<T>(
  prompt: string,
  schema: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const { settings } = getState();

  if (hasGemini()) {
    const { generateJson } = await import('./gemini');
    const { geminiModel } = await import('./models');
    return generateJson<T>(
      settings.apiKey,
      geminiModel(settings.model),
      prompt,
      schema,
      signal,
    );
  }

  const text = await completeAny(
    settings.model,
    `${prompt}\n\n---\nJavobni AYNAN quyidagi JSON sxemasiga mos qaytar. ` +
      `Faqat JSON yoz — izoh, sarlavha yoki kod bloki belgilarisiz.\n` +
      `Sxema:\n${JSON.stringify(schema)}`,
    { temperature: 0.6, signal },
  );
  return extractJson<T>(text);
}

/* ------------------------------------------------------------------ */
/*  Rasm yasash — provayderdan qatʼi nazar                             */
/* ------------------------------------------------------------------ */

/**
 * OpenAI-mos provayderdan rasm oladi.
 *
 * OpenRouter rasm chiqaradigan modellar uchun `modalities: ["image","text"]`
 * ni qabul qiladi va rasmni `message.images[].image_url.url` da (data: URI)
 * qaytaradi. Baʼzi provayderlar esa `content` massivida beradi — ikkalasini
 * ham tekshiramiz.
 */
async function imageViaProvider(
  ref: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<Attachment[]> {
  const { provider, model } = parseRef(ref);
  const cfg = providerConfig(provider);
  if (!cfg?.apiKey.trim()) throw new GeminiError('Rasm uchun provayder kaliti yoʻq.', 0);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey.trim()}`,
  };
  if (cfg.baseUrl.includes('openrouter')) {
    headers['HTTP-Referer'] = 'https://daho.app';
    headers['X-Title'] = 'Daho';
  }

  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image', 'text'],
    }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GeminiError(humanHttpError(res.status, body, cfg.label), res.status);
  }

  const data = await res.json();
  const message = data?.choices?.[0]?.message ?? {};
  const urls: string[] = [];

  for (const item of message.images ?? []) {
    const url = item?.image_url?.url ?? item?.url;
    if (typeof url === 'string') urls.push(url);
  }
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      const url = part?.image_url?.url ?? (part?.type === 'image_url' ? part?.url : null);
      if (typeof url === 'string') urls.push(url);
    }
  }

  const images: Attachment[] = [];
  for (const url of urls) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (match) images.push({ mimeType: match[1], data: match[2] });
  }
  if (!images.length) {
    throw new GeminiError(
      `${cfg.label}: «${model}» rasm qaytarmadi. Rasm chiqaradigan model tanlang ` +
        '(masalan google/gemini-2.5-flash-image).',
      0,
    );
  }
  return images;
}

/**
 * Rasm yasaydi: Gemini kaliti boʻlsa oʻsha bilan, boʻlmasa ulangan
 * provayderning rasm modeli bilan.
 */
export async function imageAny(
  prompt: string,
  refs: Attachment[] = [],
  signal?: AbortSignal,
): Promise<Attachment[]> {
  const { settings } = getState();

  if (hasGemini()) {
    const { generateImage } = await import('./gemini');
    const res = await generateImage(settings.apiKey, settings.imageModel, prompt, refs, signal);
    return res.images;
  }

  const ref = imageCapableRef();
  if (!ref) {
    throw new GeminiError(
      'Rasm yasash uchun rasm modeli yoʻq. Sozlamalar → AI modellar boʻlimida ' +
        'rasm chiqaradigan model qoʻshing (masalan OpenRouter’da ' +
        '«google/gemini-2.5-flash-image») yoki Google kalitini kiriting.',
      0,
    );
  }
  return imageViaProvider(ref, prompt, signal);
}

/* ------------------------------------------------------------------ */
/*  Provayder modellari roʻyxati                                       */
/* ------------------------------------------------------------------ */

const LIST_CACHE_KEY = 'daho.provmodels.v1';
const LIST_TTL = 12 * 60 * 60 * 1000;

interface ListCache {
  [providerId: string]: { at: number; models: string[] };
}

function readListCache(): ListCache {
  try {
    return JSON.parse(localStorage.getItem(LIST_CACHE_KEY) ?? '{}') as ListCache;
  } catch {
    return {};
  }
}

function writeListCache(cache: ListCache): void {
  try {
    localStorage.setItem(LIST_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* xotira toʻlgan */
  }
}

/** Provayderdan model roʻyxatini oladi (keshlanadi). */
export async function listProviderModels(
  cfg: ProviderConfig,
  force = false,
): Promise<string[]> {
  const cache = readListCache();
  const hit = cache[cfg.id];
  if (!force && hit && Date.now() - hit.at < LIST_TTL) return hit.models;

  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey.trim()}` },
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const ids: string[] = (data?.data ?? data?.models ?? [])
      .map((m: any) => String(m?.id ?? m?.name ?? ''))
      .filter(Boolean);
    if (ids.length) {
      cache[cfg.id] = { at: Date.now(), models: ids };
      writeListCache(cache);
      return ids;
    }
  } catch {
    /* roʻyxat olinmadi — qoʻlda kiritilgan yoki tavsiya qilingan modellar qoladi */
  }

  if (hit?.models.length) return hit.models;
  return presetById(cfg.id)?.suggested ?? [];
}

/** Keshdan (soʻrovsiz) — UI darhol koʻrsatishi uchun. */
export function cachedProviderModels(providerId: string): string[] {
  return readListCache()[providerId]?.models ?? [];
}

/* ------------------------------------------------------------------ */
/*  Barcha modellar — Gemini + ulangan provayderlar                    */
/* ------------------------------------------------------------------ */

/** Model nomidan "yangilik/kuch" bahosi — roʻyxatda kuchlisi yuqorida turadi. */
function guessScore(id: string): number {
  const low = id.toLowerCase();
  const version = low.match(/(\d+(?:\.\d+)?)/);
  let score = version ? Math.min(parseFloat(version[1]), 20) * 20 : 60;
  if (/opus|max|ultra|-pro\b|405b|235b/.test(low)) score += 40;
  else if (/sonnet|plus|large|70b|72b|32b/.test(low)) score += 25;
  else if (/mini|lite|small|8b|7b|nano|haiku|flash/.test(low)) score += 8;
  if (/coder|code/.test(low)) score += 12;
  if (/kimi|qwen3|deepseek-v3|deepseek-chat|gpt-4o|gpt-4\.1/.test(low)) score += 15;
  if (/preview|exp|beta|alpha|free/.test(low)) score -= 10;
  if (/embed|whisper|tts|dall-e|moderation|rerank/.test(low)) score -= 500;
  return score;
}

/** Model nomidan uning vazifasini taxmin qiladi. */
function guessRole(id: string): ModelRole {
  const low = id.toLowerCase();
  if (/embed|rerank|moderation/.test(low)) return 'embed';
  if (/\btts\b|-tts|whisper|speech/.test(low)) return 'tts';
  if (/\bveo\b|video|sora/.test(low)) return 'video';
  if (/image|imagen|flux|dall-e|sdxl|stable-diffusion/.test(low)) return 'image';
  return 'chat';
}

function providerModelInfo(cfg: ProviderConfig, id: string): ModelInfo {
  return {
    id: makeRef(cfg.id, id),
    label: id,
    role: guessRole(id),
    score: guessScore(id),
    preview: /preview|exp|beta/.test(id.toLowerCase()),
    description: cfg.label,
    provider: cfg.id,
    providerLabel: cfg.label,
  };
}

/**
 * Bitta provayderdan koʻrsatiladigan modellar chegarasi.
 *
 * OpenRouter 300+ model qaytaradi — hammasini roʻyxatga qoʻysak telefonda
 * tanlash oynasi sekinlashadi. Eng kuchli/yangilarini qoldiramiz, qolganini
 * foydalanuvchi qoʻlda «manual» ga yozib qoʻyishi mumkin.
 */
const PER_PROVIDER_LIMIT = 80;

/** Modellar roʻyxati: Gemini + barcha yoqilgan provayderlar. */
export async function allModels(force = false): Promise<ModelInfo[]> {
  const { settings } = getState();
  const gemini = await getModels(settings.apiKey, force).catch(() => cachedModels());

  const extra: ModelInfo[] = [];
  for (const cfg of activeProviders()) {
    const ids = await listProviderModels(cfg, force).catch(() => []);
    extra.push(...trimProvider(cfg, ids));
  }

  return dedupe([...gemini, ...extra]);
}

/**
 * Provayder modellarini saralab, cheklab qaytaradi.
 * Qoʻlda kiritilganlar HAR DOIM qoladi — foydalanuvchi aynan oʻshani tanlagan.
 */
function trimProvider(cfg: ProviderConfig, ids: string[]): ModelInfo[] {
  const manual = (cfg.manual ?? []).map((id) => providerModelInfo(cfg, id));
  const pool = ids
    .filter((id) => !(cfg.manual ?? []).includes(id))
    .map((id) => providerModelInfo(cfg, id))
    .filter((m) => m.role !== 'embed')
    .sort((a, b) => b.score - a.score);

  // Rasm/ovoz modellari kam boʻladi — ularni chegara yeb ketmasin.
  const chat = pool.filter((m) => m.role === 'chat').slice(0, PER_PROVIDER_LIMIT);
  const other = pool.filter((m) => m.role !== 'chat').slice(0, 12);
  return [...manual, ...chat, ...other];
}

/** Soʻrovsiz — keshdagi hamma model. */
export function allCachedModels(): ModelInfo[] {
  const extra: ModelInfo[] = [];
  for (const cfg of activeProviders()) {
    const cached = cachedProviderModels(cfg.id);
    const ids = cached.length ? cached : (presetById(cfg.id)?.suggested ?? []);
    extra.push(...trimProvider(cfg, ids));
  }
  return dedupe([...cachedModels(), ...extra]);
}

function dedupe(list: ModelInfo[]): ModelInfo[] {
  const seen = new Map<string, ModelInfo>();
  for (const m of list) if (!seen.has(m.id)) seen.set(m.id, m);
  return [...seen.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Foydalanuvchi oʻchirmagan modellar — tanlash roʻyxatlari uchun. */
export function visibleModels(list: ModelInfo[]): ModelInfo[] {
  const hidden = new Set(getState().settings.hiddenModels ?? []);
  return list.filter((m) => !hidden.has(m.id));
}

/** Chat uchun ishlatsa boʻladigan modellar (oʻchirilganlar chiqarib tashlanadi). */
export function usableChatModels(): ModelInfo[] {
  return visibleModels(allCachedModels()).filter((m) => m.role === 'chat');
}

/** Model nomining koʻrinadigan yorligʻi. */
export function modelLabel(ref: string): string {
  if (!ref) return 'asosiy model';
  const found = allCachedModels().find((m) => m.id === ref);
  if (found) return found.providerLabel ? `${found.label} · ${found.providerLabel}` : found.label;
  const { provider, model } = parseRef(ref);
  return provider ? `${model} · ${provider}` : model;
}
