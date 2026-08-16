import type { Attachment } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
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
    case 429:
      return 'Limit tugadi — biroz kutib qayta urining (bepul reja daqiqalik cheklovga ega).';
    case 500:
    case 503:
      return 'Google serveri band. Bir necha soniyadan soʻng qayta urining.';
    default:
      return detail || `Xato (HTTP ${status})`;
  }
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
  attempts = 4,
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
      // 1.5s, 3s, 6s + tasodifiy qoʻshimcha
      await wait(1500 * 2 ** i + Math.random() * 400, signal);
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
}

export interface StreamResult {
  text: string;
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
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
  if (!opts.apiKey) throw new GeminiError('API kalit kiritilmagan. Sozlamalarga oʻting.', 0);

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
      response = await fetch(
        `${BASE}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': opts.apiKey,
          },
          body: JSON.stringify(body),
          signal: opts.signal,
        },
      );
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      throw new GeminiError(
        'Internetga ulanib boʻlmadi. Aloqani tekshiring va qayta urining.',
        0,
      );
    }
    await assertOk(response);
    return response;
  }, opts.signal);

  if (!res.body) throw new GeminiError('Javob oqimi boʻsh keldi.', 0);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const functionCalls: StreamResult['functionCalls'] = [];
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

  return { text, functionCalls, parts: modelParts };
}

/** Streamsiz oddiy chaqiruv — sarlavha yasash, tarjima kabi kichik ishlar uchun. */
export async function generateText(
  apiKey: string,
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4 },
    }),
    signal,
  });
  await assertOk(res);
  const data = await res.json();
  const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? '').join('').trim();
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
  if (!apiKey) throw new GeminiError('API kalit kiritilmagan. Sozlamalarga oʻting.', 0);
  const parts: GeminiPart[] = [
    ...refs.map((r) => ({ inlineData: { mimeType: r.mimeType, data: r.data } })),
    { text: prompt },
  ];

  const res = await withRetry(async () => {
    const r = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }),
      signal,
    });
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
  if (!apiKey) throw new GeminiError('API kalit kiritilmagan. Sozlamalarga oʻting.', 0);

  const res = await withRetry(async () => {
    const r = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.85,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }),
      signal,
    });
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

export interface RemoteModel {
  name: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

/** Hisobga ochiq boʻlgan barcha modellar roʻyxati. */
export async function listModels(apiKey: string): Promise<RemoteModel[]> {
  if (!apiKey) throw new GeminiError('API kalit kiritilmagan. Sozlamalarga oʻting.', 0);
  const out: RemoteModel[] = [];
  let pageToken = '';

  for (let page = 0; page < 5; page += 1) {
    const url = new URL(`${BASE}/models`);
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: { 'x-goog-api-key': apiKey } });
    } catch {
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
  if (!apiKey) throw new GeminiError('API kalit kiritilmagan. Sozlamalarga oʻting.', 0);

  const prompt = styleHint ? `${styleHint}\n\n${text}` : text;
  const res = await withRetry(async () => {
    const r = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
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
    });
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

  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
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
  });
  await assertOk(res);
  const data = await res.json();
  const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? '').join('').trim();
}
