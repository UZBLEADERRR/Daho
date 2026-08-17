/**
 * Hujjatdagi rasmlarni topib beradi.
 *
 * Markdown ichida rasm ikki xil koʻrinishda boʻladi:
 *   `![izoh](daho:a_123)`  — ilovadagi artifact (muqova, bob rasmi)
 *   `![izoh](data:image/png;base64,…)` — toʻgʻridan-toʻgʻri maʼlumot
 *
 * Word, PDF va slayd yasovchilar shu bitta joydan foydalanadi, shuning
 * uchun rasm uch formatda ham bir xil chiqadi.
 */

import { getState } from './store';

export interface DocImageData {
  /** base64, prefikssiz */
  data: string;
  mimeType: string;
  width: number;
  height: number;
}

/** `daho:` yoki `data:` manzilini base64 rasmga aylantiradi. */
export function resolveImageSrc(src: string): { data: string; mimeType: string } | null {
  if (src.startsWith('daho:')) {
    const id = src.slice(5);
    const artifact = getState().artifacts.find((a) => a.id === id);
    if (!artifact || artifact.kind !== 'image') return null;
    return { data: artifact.content, mimeType: artifact.mimeType ?? 'image/png' };
  }
  const inline = src.match(/^data:([^;]+);base64,(.+)$/);
  if (inline) return { mimeType: inline[1], data: inline[2] };
  return null;
}

/** Rasmni brauzerga yuklaydi — oʻlchamini bilish va chizish uchun. */
export function loadImage(data: string, mimeType: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Rasm yuklanmadi'));
    img.src = `data:${mimeType};base64,${data}`;
  });
}

/**
 * Rasmni JPEG ga oʻgiradi va oʻlchamini qaytaradi.
 *
 * PPTX va DOCX ichida PNG ham ishlaydi, lekin katta rasmlar faylni
 * shishiradi; JPEG esa hamma joyda ochiladi va yengil.
 */
export async function toJpeg(
  data: string,
  mimeType: string,
  maxWidth = 1400,
): Promise<DocImageData | null> {
  try {
    const img = await loadImage(data, mimeType);
    const scale = Math.min(1, maxWidth / (img.naturalWidth || maxWidth));
    const width = Math.max(1, Math.round((img.naturalWidth || maxWidth) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || maxWidth) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // Shaffof PNG qora chiqmasligi uchun oq fon.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const url = canvas.toDataURL('image/jpeg', 0.85);
    return {
      data: url.slice(url.indexOf(',') + 1),
      mimeType: 'image/jpeg',
      width,
      height,
    };
  } catch {
    return null;
  }
}

/** Hujjatdagi barcha rasmlarni oldindan tayyorlab qoʻyadi. */
export async function prepareImages(srcs: string[]): Promise<Map<string, DocImageData>> {
  const out = new Map<string, DocImageData>();
  for (const src of new Set(srcs)) {
    const raw = resolveImageSrc(src);
    if (!raw) continue;
    const jpeg = await toJpeg(raw.data, raw.mimeType);
    if (jpeg) out.set(src, jpeg);
  }
  return out;
}
