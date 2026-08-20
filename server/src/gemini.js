import { env } from './env.js';

const BASE = process.env.GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta';

export const DEFAULT_MODEL = {
  chat: 'gemini-flash-latest',
  search: 'gemini-flash-latest',
  json: 'gemini-flash-latest',
  plan: 'gemini-flash-latest',
  kitob: 'gemini-flash-latest',
  image: 'gemini-2.5-flash-image',
};

export async function callGemini(model, body, signal) {
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.geminiKey },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Google xatosi (${res.status})`);
  return data;
}

export function textOf(data) {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

export function usageOf(data) {
  const u = data?.usageMetadata ?? {};
  return {
    input: Number(u.promptTokenCount ?? 0),
    output: Number(u.candidatesTokenCount ?? 0) + Number(u.thoughtsTokenCount ?? 0),
  };
}

export function sourcesOf(data) {
  const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  return chunks
    .map((c) => ({ title: c.web?.title ?? '', url: c.web?.uri ?? '' }))
    .filter((s) => s.url)
    .slice(0, 6);
}
