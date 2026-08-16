import type { Artifact, ArtifactKind } from './types';
import { uid } from './utils';

export type Segment =
  | { type: 'text'; value: string }
  | { type: 'code'; lang: string; value: string; closed: boolean };

const FENCE = /```([\w+-]*)[^\n]*\n?/g;

/**
 * Xabar matnini oddiy matn va kod bloklariga ajratadi.
 * Yopilmagan blok ham qaytariladi (stream davomida jonli koʻrsatish uchun).
 */
export function splitSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  FENCE.lastIndex = 0;

  while (cursor < text.length) {
    FENCE.lastIndex = cursor;
    const open = FENCE.exec(text);
    if (!open) break;

    if (open.index > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, open.index) });
    }

    const bodyStart = open.index + open[0].length;
    const closeIdx = text.indexOf('```', bodyStart);
    if (closeIdx === -1) {
      segments.push({
        type: 'code',
        lang: (open[1] || '').toLowerCase(),
        value: text.slice(bodyStart),
        closed: false,
      });
      return segments;
    }

    segments.push({
      type: 'code',
      lang: (open[1] || '').toLowerCase(),
      value: text.slice(bodyStart, closeIdx).replace(/\n$/, ''),
      closed: true,
    });
    cursor = closeIdx + 3;
    if (text[cursor] === '\n') cursor += 1;
  }

  if (cursor < text.length) {
    segments.push({ type: 'text', value: text.slice(cursor) });
  }
  return segments;
}

const PREVIEWABLE = new Set(['html', 'svg']);

export function kindForLang(lang: string): ArtifactKind {
  if (PREVIEWABLE.has(lang)) return 'html';
  if (lang === 'md' || lang === 'markdown') return 'markdown';
  return 'code';
}

export function isPreviewable(artifact: Artifact): boolean {
  return artifact.kind === 'html' || artifact.kind === 'image';
}

/** Kod blokidan sarlavha taxmin qiladi. */
export function guessTitle(lang: string, code: string): string {
  const titleTag = code.match(/<title>([^<]{2,60})<\/title>/i);
  if (titleTag) return titleTag[1].trim();

  const h1 = code.match(/<h1[^>]*>([^<]{2,60})<\/h1>/i);
  if (h1) return h1[1].trim();

  const comment = code.match(/^\s*(?:\/\/|#|<!--)\s*(.{3,60}?)\s*(?:-->)?$/m);
  if (comment) return comment[1].trim();

  const fn = code.match(/(?:function|class|def|const)\s+([A-Za-z_][\w]*)/);
  if (fn) return fn[1];

  const label: Record<string, string> = {
    html: 'Veb ilova',
    svg: 'SVG rasm',
    css: 'Uslublar',
    js: 'JavaScript',
    javascript: 'JavaScript',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    python: 'Python skript',
    py: 'Python skript',
    sql: 'SQL soʻrov',
    json: 'JSON maʼlumot',
  };
  return label[lang] ?? (lang ? lang.toUpperCase() : 'Kod');
}

/** Yakunlangan javob matnidan artifactlar yasaydi. */
export function extractArtifacts(text: string, chatId: string): Artifact[] {
  const out: Artifact[] = [];
  for (const seg of splitSegments(text)) {
    if (seg.type !== 'code' || !seg.closed) continue;
    if (seg.lang === 'chart') continue; // grafik — alohida chiziladi
    // Bir qatorli qisqa parchalarni artifact qilmaymiz — ular oddiy misol.
    if (seg.value.trim().split('\n').length < 3) continue;
    out.push({
      id: uid('a_'),
      kind: kindForLang(seg.lang),
      title: guessTitle(seg.lang, seg.value),
      content: seg.value,
      lang: seg.lang || 'text',
      chatId,
      createdAt: Date.now(),
    });
  }
  return out;
}

/** HTML artifactni iframe ichida ishlatish uchun tayyorlaydi. */
export function toPreviewDocument(artifact: Artifact): string {
  const body = artifact.content;
  if (artifact.lang === 'svg') {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100%}</style></head><body>${body}</body></html>`;
  }
  if (/<html[\s>]/i.test(body)) return body;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}</style></head><body>${body}</body></html>`;
}

export function fileExtension(artifact: Artifact): string {
  if (artifact.kind === 'image') return artifact.mimeType?.includes('jpeg') ? 'jpg' : 'png';
  const map: Record<string, string> = {
    javascript: 'js',
    typescript: 'ts',
    python: 'py',
    markdown: 'md',
  };
  const lang = artifact.lang ?? 'txt';
  return map[lang] ?? lang;
}
