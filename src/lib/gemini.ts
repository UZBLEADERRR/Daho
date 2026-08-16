import type { Attachment } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
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
      return `Model topilmadi. Sozlamalarda model nomini tekshiring. (${detail})`;
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

  let res: Response;
  try {
    res = await fetch(
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

  await assertOk(res);
  if (!res.body) throw new GeminiError('Javob oqimi boʻsh keldi.', 0);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const functionCalls: StreamResult['functionCalls'] = [];

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
      if (typeof part.text === 'string' && part.text) {
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

  return { text, functionCalls };
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

  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
    signal,
  });
  await assertOk(res);

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

/** Ovozli yozuvni matnga o'giradi (qurilmada STT bo'lmasa, zaxira yo'l). */
export async function transcribeAudio(
  apiKey: string,
  model: string,
  audio: Attachment,
  signal?: AbortSignal,
): Promise<string> {
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
              text: 'Ushbu audiodagi nutqni aynan matnga oʻgir. Faqat matnni qaytar, izohsiz.',
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
