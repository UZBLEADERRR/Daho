import { AiRouteError, aiAvailable, aiFetch } from './route';
import type { Attachment } from './types';

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  /** Tashqi fayl — masalan YouTube havolasi (modelning oʻzi koʻradi) */
  fileData?: { fileUri: string; mimeType?: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  /**
   * Gemini 3 «fikrlash imzosi». Model qaytargan qismni tarixga aynan shu
   * imzo bilan qaytarish SHART — aks holda API 400 xato beradi.
   */
  thoughtSignature?: string;
  thought?: boolean;
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

function humanError(status: number, body: string): string {
  let detail = body;
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message ?? body;
  } catch {
    /* xom matn qoladi */
  }
  switch (status) {
    case 400:
      return `Soʻrov notoʻgʻri: ${detail}`;
    case 401:
    case 403:
      return `API kalit qabul qilinmadi. Sozlamalardan kalitni tekshiring. (${detail})`;
    case 404:
      return `Bu model endi mavjud emas. Sozlamalar → «Modellarni yangilash» tugmasini bosing. (${detail})`;
    case 402:
      return detail || 'Obuna limiti tugadi. Hisobingizni toʻldiring yoki oʻz API kalitingizni kiriting.';
    case 429:
      return 'Limit tugadi — biroz kutib qayta urining (bepul reja daqiqalik cheklovga ega).';
    case 500:
    case 503:
      return 'Google serveri band. Bir necha soniyadan soʻng qayta urining.';
    default:
      return detail || `Xato (HTTP ${status})`;
  }
}

/** Kalit ham, obuna ham yo'q bo'lsa — tushunarli xato. */
function ensureAccess(apiKey: string): void {
  if (aiAvailable(apiKey)) return;
  throw new GeminiError(
    'API kalit kiritilmagan. Sozlamalarga oʻting yoki Daho Cloud obunasiga kiring.',
    0,
  );
}

/** Yo'naltirish xatosini umumiy xato turiga keltiradi. */
function asGeminiError(err: unknown): never {
  if (err instanceof AiRouteError) throw new GeminiError(err.message, err.status);
  throw err;
}

async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  throw new GeminiError(humanError(res.status, body), res.status);
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

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

/**
 * Google serveri band boʻlsa yoki limitga urilsa — oʻzi kutib qayta uradi.
 * Foydalanuvchi qoʻlda qayta yuborishi shart emas.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
  attempts = 6,
  onWait?: (attempt: number, seconds: number) => void,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      const status = err instanceof GeminiError ? err.status : 0;
      const retryable = RETRYABLE.has(status) || status === 0;
      if (!retryable || i === attempts - 1) throw err;
      lastError = err;
      // 2s, 4s, 8s, 16s, 30s — server bandligi odatda shu ichida oʻtadi.
      const ms = Math.min(30000, 2000 * 2 ** i) + Math.random() * 500;
      onWait?.(i + 1, Math.round(ms / 1000));
      await wait(ms, signal);
    }
  }
  throw lastError;
}

export interface StreamOptions {
  apiKey: string;
  model: string;
  contents: GeminiContent[];
  systemInstruction?: string;
  tools?: FunctionDeclaration[];
  temperature?: number;
  signal?: AbortSignal;
  onText: (chunk: string) => void;
  /** Server band boʻlib qayta urinilayotganda chaqiriladi */
  onRetry?: (attempt: number, seconds: number) => void;
}

export interface StreamResult {
  text: string;
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
  /** Model javobida qaytargan rasmlar */
  images: Attachment[];
  /**
   * Model qaytargan xom qismlar — suhbat tarixiga oʻzgartirmasdan
   * qaytarish uchun (fikrlash imzolari saqlanadi).
   */
  parts: GeminiPart[];
}

/**
 * Bitta stream chaqiruvi. Matnni bo'lak-bo'lak `onText` orqali uzatadi,
 * yakunda to'liq matn va model so'ragan funksiya chaqiruvlarini qaytaradi.
 */
export async function streamGenerate(opts: StreamOptions): Promise<StreamResult> {
  ensureAccess(opts.apiKey);

  const body: Record<string, unknown> = {
    contents: opts.contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.8,
    },
    safetySettings: [
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
    ].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
  };
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }
  if (opts.tools?.length) {
    body.tools = [{ functionDeclarations: opts.tools }];
  }

  // Soʻrovni boshlash qayta urinishlar bilan — 503/429 shu bosqichda tutiladi.
  const res = await withRetry(async () => {
    let response: Response;
    try {
      response = await aiFetch(
        opts.apiKey,
        `/models/${encodeURIComponent(opts.model)}:streamGenerateContent`,
        { body: JSON.stringify(body), signal: opts.signal, query: { alt: 'sse' } },
      );
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      if (err instanceof AiRouteError) asGeminiError(err);
      throw new GeminiError(
        'Internetga ulanib boʻlmadi. Aloqani tekshiring va qayta urining.',
        0,
      );
    }
    await assertOk(response);
    return response;
  }, opts.signal, 6, opts.onRetry);

  if (!res.body) throw new GeminiError('Javob oqimi boʻsh keldi.', 0);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const functionCalls: StreamResult['functionCalls'] = [];
  const images: Attachment[] = [];
  const modelParts: GeminiPart[] = [];

  /** Qismni saqlaydi; ketma-ket oddiy matnlarni bittaga qoʻshadi. */
  const keepPart = (part: GeminiPart) => {
    const last = modelParts[modelParts.length - 1];
    const plainText =
      typeof part.text === 'string' && !part.thoughtSignature && !part.thought;
    const lastPlain =
      last && typeof last.text === 'string' && !last.thoughtSignature && !last.thought;
    if (plainText && lastPlain) last.text = (last.text ?? '') + (part.text ?? '');
    else modelParts.push({ ...part });
  };

  const handlePayload = (raw: string) => {
    if (!raw || raw === '[DONE]') return;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (parsed?.error) {
      throw new GeminiError(parsed.error.message ?? 'Nomaʼlum xato', parsed.error.code ?? 0);
    }
    const parts: GeminiPart[] = parsed?.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      keepPart(part);
      if (typeof part.text === 'string' && part.text && !part.thought) {
        text += part.text;
        opts.onText(part.text);
      }
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('image/')) {
        images.push({ mimeType: part.inlineData.mimeType, data: part.inlineData.data });
      }
      if (part.functionCall?.name) {
        functionCalls.push({
          name: part.functionCall.name,
          args: (part.functionCall.args ?? {}) as Record<string, unknown>,
        });
      }
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
      if (line.startsWith('data:')) handlePayload(line.slice(5).trim());
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith('data:')) handlePayload(tail.slice(5).trim());

  return { text, functionCalls, images, parts: modelParts };
}

/** Streamsiz oddiy chaqiruv — sarlavha yasash, tarjima kabi kichik ishlar uchun. */
export async function generateText(
  apiKey: string,
  model: string,
  prompt: string,
  files: Attachment[] = [],
  signal?: AbortSignal,
): Promise<string> {
  const parts: GeminiPart[] = [
    ...files.map((f) => ({ inlineData: { mimeType: f.mimeType, data: f.data } })),
    { text: prompt },
  ];
  const res = await aiFetch(apiKey, `/models/${encodeURIComponent(model)}:generateContent`, {
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.4 },
    }),
    signal,
  }).catch(asGeminiError);
  await assertOk(res);
  const data = await res.json();
  const out: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
  return out.map((p) => p.text ?? '').join('').trim();
}

export interface ImageResult {
  images: Attachment[];
  text: string;
}

/** Rasm yaratish/tahrirlash. `refs` berilsa, model mavjud rasmni tahrirlaydi. */
export async function generateImage(
  apiKey: string,
  model: string,
  prompt: string,
  refs: Attachment[] = [],
  signal?: AbortSignal,
): Promise<ImageResult> {
  ensureAccess(apiKey);
  const parts: GeminiPart[] = [
    ...refs.map((r) => ({ inlineData: { mimeType: r.mimeType, data: r.data } })),
    { text: prompt },
  ];

  const res = await withRetry(async () => {
    const r = await aiFetch(apiKey, `/models/${encodeURIComponent(model)}:generateContent`, {
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }),
      signal,
    }).catch(asGeminiError);
    await assertOk(r);
    return r;
  }, signal);

  const data = await res.json();
  const outParts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
  const images: Attachment[] = [];
  let text = '';
  for (const part of outParts) {
    if (part.inlineData?.data) {
      images.push({ mimeType: part.inlineData.mimeType || 'image/png', data: part.inlineData.data });
    } else if (part.text) {
      text += part.text;
    }
  }
  if (!images.length) {
    throw new GeminiError(
      text.trim() ||
        'Model rasm qaytarmadi. Sozlamalarda rasm modeli nomini tekshiring yoki soʻrovni oʻzgartiring.',
      0,
    );
  }
  return { images, text: text.trim() };
}

/** Modeldan qatʼiy JSON javob oladi (sxema boʻyicha). */
export async function generateJson<T>(
  apiKey: string,
  model: string,
  prompt: string,
  schema: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  ensureAccess(apiKey);

  const res = await withRetry(async () => {
    const r = await aiFetch(apiKey, `/models/${encodeURIComponent(model)}:generateContent`, {
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.85,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }),
      signal,
    }).catch(asGeminiError);
    await assertOk(r);
    return r;
  }, signal);

  const data = await res.json();
  const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
  const raw = parts.map((p) => p.text ?? '').join('').trim();
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Baʼzan model JSON ni kod bloki ichida qaytaradi.
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1]) as T;
    throw new GeminiError('Model tushunarsiz javob qaytardi. Qaytadan urining.', 0);
  }
}

/**
 * Video (masalan YouTube havolasi) boʻyicha soʻrov.
 *
 * Gemini YouTube havolasini toʻgʻridan-toʻgʻri oʻqiy oladi: videoni yuklab
 * olish yoki subtitr faylini qidirish shart emas. Shu bilan tarjima,
 * qisqacha mazmun va vaqt belgilari bitta soʻrovda olinadi.
 */
export async function generateFromVideo<T>(
  apiKey: string,
  model: string,
  videoUrl: string,
  prompt: string,
  schema?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  ensureAccess(apiKey);

  const generationConfig: Record<string, unknown> = { temperature: 0.3 };
  if (schema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = schema;
  }

  const res = await withRetry(async () => {
    const r = await aiFetch(apiKey, `/models/${encodeURIComponent(model)}:generateContent`, {
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ fileData: { fileUri: videoUrl } }, { text: prompt }],
          },
        ],
        generationConfig,
      }),
      signal,
    }).catch(asGeminiError);
    await assertOk(r);
    return r;
  }, signal, 4);

  const data = await res.json();
  const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
  const raw = parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim();

  if (!schema) return raw as unknown as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1]) as T;
    throw new GeminiError('Video boʻyicha javob tushunarsiz keldi.', 0);
  }
}

export interface GroundedAnswer {
  text: string;
  /** Javob olingan manbalar */
  sources: Array<{ title: string; url: string }>;
}

/**
 * Google qidiruviga tayangan javob — jonli maʼlumot uchun (transport,
 * jadval, narx, yangilik). Model qidiradi va topganini yozadi.
 */
export async function searchAnswer(
  apiKey: string,
  model: string,
  question: string,
  signal?: AbortSignal,
): Promise<GroundedAnswer> {
  ensureAccess(apiKey);

  const ask = (tool: Record<string, unknown>) =>
    aiFetch(apiKey, `/models/${encodeURIComponent(model)}:generateContent`, {
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: question }] }],
        tools: [tool],
      }),
      signal,
    }).catch(asGeminiError);

  const res = await withRetry(async () => {
    const r = await ask({ google_search: {} });
    // Eski modellar boshqa nom kutadi.
    if (r.status === 400) {
      const retry = await ask({ google_search_retrieval: {} });
      await assertOk(retry);
      return retry;
    }
    await assertOk(r);
    return r;
  }, signal);

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const parts: GeminiPart[] = candidate?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('').trim();

  const chunks = (candidate?.groundingMetadata?.groundingChunks ?? []) as Array<{
    web?: { uri?: string; title?: string };
  }>;
  const sources = chunks
    .map((c) => ({ title: c.web?.title ?? '', url: c.web?.uri ?? '' }))
    .filter((c) => c.url)
    .slice(0, 6);

  if (!text) throw new GeminiError('Qidiruvdan javob kelmadi.', 0);
  return { text, sources };
}

export interface RemoteModel {
  name: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

/** Hisobga ochiq boʻlgan barcha modellar roʻyxati. */
export async function listModels(apiKey: string): Promise<RemoteModel[]> {
  ensureAccess(apiKey);
  const out: RemoteModel[] = [];
  let pageToken = '';

  for (let page = 0; page < 5; page += 1) {
    const query: Record<string, string> = { pageSize: '200' };
    if (pageToken) query.pageToken = pageToken;

    let res: Response;
    try {
      res = await aiFetch(apiKey, '/models', { method: 'GET', query });
    } catch (err) {
      if (err instanceof AiRouteError) asGeminiError(err);
      throw new GeminiError('Internetga ulanib boʻlmadi.', 0);
    }
    await assertOk(res);
    const data = await res.json();
    out.push(...((data?.models ?? []) as RemoteModel[]));
    pageToken = data?.nextPageToken ?? '';
    if (!pageToken) break;
  }
  return out;
}

/**
 * Gemini TTS — tabiiy ovozda oʻqish. PCM (L16) qaytaradi,
 * ijro etishdan oldin WAV ga oʻralishi kerak.
 */
export async function generateSpeech(
  apiKey: string,
  model: string,
  text: string,
  voiceName: string,
  styleHint?: string,
  signal?: AbortSignal,
): Promise<{ data: string; mimeType: string }> {
  ensureAccess(apiKey);

  const prompt = styleHint ? `${styleHint}\n\n${text}` : text;
  const res = await withRetry(async () => {
    const r = await aiFetch(apiKey, `/models/${encodeURIComponent(model)}:generateContent`, {
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
        },
      }),
      signal,
    }).catch(asGeminiError);
    await assertOk(r);
    return r;
  }, signal);

  const data = await res.json();
  const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
  const audio = parts.find((p) => p.inlineData?.data);
  if (!audio?.inlineData) {
    throw new GeminiError('Model ovoz qaytarmadi. Sozlamalarda TTS modelini tekshiring.', 0);
  }
  return { data: audio.inlineData.data, mimeType: audio.inlineData.mimeType || 'audio/L16;rate=24000' };
}

/** Ovozli yozuvni matnga o'giradi (qurilmada STT bo'lmasa, zaxira yo'l). */
export async function transcribeAudio(
  apiKey: string,
  model: string,
  audio: Attachment,
  signal?: AbortSignal,
  lang = 'uz-UZ',
): Promise<string> {
  const langName =
    { 'uz-UZ': 'oʻzbek', 'ru-RU': 'rus', 'en-US': 'ingliz', 'tr-TR': 'turk' }[lang] ?? 'oʻzbek';

  const res = await withRetry(async () => {
    const r = await aiFetch(apiKey, `/models/${encodeURIComponent(model)}:generateContent`, {
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: audio.mimeType, data: audio.data } },
              {
                text:
                  `Ushbu audiodagi nutq ${langName} tilida. Uni aynan matnga oʻgir. ` +
                  'Faqat matnning oʻzini qaytar — izoh, tirnoq yoki qoʻshimcha soʻzsiz. ' +
                  'Agar nutq eshitilmasa, boʻsh javob qaytar.',
              },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
      signal,
    }).catch(asGeminiError);
    await assertOk(r);
    return r;
  }, signal);

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const parts: GeminiPart[] = candidate?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim();

  if (!text) {
    const reason = candidate?.finishReason;
    if (reason && reason !== 'STOP') {
      throw new GeminiError(`Model javob bermadi (${reason}).`, 0);
    }
  }
  return text;
}
