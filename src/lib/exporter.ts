import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { fileExtension } from './artifacts';
import { buildDocx } from './docx';
import { IMAGE_MARK } from './docmodel';
import { buildDocxWithImages, imageSize, type DocImage, type DocPart } from './office';
import { buildPdf, loadPdfImages } from './pdf';
import { buildPptx } from './pptx';
import { bytesToB64 } from './audio';
import type { Artifact } from './types';

function safeName(title: string): string {
  return (
    title
      .replace(/[^\p{L}\p{N}\s._-]/gu, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 48) || 'daho'
  );
}

function mimeFor(artifact: Artifact): string {
  if (artifact.kind === 'image') return artifact.mimeType ?? 'image/png';
  if (artifact.kind === 'audio') return artifact.mimeType ?? 'audio/wav';
  if (artifact.lang === 'srt') return 'application/x-subrip';
  if (artifact.lang === 'html') return 'text/html';
  if (artifact.lang === 'json') return 'application/json';
  return 'text/plain';
}

function webDownload(filename: string, content: string, mime: string, isBase64: boolean) {
  const href = isBase64
    ? `data:${mime};base64,${content}`
    : URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (!isBase64) setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/**
 * Artifactni faylga saqlaydi va ulashish oynasini ochadi.
 * Muvaffaqiyat holatida foydalanuvchiga koʻrsatiladigan matnni qaytaradi.
 */
export async function saveArtifact(artifact: Artifact): Promise<string> {
  const filename = `${safeName(artifact.title)}.${fileExtension(artifact)}`;
  const mime = mimeFor(artifact);
  const isBase64 = artifact.kind === 'image' || artifact.kind === 'audio';

  if (!Capacitor.isNativePlatform()) {
    webDownload(filename, artifact.content, mime, isBase64);
    return `${filename} yuklab olindi`;
  }

  const written = await Filesystem.writeFile({
    path: filename,
    data: artifact.content,
    directory: Directory.Cache,
    ...(isBase64 ? {} : { encoding: Encoding.UTF8 }),
  });

  const canShare = await Share.canShare().catch(() => ({ value: false }));
  if (canShare.value) {
    await Share.share({
      title: artifact.title,
      url: written.uri,
      dialogTitle: 'Faylni saqlash yoki ulashish',
    });
    return 'Ulashish oynasi ochildi';
  }
  return `Saqlandi: ${filename}`;
}

/** Matnni buferga nusxalaydi. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Zaxira nusxani JSON fayl sifatida beradi. */
export async function saveBackup(json: string): Promise<string> {
  const filename = `daho-zaxira-${new Date().toISOString().slice(0, 10)}.json`;
  if (!Capacitor.isNativePlatform()) {
    webDownload(filename, json, 'application/json', false);
    return `${filename} yuklab olindi`;
  }
  const written = await Filesystem.writeFile({
    path: filename,
    data: json,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({ title: 'Daho zaxira nusxasi', url: written.uri }).catch(() => undefined);
  return 'Zaxira nusxa tayyor';
}

/* ------------------------------------------------------------------ */
/*  Hujjat eksporti                                                    */
/* ------------------------------------------------------------------ */

export type DocFormat = 'docx' | 'pdf' | 'pptx' | 'md';

const DOC_MIME: Record<DocFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  md: 'text/markdown',
};

export const DOC_LABEL: Record<DocFormat, string> = {
  docx: 'Word (.docx)',
  pptx: 'Slayd (.pptx)',
  pdf: 'PDF',
  md: 'Matn (.md)',
};

/** Ixtiyoriy baytlarni faylga saqlaydi va ulashish oynasini ochadi. */
export async function saveBytes(
  filename: string,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    const href = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    return `${filename} yuklab olindi`;
  }

  const written = await Filesystem.writeFile({
    path: filename,
    data: bytesToB64(bytes),
    directory: Directory.Cache,
  });
  const canShare = await Share.canShare().catch(() => ({ value: false }));
  if (canShare.value) {
    await Share.share({ title: filename, url: written.uri, dialogTitle: 'Faylni saqlash' });
    return 'Ulashish oynasi ochildi';
  }
  return `Saqlandi: ${filename}`;
}

/** Markdown matnni Word / PDF / slayd qilib chiqaradi. */
/** Hujjatga qoʻyiladigan rasmlar: `daho-img:ID` belgisi → rasm. */
export type ExportImages = Record<string, { data: string; mimeType: string; caption?: string }>;

/** Matnni rasm belgilari boʻyicha boʻlaklarga ajratadi (Word uchun). */
function splitForDocx(
  markdown: string,
  sources: ExportImages,
): { parts: DocPart[]; images: DocImage[] } {
  const parts: DocPart[] = [];
  const images: DocImage[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (!buffer.length) return;
    parts.push({ text: buffer.join('\n') });
    buffer = [];
  };

  for (const line of markdown.split('\n')) {
    const mark = line.trim().match(IMAGE_MARK);
    const source = mark ? sources[mark[2]] : undefined;
    if (mark && source) {
      flush();
      images.push({
        data: source.data,
        mimeType: source.mimeType,
        caption: mark[1] || source.caption,
      });
      parts.push({ image: images.length - 1 });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return { parts, images };
}

/** Rasm belgilarini oddiy matnga aylantiradi (rasm qoʻllab-quvvatlanmagan format). */
function stripImageMarks(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !IMAGE_MARK.test(line.trim()))
    .join('\n');
}

/**
 * Markdown matnni Word / PDF / slayd / matn qilib chiqaradi.
 * `images` berilsa `![izoh](daho-img:ID)` belgilari oʻrniga rasm qoʻyiladi.
 */
export async function exportDocument(
  markdown: string,
  format: DocFormat,
  title: string,
  images?: ExportImages,
): Promise<string> {
  const name = `${safeName(title)}.${format}`;
  const hasImages = Boolean(images && Object.keys(images).length);

  if (format === 'md') {
    // .md fayl oʻzi yetarli boʻlishi uchun rasmni ichiga joylaymiz.
    const text = hasImages
      ? markdown.replace(
          new RegExp(IMAGE_MARK.source, 'gm'),
          (line, caption: string, id: string) => {
            const source = images?.[id];
            return source ? `![${caption}](data:${source.mimeType};base64,${source.data})` : line;
          },
        )
      : markdown;
    return saveBytes(name, new TextEncoder().encode(text), DOC_MIME.md);
  }

  if (format === 'docx') {
    if (!hasImages) return saveBytes(name, buildDocx(markdown), DOC_MIME.docx);
    const { parts, images: docImages } = splitForDocx(markdown, images ?? {});
    // Nisbatni saqlash uchun oʻlchamlarni aniqlaymiz.
    await Promise.all(
      docImages.map(async (image) => {
        const size = await imageSize(image.data, image.mimeType);
        image.width = size.width;
        image.height = size.height;
      }),
    );
    return saveBytes(name, buildDocxWithImages(parts, docImages), DOC_MIME.docx);
  }

  if (format === 'pptx') {
    return saveBytes(name, buildPptx(stripImageMarks(markdown)), DOC_MIME.pptx);
  }

  const loaded = hasImages ? await loadPdfImages(images ?? {}) : {};
  return saveBytes(name, buildPdf(markdown, undefined, loaded), DOC_MIME.pdf);
}
