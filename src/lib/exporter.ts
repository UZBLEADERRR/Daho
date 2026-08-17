import { Capacitor } from '@capacitor/core';
import { strToU8, zipSync } from 'fflate';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { fileExtension } from './artifacts';
import { buildDocx } from './docx';
import { buildPdf } from './pdf';
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
  const isBase64 = artifact.kind === 'image';

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

/**
 * Bir nechta faylni ZIP qilib beradi — kod loyihasini butunlay olish yoki
 * agent yasagan bir toʻplam faylni bitta arxivda yuborish uchun.
 */
export async function saveZip(
  name: string,
  files: Array<{ path: string; content: string | Uint8Array }>,
): Promise<string> {
  if (!files.length) throw new Error('Arxivga soladigan fayl yoʻq');
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    // Yoʻldagi xavfli belgilarni tozalaymiz (`..` bilan chiqib ketmasin).
    const path = f.path.replace(/^[./]+/, '').replace(/\.\.+/g, '.') || 'fayl';
    entries[path] = typeof f.content === 'string' ? strToU8(f.content) : f.content;
  }
  const bytes = zipSync(entries, { level: 6 });
  return saveBytes(`${safeName(name)}.zip`, bytes, 'application/zip');
}

/** Markdown matnni Word / PDF / slayd qilib chiqaradi. */
export async function exportDocument(
  markdown: string,
  format: DocFormat,
  title: string,
): Promise<string> {
  const name = `${safeName(title)}.${format}`;
  if (format === 'md') {
    return saveBytes(name, new TextEncoder().encode(markdown), DOC_MIME.md);
  }
  const bytes =
    format === 'docx'
      ? buildDocx(markdown)
      : format === 'pptx'
        ? buildPptx(markdown)
        : buildPdf(markdown);
  return saveBytes(name, bytes, DOC_MIME[format]);
}
