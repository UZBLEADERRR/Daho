/*
 * Loyiha ichida qidirish — grep va glob.
 *
 * Agent ilgari faylni topish uchun butun roʻyxatni oʻqib chiqib, keyin
 * bittalab ochib koʻrishi kerak edi. Katta loyihada bu koʻp token yeydi
 * va koʻpincha kerakli joyni umuman topmaydi.
 */

import type { CodeFile } from './types';

export interface GrepHit {
  path: string;
  line: number;
  text: string;
  /** Atrofidagi qatorlar (soʻralganda) */
  before?: string[];
  after?: string[];
}

export interface GrepOptions {
  /** Faqat shu naqshga mos fayllar ichida qidirish */
  glob?: string;
  ignoreCase?: boolean;
  /** Har topilma atrofida nechta qator koʻrsatilsin */
  context?: number;
  /** Koʻpi bilan nechta topilma */
  limit?: number;
}

/**
 * `*`, `**` va `?` li naqshni muntazam ifodaga aylantiradi.
 *
 * Almashtirish tartibi muhim: avval maxsus belgilar qochiriladi, keyin
 * uzunroq naqshlar (`**\/`, `**`) qisqasidan (`*`) oldin ishlanadi. Shuning
 * uchun ular avval joy egallovchi belgiga aylantiriladi.
 */
export function globToRegExp(pattern: string): RegExp {
  // Naqshda uchramaydigan belgilar — vaqtincha oʻrin egallab turadi
  const DEEP_SLASH = '\u0001';
  const DEEP = '\u0002';
  const STAR = '\u0003';
  const ONE = '\u0004';

  const marked = pattern
    .replace(/\*\*\//g, DEEP_SLASH)
    .replace(/\*\*/g, DEEP)
    .replace(/\*/g, STAR)
    .replace(/\?/g, ONE);

  const escaped = marked.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  const source = escaped
    .split(DEEP_SLASH)
    .join('(?:.*/)?')
    .split(DEEP)
    .join('.*')
    .split(STAR)
    .join('[^/]*')
    .split(ONE)
    .join('[^/]');

  return new RegExp(`^${source}$`, 'i');
}

/** Naqshga mos fayllarni qaytaradi. Naqsh boʻsh boʻlsa — hammasi. */
export function globFiles(files: CodeFile[], pattern?: string): CodeFile[] {
  if (!pattern || pattern === '*' || pattern === '**') return files;
  const re = globToRegExp(pattern);
  // «*.ts» kabi naqsh chuqurroq turgan faylga ham mos kelsin
  const bare = pattern.includes('/') ? null : globToRegExp(`**/${pattern}`);
  return files.filter((f) => re.test(f.path) || (bare ? bare.test(f.path) : false));
}

/** Fayllar ichidan muntazam ifoda boʻyicha qidiradi. */
export function grepFiles(
  files: CodeFile[],
  pattern: string,
  opts: GrepOptions = {},
): { hits: GrepHit[]; scanned: number; truncated: boolean } {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 60));
  const context = Math.max(0, Math.min(6, opts.context ?? 0));

  let re: RegExp;
  try {
    re = new RegExp(pattern, opts.ignoreCase ? 'i' : '');
  } catch {
    // Notoʻgʻri ifoda boʻlsa oddiy matn sifatida qidiramiz
    const safe = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(safe, opts.ignoreCase ? 'i' : '');
  }

  const target = globFiles(files, opts.glob);
  const hits: GrepHit[] = [];
  let truncated = false;

  for (const file of target) {
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!re.test(lines[i])) continue;
      if (hits.length >= limit) {
        truncated = true;
        break;
      }
      const hit: GrepHit = { path: file.path, line: i + 1, text: lines[i].slice(0, 400) };
      if (context) {
        hit.before = lines.slice(Math.max(0, i - context), i).map((l) => l.slice(0, 200));
        hit.after = lines.slice(i + 1, i + 1 + context).map((l) => l.slice(0, 200));
      }
      hits.push(hit);
    }
    if (truncated) break;
  }

  return { hits, scanned: target.length, truncated };
}

/** Faylning bir qismini qaytaradi — katta faylni butunlay oʻqimaslik uchun. */
export function sliceLines(
  content: string,
  offset = 0,
  limit = 0,
): { text: string; from: number; to: number; total: number } {
  const lines = content.split('\n');
  const from = Math.max(0, Math.min(lines.length, offset));
  const to = limit > 0 ? Math.min(lines.length, from + limit) : lines.length;
  return {
    text: lines
      .slice(from, to)
      .map((l, i) => `${from + i + 1}\t${l}`)
      .join('\n'),
    from: from + 1,
    to,
    total: lines.length,
  };
}
