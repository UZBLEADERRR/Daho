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
import { cachedModels, geminiModel, getModels, type ModelInfo, type ModelRole } from './models';
import { getState } from './store';
import { recordUsage } from './usage';
import type { Attachment, ProviderConfig, RoleModels } from './types';

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
      // Rasm modellari — muqova va illyustratsiya uchun
      'google/gemini-2.5-flash-image-preview',
      'black-forest-labs/flux.2-pro',
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
  const hidden = new Set(getState().settings.hiddenModels ?? []);
  for (const cfg of activeProviders()) {
    const pool = [
      ...cachedProviderModels(cfg.id),
      ...(cfg.manual ?? []).map(guessProviderModel),
    ];
    const hit = pool.find((m) => m.draws && !hidden.has(makeRef(cfg.id, m.id)));
    if (hit) return makeRef(cfg.id, hit.id);
  }
  return null;
}

/**
 * Rasmni koʻra oladigan model — skrinshotni tahlil qilish uchun.
 * Asosiy model koʻrmasa, koʻradigan modeldan «dizaynni baholab ber» deb
 * soʻraymiz va matnli xulosani asosiy modelga beramiz.
 */
export function visionCapableRef(): string | null {
  const { settings } = getState();
  const hidden = new Set(settings.hiddenModels ?? []);
  // Foydalanuvchi rollarga model biriktirgan boʻlsa — avval oʻshalar.
  for (const preferred of [settings.roleModels?.dizayn, settings.roleModels?.bosh, settings.model]) {
    if (preferred && supportsVision(preferred) && !hidden.has(preferred)) return preferred;
  }
  if (hasGemini()) return geminiModel(getState().settings.model);
  for (const cfg of activeProviders()) {
    const hit = cachedProviderModels(cfg.id).find(
      (m) => m.vision && !m.draws && !hidden.has(makeRef(cfg.id, m.id)),
    );
    if (hit) return makeRef(cfg.id, hit.id);
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

/**
 * Xato tafsilotini ajratadi.
 *
 * OpenRouter oʻzining «Provider returned error» degan umumiy xabarini
 * beradi, HAQIQIY sabab esa `error.metadata.raw` ichida boʻladi. Shuni
 * chiqarmasak foydalanuvchi nima boʻlganini bilmaydi.
 */
function errorDetail(body: string): { text: string; raw: string } {
  try {
    const parsed = JSON.parse(body);
    const err = parsed?.error ?? parsed;
    const meta = err?.metadata ?? {};
    let raw = typeof meta.raw === 'string' ? meta.raw : '';
    if (!raw && meta.raw) raw = JSON.stringify(meta.raw);
    const provider = typeof meta.provider_name === 'string' ? meta.provider_name : '';
    // Upstream matni ham JSON boʻlishi mumkin — undan ham message ni olamiz.
    try {
      const inner = JSON.parse(raw);
      raw = inner?.error?.message ?? inner?.message ?? raw;
    } catch {
      /* raw oddiy matn */
    }
    const text = [err?.message ?? parsed?.message ?? '', provider && `(${provider})`, raw]
      .filter(Boolean)
      .join(' ');
    return { text: text.trim().slice(0, 400), raw };
  } catch {
    return { text: body.slice(0, 300), raw: '' };
  }
}

function humanHttpError(status: number, body: string, label: string): string {
  const detail = errorDetail(body).text || body.slice(0, 300);
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
/**
 * Model qabul qilmaydigan parametrlar — bir marta bilib olgach eslab qolamiz.
 *
 * Mulohaza yuritadigan modellar (gpt-5.x, o-seriya, ayrim «thinking» modellar)
 * `temperature` ni rad etadi; baʼzi modellar esa `tools` ni bilmaydi. Bunda
 * OpenRouter «Provider returned error» deb umumiy xato qaytaradi. Shuning
 * uchun soʻrovni bosqichma-bosqich soddalashtirib qayta yuboramiz.
 */
const noTemperature = new Set<string>();
const noTools = new Set<string>();

/** Bu model vositalarni (function calling) qoʻllab-quvvatlamasligi aniqlangan. */
export function knownToolless(ref: string): boolean {
  return noTools.has(ref);
}

const PARAM_REJECT =
  /temperature|unsupported|unrecognized|not supported|invalid.*(parameter|argument)|extra fields/i;
const TOOL_REJECT = /tool|function.?call/i;

async function streamOpenAi(
  cfg: ProviderConfig,
  opts: StreamOptions,
  model: string,
): Promise<StreamResult> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const ref = makeRef(cfg.id, model);
  const messages = toOpenAiMessages(opts.contents, opts.systemInstruction);
  const tools = toOpenAiTools(opts.tools);

  /** Soʻrov tanasini joriy bilimlarga qarab yigʻadi. */
  const buildBody = (dropTemp: boolean, dropTools: boolean): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      // Oxirgi boʻlakda nechta token sarflanganini soʻraymiz — xarajat
      // hisoblagichi shu raqamga tayanadi.
      stream_options: { include_usage: true },
    };
    if (!dropTemp && !noTemperature.has(ref)) body.temperature = opts.temperature ?? 0.8;
    if (tools && !dropTools && !noTools.has(ref)) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    return body;
  };

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
  let dropTemp = false;
  let dropTools = false;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildBody(dropTemp, dropTools)),
        signal: opts.signal,
      });
      if (r.ok) {
        res = r;
        break;
      }
      const text = await r.text().catch(() => '');
      const detail = errorDetail(text);
      const err = new GeminiError(humanHttpError(r.status, text, cfg.label), r.status);

      // Parametr yoqmadimi? Soddalashtirib QAYTA yuboramiz — bu xato
      // kutishdan oʻtmaydi, shuning uchun darhol urinamiz.
      const complaint = `${detail.text} ${detail.raw}`;
      if (!dropTemp && PARAM_REJECT.test(complaint) && !TOOL_REJECT.test(complaint)) {
        dropTemp = true;
        noTemperature.add(ref);
        opts.onStep?.('model «temperature» ni qabul qilmadi — bepul yuboraman');
        continue;
      }
      if (tools && !dropTools && TOOL_REJECT.test(complaint)) {
        dropTools = true;
        noTools.add(ref);
        opts.onStep?.('model vositalarni qoʻllab-quvvatlamaydi — vositasiz davom etaman');
        continue;
      }
      // «Provider returned error» — sababi aytilmagan. Avval eng ehtimolli
      // ikkitasini sinab koʻramiz, keyingina taslim boʻlamiz.
      if (!dropTemp && r.status >= 400 && r.status < 500) {
        dropTemp = true;
        noTemperature.add(ref);
        opts.onStep?.('soʻrovni soddalashtirib qayta yuboraman');
        continue;
      }

      if (!RETRYABLE.has(r.status) || attempt === 5) throw err;
      lastError = err;
      opts.onRetry?.(attempt + 1, Math.round(Math.min(30000, 2000 * 2 ** attempt) / 1000));
      await wait(Math.min(30000, 2000 * 2 ** attempt), opts.signal);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      if (err instanceof GeminiError && !RETRYABLE.has(err.status)) throw err;
      lastError = err;
      if (attempt === 5) throw err;
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
  let inTokens = 0;
  let outTokens = 0;
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
    // Sarf maʼlumoti odatda eng oxirgi, `choices` boʻsh boʻlakda keladi.
    if (parsed?.usage) {
      inTokens = Number(parsed.usage.prompt_tokens ?? parsed.usage.input_tokens ?? 0) || 0;
      outTokens = Number(parsed.usage.completion_tokens ?? parsed.usage.output_tokens ?? 0) || 0;
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

  // Sarfni yozib qoʻyamiz — xarajat hisoblagichi shundan oʻqiydi.
  if (inTokens || outTokens) recordUsage(ref, inTokens, outTokens, opts.usageKind ?? 'chat');

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

const LIST_CACHE_KEY = 'daho.provmodels.v2';
const LIST_TTL = 12 * 60 * 60 * 1000;

/**
 * Provayderdan olingan model va uning imkoniyatlari.
 *
 * `vision` juda muhim: rasmni koʻrmaydigan modelga skrinshot yuborilsa
 * OpenRouter «No endpoints found that support image input» deb xato beradi
 * va agentning ishi uziladi. Shuning uchun imkoniyatni oldindan bilamiz.
 */
export interface ProviderModel {
  id: string;
  /** Rasmni kirish sifatida qabul qiladimi */
  vision: boolean;
  /** Vositalarni (function calling) qoʻllab-quvvatlaydimi */
  tools: boolean;
  /** Rasm chiqara oladimi */
  draws: boolean;
  /** Kontekst oynasi (token) — bilingan boʻlsa */
  context?: number;
  /** 1 mln kirish tokeni narxi (USD). 0 — bepul, undefined — nomaʼlum */
  inPrice?: number;
  /** 1 mln chiqish tokeni narxi (USD) */
  outPrice?: number;
}

interface ListCache {
  [providerId: string]: { at: number; models: ProviderModel[] };
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

const VISION_NAME = /vision|-vl|gpt-4o|gpt-4\.1|gpt-5|o[34]\b|claude|gemini|kimi|llava|pixtral|qwen.*vl/i;
const DRAW_NAME = /image|imagen|flux|dall-e|sdxl|stable-diffusion/i;

/** API javobidagi bitta modelni imkoniyatlari bilan oʻqiydi. */
function readProviderModel(m: any): ProviderModel | null {
  const id = String(m?.id ?? m?.name ?? '');
  if (!id) return null;

  // OpenRouter aniq aytadi; boshqalar aytmasa nomidan taxmin qilamiz.
  const modalities: string[] = m?.architecture?.input_modalities ?? [];
  const outputs: string[] = m?.architecture?.output_modalities ?? [];
  const params: string[] = m?.supported_parameters ?? [];

  const known = modalities.length > 0 || params.length > 0;

  // OpenRouter narxni bitta token uchun satr koʻrinishida beradi
  // ("0.0000006"). Biz 1 mln token uchun dollarga oʻgiramiz — shu
  // koʻrinishda odam oʻqiy oladi va taqqoslay oladi.
  const perMillion = (value: unknown): number | undefined => {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return n * 1_000_000;
  };

  return {
    id,
    vision: known ? modalities.includes('image') : VISION_NAME.test(id),
    tools: known ? params.includes('tools') : true,
    draws: outputs.length ? outputs.includes('image') : DRAW_NAME.test(id),
    context: typeof m?.context_length === 'number' ? m.context_length : undefined,
    inPrice: perMillion(m?.pricing?.prompt),
    outPrice: perMillion(m?.pricing?.completion),
  };
}

/**
 * ModelInfo bepulmi. Bayroqqa emas, maʼlumotning oʻziga qaraydi —
 * shunda model qaysi yoʻldan kelganidan qatʼi nazar toʻgʻri aniqlanadi
 * (roʻyxatdan, qoʻlda kiritilgandan yoki tavsiyadan).
 */
export function modelIsFree(m: {
  id: string;
  label?: string;
  free?: boolean;
  inPrice?: number;
  outPrice?: number;
}): boolean {
  if (m.free) return true;
  return isFreeModel({ id: m.label ?? m.id, inPrice: m.inPrice, outPrice: m.outPrice });
}

/** Model bepulmi — narxi nol yoki nomida «:free» boʻlsa. */
export function isFreeModel(m: { id: string; inPrice?: number; outPrice?: number }): boolean {
  if (/:free\b|-free\b/i.test(m.id)) return true;
  return m.inPrice === 0 && m.outPrice === 0;
}

/** Narxni odam oʻqiydigan koʻrinishda: "$0.15 / 1M" yoki "bepul". */
export function priceLabel(m: { id: string; inPrice?: number; outPrice?: number }): string {
  if (isFreeModel(m)) return 'bepul';
  if (m.inPrice === undefined && m.outPrice === undefined) return '';
  const fmt = (v?: number) => (v === undefined ? '?' : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);
  return `${fmt(m.inPrice)} / ${fmt(m.outPrice)} · 1M`;
}

/** Nomidan taxmin qilingan model (roʻyxat olinmaganda). */
function guessProviderModel(id: string): ProviderModel {
  return {
    id,
    vision: VISION_NAME.test(id),
    tools: true,
    draws: DRAW_NAME.test(id),
  };
}

/** Provayderdan model roʻyxatini oladi (keshlanadi). */
export async function listProviderModels(
  cfg: ProviderConfig,
  force = false,
): Promise<ProviderModel[]> {
  const cache = readListCache();
  const hit = cache[cfg.id];
  if (!force && hit && Date.now() - hit.at < LIST_TTL) return hit.models;

  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey.trim()}` },
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const models = ((data?.data ?? data?.models ?? []) as any[])
      .map(readProviderModel)
      .filter((m): m is ProviderModel => Boolean(m));
    if (models.length) {
      cache[cfg.id] = { at: Date.now(), models };
      writeListCache(cache);
      return models;
    }
  } catch {
    /* roʻyxat olinmadi — qoʻlda kiritilgan yoki tavsiya qilingan modellar qoladi */
  }

  if (hit?.models.length) return hit.models;
  return (presetById(cfg.id)?.suggested ?? []).map(guessProviderModel);
}

/** Keshdan (soʻrovsiz) — UI darhol koʻrsatishi uchun. */
export function cachedProviderModels(providerId: string): ProviderModel[] {
  return readListCache()[providerId]?.models ?? [];
}

/** Bitta modelning imkoniyatlari. */
export function modelCaps(ref: string): ProviderModel | null {
  const { provider, model } = parseRef(ref);
  // Gemini modellari rasmni ham vositalarni ham biladi.
  if (!provider) return { id: model, vision: true, tools: true, draws: DRAW_NAME.test(model) };
  const found = cachedProviderModels(provider).find((m) => m.id === model);
  return found ?? guessProviderModel(model);
}

/** Bu modelga rasm yuborsa boʻladimi? */
export function supportsVision(ref: string): boolean {
  return modelCaps(ref)?.vision ?? false;
}

/** Bu model vositalarni chaqira oladimi? */
export function supportsTools(ref: string): boolean {
  if (knownToolless(ref)) return false;
  return modelCaps(ref)?.tools ?? true;
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

function providerModelInfo(cfg: ProviderConfig, m: ProviderModel): ModelInfo {
  return {
    id: makeRef(cfg.id, m.id),
    label: m.id,
    // Rasm chiqaradigan model «image» roliga tushadi, qolgani nomidan aniqlanadi.
    role: m.draws ? 'image' : guessRole(m.id),
    score: guessScore(m.id),
    preview: /preview|exp|beta/.test(m.id.toLowerCase()),
    description: cfg.label,
    provider: cfg.id,
    providerLabel: cfg.label,
    vision: m.vision,
    tools: m.tools,
    context: m.context,
    inPrice: m.inPrice,
    outPrice: m.outPrice,
    free: isFreeModel(m),
  };
}

/**
 * Foydalanuvchi eng koʻp ishlatadigan model «oilalari».
 *
 * OpenRouter’da 300+ model bor, lekin amalda kerak boʻladigani sanoqli:
 * yangi Qwen, Kimi, Claude, GPT va Gemini. Shu oilalar roʻyxat boshida
 * turadi va chegara tufayli tushib qolmaydi. Qolganlari roʻyxatda
 * koʻrinmaydi, lekin QIDIRUVDA topiladi.
 */
const PRIORITY: Array<{ test: RegExp; rank: number }> = [
  // Qwen — 3.6 dan yuqorisi va max
  { test: /qwen.*(3\.[6-9]|3\.\d\d|[4-9]\.|max)/i, rank: 100 },
  { test: /qwen.*(3-coder|3\.5|coder)/i, rank: 80 },
  // Kimi — K2.7 / K3 va kod nusxalari
  { test: /kimi.*(k3|2\.[7-9]|k2\.[7-9]|[3-9]\.)/i, rank: 100 },
  { test: /kimi/i, rank: 78 },
  // Claude, GPT, Gemini
  { test: /claude.*(opus|sonnet)/i, rank: 95 },
  { test: /claude/i, rank: 82 },
  { test: /\bgpt-[5-9]/i, rank: 92 },
  { test: /\bgpt-4/i, rank: 80 },
  { test: /\bo[34]\b/i, rank: 85 },
  { test: /gemini.*(3|2\.5-pro)/i, rank: 90 },
  { test: /gemini/i, rank: 78 },
  // Rasm modellari — muqova uchun kerak
  { test: /image|flux/i, rank: 70 },
];

/** 0 — oddiy model; katta son — foydalanuvchiga kerakli oila. */
export function priorityRank(id: string): number {
  for (const { test, rank } of PRIORITY) if (test.test(id)) return rank;
  return 0;
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
    const list = await listProviderModels(cfg, force).catch((): ProviderModel[] => []);
    extra.push(...trimProvider(cfg, list));
  }

  return dedupe([...gemini, ...extra]);
}

/**
 * Provayder modellarini saralab, cheklab qaytaradi.
 * Qoʻlda kiritilganlar HAR DOIM qoladi — foydalanuvchi aynan oʻshani tanlagan.
 */
function trimProvider(cfg: ProviderConfig, list: ProviderModel[]): ModelInfo[] {
  const manual = (cfg.manual ?? []).map((id) =>
    providerModelInfo(cfg, list.find((m) => m.id === id) ?? guessProviderModel(id)),
  );
  const pool = list
    .filter((m) => !(cfg.manual ?? []).includes(m.id))
    .map((m) => providerModelInfo(cfg, m))
    .filter((m) => m.role !== 'embed')
    // Avval kerakli oilalar, keyin kuch bahosi boʻyicha.
    .sort(
      (a, b) => priorityRank(b.label) - priorityRank(a.label) || b.score - a.score,
    );

  // Kerakli oilalar chegaradan qatʼi nazar qoladi.
  const wanted = pool.filter((m) => priorityRank(m.label) > 0);
  const rest = pool.filter((m) => priorityRank(m.label) === 0);
  const chat = [
    ...wanted.filter((m) => m.role === 'chat'),
    ...rest.filter((m) => m.role === 'chat').slice(0, PER_PROVIDER_LIMIT),
  ];
  const other = [
    ...wanted.filter((m) => m.role !== 'chat'),
    ...rest.filter((m) => m.role !== 'chat').slice(0, 12),
  ];
  return [...manual, ...chat, ...other];
}

/** Soʻrovsiz — keshdagi hamma model. */
export function allCachedModels(): ModelInfo[] {
  const extra: ModelInfo[] = [];
  for (const cfg of activeProviders()) {
    const cached = cachedProviderModels(cfg.id);
    const list = cached.length
      ? cached
      : (presetById(cfg.id)?.suggested ?? []).map(guessProviderModel);
    extra.push(...trimProvider(cfg, list));
  }
  return dedupe([...cachedModels(), ...extra]);
}

function dedupe(list: ModelInfo[]): ModelInfo[] {
  const seen = new Map<string, ModelInfo>();
  for (const m of list) if (!seen.has(m.id)) seen.set(m.id, m);
  return [...seen.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * BARCHA keshdagi modellar boʻyicha qidiradi — chegara qoʻllanmaydi.
 *
 * Roʻyxatda faqat kerakli oilalar koʻrinadi, lekin foydalanuvchi biror
 * modelni izlasa (masalan «llama» yoki «mixtral») u shu yerdan topiladi.
 */
export function searchModels(query: string): ModelInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: ModelInfo[] = [];

  for (const m of cachedModels()) {
    if (m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)) out.push(m);
  }
  for (const cfg of activeProviders()) {
    for (const pm of cachedProviderModels(cfg.id)) {
      if (pm.id.toLowerCase().includes(q)) out.push(providerModelInfo(cfg, pm));
    }
  }
  return dedupe(out).slice(0, 200);
}

/** Foydalanuvchi oʻchirmagan modellar — tanlash roʻyxatlari uchun. */
export function visibleModels(list: ModelInfo[]): ModelInfo[] {
  const hidden = new Set(getState().settings.hiddenModels ?? []);
  return list.filter((m) => !hidden.has(m.id));
}

/**
 * Chat uchun ishlatsa boʻladigan modellar.
 *
 * «Faqat bepul» rejimi yoqilgan boʻlsa — faqat bepullari qoladi. Bu Avto
 * tanlovga ham, zaxira modelga ham taʼsir qiladi, yaʼni tasodifan pulli
 * model ishlatilib qolmaydi. Bepul model umuman topilmasa cheklovni
 * qoʻllamaymiz — aks holda ilova umuman javob bera olmay qoladi.
 */
export function usableChatModels(): ModelInfo[] {
  const all = visibleModels(allCachedModels()).filter((m) => m.role === 'chat');
  if (!getState().settings.freeOnly) return all;
  const free = all.filter(modelIsFree);
  return free.length ? free : all;
}

/** Model nomining koʻrinadigan yorligʻi. */
export function modelLabel(ref: string): string {
  if (!ref) return 'asosiy model';
  const found = allCachedModels().find((m) => m.id === ref);
  if (found) return found.providerLabel ? `${found.label} · ${found.providerLabel}` : found.label;
  const { provider, model } = parseRef(ref);
  return provider ? `${model} · ${provider}` : model;
}

/* ------------------------------------------------------------------ */
/*  AVTO rejim — vazifaga qarab modelni oʻzi tanlaydi                  */
/* ------------------------------------------------------------------ */

/** Qanday ish bajarilyapti — shunga qarab model tanlanadi. */
export type JobKind =
  | 'reja' // rejalashtirish, boshqarish, savol berish
  | 'kod' // kod yozish va tuzatish
  | 'dizayn' // koʻrinish, CSS, joylashuv
  | 'tekshir' // xato qidirish
  | 'matn' // kitob, hujjat, tarjima
  | 'koʻrish' // rasmni koʻrish kerak
  | 'tez'; // mayda ish: sarlavha, xulosa

/** Rol → sozlamadagi maydon. */
const JOB_SLOT: Partial<Record<JobKind, keyof RoleModels>> = {
  reja: 'bosh',
  kod: 'kod',
  dizayn: 'dizayn',
  tekshir: 'tekshir',
  matn: 'matn',
};

/** Ish turi uchun modelni qanchalik yoqtirishimiz. */
function jobScore(m: ModelInfo, job: JobKind): number {
  const id = m.label.toLowerCase();
  let score = priorityRank(m.label) + m.score / 10;

  /**
   * Yengil model («flash», «lite», «mini») — faqat mayda ish uchun.
   * Rejalashtirish, kod va tekshirishda ular bitta qadamdan keyin toʻxtab
   * qoladi va sifatsiz kod yozadi, shuning uchun jiddiy ishlarda pastga
   * tushiramiz. Aks holda «gemini-3.7-flash» kabi nom «gemini-3» boʻlgani
   * uchun yuqori baho olib, bosh agent boʻlib qolardi.
   */
  const light = /flash|lite|mini|nano|haiku|small|turbo|8b|4b|\b[0-3]b\b/.test(id);
  if (light && job !== 'tez') score -= 55;

  if (job === 'reja') {
    // Bosh agent — eng kuchli boʻlishi kerak: u rejalashtiradi, boʻlib
    // beradi va oxirigacha olib boradi.
    if (/opus|max|sonnet|thinking|reasoner|\bpro\b|gpt-[5-9]|k2|k3/.test(id)) score += 50;
  }

  if (job === 'kod') {
    if (/coder|code/.test(id)) score += 60;
    if (/qwen|deepseek|claude|gpt-[5-9]|kimi/.test(id)) score += 25;
  }
  if (job === 'dizayn' || job === 'koʻrish') {
    // Dizayn uchun rasmni koʻrish shart.
    if (!m.vision) return -1;
    if (/claude|gpt-[45-9]|gemini/.test(id)) score += 40;
  }
  if (job === 'tekshir') {
    if (/thinking|reasoner|\bo[34]\b|opus|max|pro/.test(id)) score += 45;
  }
  if (job === 'matn') {
    if (/claude|kimi|gemini|gpt/.test(id)) score += 35;
    if (/coder/.test(id)) score -= 30;
  }
  if (job === 'tez') {
    if (/mini|flash|lite|haiku|small|turbo/.test(id)) score += 50;
    if (/opus|max|thinking|reasoner/.test(id)) score -= 40;
  }
  // Vositalar kerak boʻladigan ishlarda vositasiz model yaramaydi.
  if (job !== 'koʻrish' && job !== 'matn' && m.tools === false) score -= 200;
  return score;
}

/**
 * Ish turiga eng mos modelni qaytaradi.
 *
 * Tartib: 1) foydalanuvchi rolga model biriktirgan boʻlsa — oʻsha;
 * 2) avto rejim yoqilgan boʻlsa — ruxsat berilgan modellar ichidan eng mosi;
 * 3) aks holda asosiy model.
 */
/**
 * Loyiha uchun model.
 *
 * AVTO yoqilgan boʻlsa — u USTUN: foydalanuvchi «avtoni yoqsam oʻzi eng
 * yaxshi modelni tanlasin» deydi, shuning uchun loyihaga qadab qoʻyilgan
 * eski model Avtoni bloklamasligi kerak. Qoʻlda tanlash uchun Sozlamalarda
 * Avtoni oʻchirish kifoya.
 */
export function pickForProject(job: JobKind, pinned?: string): string {
  const { settings } = getState();
  // Loyihaga ATAYLAB tanlangan model — eng ustun. Foydalanuvchi model
  // tanlagan boʻlsa, u aynan oʻshani kutadi.
  if (pinned) return pinned;
  if (settings.autoPickModel !== false) return pickForJob(job);
  return settings.model;
}

export function pickForJob(job: JobKind, fallback?: string): string {
  const { settings } = getState();
  const base = fallback || settings.model;

  // 1. Foydalanuvchi aniq belgilagan rol modeli — har doim ustun.
  const slot = JOB_SLOT[job];
  const assigned = slot ? settings.roleModels?.[slot] : '';
  if (assigned) return assigned;

  if (!settings.autoPickModel) {
    // Avto oʻchiq: faqat «koʻrish» uchun majburan koʻradigan modelga oʻtamiz.
    if (job === 'koʻrish' && !supportsVision(base)) return visionCapableRef() ?? base;
    return base;
  }

  // 2. Avto: ruxsat berilgan hovuzdan tanlaymiz.
  const allowed = new Set(settings.autoPool ?? []);
  const pool = usableChatModels().filter((m) => !allowed.size || allowed.has(m.id));
  const ranked = pool
    .map((m) => ({ m, score: jobScore(m, job) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.m.id ?? base;
}
