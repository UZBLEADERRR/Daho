/*
 * Kod indeksi — Daho Code ning xotirasi.
 *
 * Muammo: agent har qadamda «qaysi fayl kerak?» degan savolga javob
 * topishi kerak, lekin butun loyihani modelga yuborib boʻlmaydi.
 * 100 000 qatorli loyiha bir necha yuz ming token — bu ham qimmat,
 * ham foydasiz (model kerakli joyni topolmay qoladi).
 *
 * Yechim: loyiha SIMVOLLARGA ajratiladi (funksiya, klass, interfeys,
 * komponent) va har biri qaysi qatorlarda turgani yozib qoʻyiladi.
 * Model «refreshToken()» haqida soʻrasa, unga 1000 qatorli `auth.ts`
 * emas, 420–487 qatorlar beriladi.
 *
 * Qidiruv uch bosqichli:
 *   1. aniq moslik  — nom boʻyicha
 *   2. bogʻliqlik   — import grafi orqali qoʻshni fayllar
 *   3. leksik       — mazmun boʻyicha yaqinlik
 *
 * Indeks fayl HASHI boʻyicha yangilanadi: oʻzgarmagan fayl qayta
 * tahlil qilinmaydi.
 */

import type { CodeFile, CodeProject } from '../types';
import { rank, tokenize } from './retrieve';

export type SymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'component'
  | 'const'
  | 'style'
  | 'block';

export interface CodeSymbol {
  file: string;
  name: string;
  kind: SymbolKind;
  /** 1 dan boshlanadigan qator raqamlari */
  start: number;
  end: number;
  /** Eʼlon qatori — modelga koʻrsatiladigan qisqa imzo */
  signature: string;
  exported: boolean;
}

export interface FileEntry {
  path: string;
  hash: string;
  lines: number;
  symbols: CodeSymbol[];
  /** Shu fayl import qiladigan loyiha fayllari */
  imports: string[];
}

export interface CodeIndex {
  files: Map<string, FileEntry>;
  /** Teskari bogʻliqlik: fayl → uni import qiladiganlar */
  usedBy: Map<string, string[]>;
}

/* ------------------------------------------------------------------ */
/*  Hash                                                               */
/* ------------------------------------------------------------------ */

/**
 * Yengil hash (FNV-1a).
 *
 * Kriptografiya uchun emas — «fayl oʻzgardimi?» degan savolga javob
 * uchun. SHA-256 brauzerda asinxron va bu yerda ortiqcha.
 */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/* ------------------------------------------------------------------ */
/*  Simvollarni ajratish                                               */
/* ------------------------------------------------------------------ */

interface Rule {
  re: RegExp;
  kind: SymbolKind;
  /** Nom qaysi guruhda */
  group?: number;
}

/*
 * Toʻliq AST oʻrniga qoidalar.
 *
 * Haqiqiy parser (TypeScript compiler, tree-sitter) brauzerda bir
 * necha megabayt va telefonda sekin. Bizga har bir tugun emas,
 * «bu qayerda eʼlon qilingan» degan savolga javob kerak — buning
 * uchun qoidalar yetadi va ular oʻnlab tilga oson kengayadi.
 */
const RULES: Record<string, Rule[]> = {
  ts: [
    { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: 'function' },
    { re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
    { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
    { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, kind: 'type' },
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?\(/, kind: 'function' },
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Z][\w$]*)\s*[:=]/, kind: 'component' },
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/, kind: 'const' },
    { re: /^\s{2,}(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/, kind: 'method' },
  ],
  py: [
    { re: /^\s*def\s+([A-Za-z_][\w]*)/, kind: 'function' },
    { re: /^\s*class\s+([A-Za-z_][\w]*)/, kind: 'class' },
  ],
  go: [
    { re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/, kind: 'function' },
    { re: /^\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)/, kind: 'type' },
  ],
  java: [
    { re: /^\s*(?:public|private|protected).*\bclass\s+([A-Za-z_][\w]*)/, kind: 'class' },
    { re: /^\s{2,}(?:public|private|protected).*\s([A-Za-z_][\w]*)\s*\([^)]*\)\s*\{/, kind: 'method' },
  ],
  rust: [
    { re: /^\s*(?:pub\s+)?fn\s+([A-Za-z_][\w]*)/, kind: 'function' },
    { re: /^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/, kind: 'class' },
  ],
  css: [{ re: /^([.#][\w-]+[^{]*)\{/, kind: 'style' }],
  sql: [
    { re: /^\s*create\s+(?:or\s+replace\s+)?(?:table|view|function|index)\s+(?:if\s+not\s+exists\s+)?([\w.]+)/i, kind: 'block' },
  ],
  md: [{ re: /^(#{1,3})\s+(.+)$/, kind: 'block', group: 2 }],
};

function rulesFor(path: string): Rule[] {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return RULES.ts;
  if (ext === 'py') return RULES.py;
  if (ext === 'go') return RULES.go;
  if (['java', 'kt'].includes(ext)) return RULES.java;
  if (ext === 'rs') return RULES.rust;
  if (['css', 'scss', 'less'].includes(ext)) return RULES.css;
  if (ext === 'sql') return RULES.sql;
  if (['md', 'markdown'].includes(ext)) return RULES.md;
  return [];
}

/** Import qatorlaridan loyihadagi fayl yoʻllarini ajratadi. */
function importsOf(content: string, from: string, known: Set<string>): string[] {
  const out = new Set<string>();
  const re = /(?:from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)|import\s+['"]([^'"]+)['"])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    if (!raw.startsWith('.')) continue; // tashqi paket — indeksga kirmaydi

    // Nisbiy yoʻlni loyiha yoʻliga aylantiramiz.
    const base = from.split('/').slice(0, -1);
    for (const part of raw.split('/')) {
      if (part === '.') continue;
      else if (part === '..') base.pop();
      else base.push(part);
    }
    const guess = base.join('/');
    for (const cand of [guess, `${guess}.ts`, `${guess}.tsx`, `${guess}.js`, `${guess}/index.ts`, `${guess}/index.js`]) {
      if (known.has(cand)) {
        out.add(cand);
        break;
      }
    }
  }
  return [...out];
}

/** Bitta faylni tahlil qiladi. */
function indexFile(file: CodeFile, known: Set<string>): FileEntry {
  const lines = file.content.split('\n');
  const rules = rulesFor(file.path);
  const symbols: CodeSymbol[] = [];

  lines.forEach((line, i) => {
    if (line.length > 400) return;
    for (const rule of rules) {
      const m = rule.re.exec(line);
      if (!m) continue;
      const name = (m[rule.group ?? 1] ?? '').trim();
      if (!name || name.length > 60) continue;
      symbols.push({
        file: file.path,
        name,
        kind: rule.kind,
        start: i + 1,
        end: i + 1,
        signature: line.trim().slice(0, 140),
        exported: /^\s*(?:export|pub\s|public\s)/.test(line),
      });
      break;
    }
  });

  /*
   * Simvolning oxiri — keyingi simvol boshlanishidan bir qator oldin.
   *
   * Qavslarni sanash aniqroq, lekin qatorlar chegarasi ham yetarli:
   * maqsad «shu funksiyani oʻqish uchun qaysi qatorlarni olay?»
   * degan savolga javob berish.
   */
  symbols.forEach((sym, i) => {
    const next = symbols[i + 1];
    sym.end = next ? Math.max(sym.start, next.start - 1) : lines.length;
  });

  return {
    path: file.path,
    hash: hashOf(file.content),
    lines: lines.length,
    symbols,
    imports: importsOf(file.content, file.path, known),
  };
}

/* ------------------------------------------------------------------ */
/*  Indeks                                                             */
/* ------------------------------------------------------------------ */

/** Loyiha boʻyicha indekslar — jarayon xotirasida. */
const cache = new Map<string, CodeIndex>();

/**
 * Indeksni yangilaydi.
 *
 * Faqat HASHI oʻzgargan fayl qayta tahlil qilinadi — 200 fayllik
 * loyihada bitta fayl tahrirlansa, qolgan 199 tasiga tegilmaydi.
 */
export function buildIndex(project: CodeProject): CodeIndex {
  const oldIndex = cache.get(project.id);
  const files = new Map<string, FileEntry>();
  const known = new Set(project.files.map((f) => f.path));

  for (const file of project.files) {
    if (file.base64) continue; // rasm, shrift — indekslanmaydi
    const hash = hashOf(file.content);
    const eski = oldIndex?.files.get(file.path);
    files.set(file.path, eski && eski.hash === hash ? eski : indexFile(file, known));
  }

  const usedBy = new Map<string, string[]>();
  for (const entry of files.values()) {
    for (const dep of entry.imports) {
      usedBy.set(dep, [...(usedBy.get(dep) ?? []), entry.path]);
    }
  }

  const index: CodeIndex = { files, usedBy };
  cache.set(project.id, index);
  return index;
}

export function forgetIndex(projectId: string): void {
  cache.delete(projectId);
}

/* ------------------------------------------------------------------ */
/*  Qidiruv                                                            */
/* ------------------------------------------------------------------ */

export interface Hit {
  symbol: CodeSymbol;
  score: number;
  /** Qanday topilgani — foydalanuvchiga va nosozlik izlashga */
  via: 'aniq' | 'bogʻliqlik' | 'mazmun';
}

/**
 * Soʻrovga mos joylarni topadi — uch bosqichda.
 *
 * Butun loyihani modelga yubormaslikning asosiy vositasi shu.
 */
export function findRelevant(project: CodeProject, query: string, top = 12): Hit[] {
  const index = buildIndex(project);
  const words = tokenize(query);
  const hits = new Map<string, Hit>();
  const key = (s: CodeSymbol) => `${s.file}:${s.start}:${s.name}`;

  const add = (symbol: CodeSymbol, score: number, via: Hit['via']) => {
    const k = key(symbol);
    const bor = hits.get(k);
    if (!bor || bor.score < score) hits.set(k, { symbol, score, via });
  };

  const all: CodeSymbol[] = [];
  for (const entry of index.files.values()) all.push(...entry.symbols);

  /* 1-bosqich: nom boʻyicha aniq moslik. */
  const lower = query.toLowerCase();
  for (const sym of all) {
    const name = sym.name.toLowerCase();
    if (!name || name.length < 3) continue;
    if (lower.includes(name)) add(sym, 1, 'aniq');
    else if (words.some((w) => name.includes(w) || w.includes(name))) add(sym, 0.8, 'aniq');
  }

  /* 2-bosqich: topilgan fayllarning qoʻshnilari (import grafi). */
  const seedFiles = new Set([...hits.values()].map((h) => h.symbol.file));
  for (const path of seedFiles) {
    const qoshnilar = [...(index.files.get(path)?.imports ?? []), ...(index.usedBy.get(path) ?? [])];
    for (const dep of qoshnilar) {
      for (const sym of index.files.get(dep)?.symbols ?? []) {
        if (sym.exported) add(sym, 0.45, 'bogʻliqlik');
      }
    }
  }

  /* 3-bosqich: mazmun boʻyicha yaqinlik. */
  for (const found of rank(all, query, (s) => `${s.name} ${s.signature} ${s.file}`, {
    top: top * 2,
    threshold: 0.3,
  })) {
    add(found.item, found.score * 0.7, 'mazmun');
  }

  return [...hits.values()].sort((a, b) => b.score - a.score).slice(0, top);
}

/* ------------------------------------------------------------------ */
/*  Modelga koʻrsatish                                                 */
/* ------------------------------------------------------------------ */

/**
 * Loyiha xaritasi — fayl roʻyxati emas, SIMVOLLAR xaritasi.
 *
 * Fayl nomlari agentga kam narsa aytadi: `auth.ts` da nima borligini
 * bilish uchun uni oʻqish kerak edi. Xarita bu qadamni tejaydi.
 */
export function symbolMap(project: CodeProject, maxChars = 2600): string {
  const index = buildIndex(project);
  const rows: string[] = [];

  for (const entry of [...index.files.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const muhim = entry.symbols.filter((s) => s.exported || s.kind === 'class');
    const list = (muhim.length ? muhim : entry.symbols).slice(0, 8);
    if (!list.length) {
      rows.push(`- ${entry.path} (${entry.lines} qator)`);
      continue;
    }
    rows.push(
      `- ${entry.path} (${entry.lines} qator): ${list.map((s) => `${s.name}${s.kind === 'function' || s.kind === 'method' ? '()' : ''}`).join(', ')}`,
    );
  }

  let out = rows.join('\n');
  if (out.length > maxChars) {
    out = `${out.slice(0, maxChars)}\n… (yana ${rows.length} ta fayl — \`find_code\` bilan qidiring)`;
  }
  return out;
}

/** Topilgan joylarni modelga beriladigan matnga aylantiradi. */
export function hitsToText(project: CodeProject, hits: Hit[], maxChars = 6000): string {
  const byFile = new Map<string, CodeFile>();
  for (const f of project.files) byFile.set(f.path, f);

  const parts: string[] = [];
  let used = 0;

  for (const hit of hits) {
    const file = byFile.get(hit.symbol.file);
    if (!file) continue;
    const lines = file.content.split('\n');
    // Juda uzun simvolni butunlay bermaymiz — boshi koʻpincha yetadi.
    const end = Math.min(hit.symbol.end, hit.symbol.start + 80);
    const body = lines.slice(hit.symbol.start - 1, end).join('\n');
    const block = `### ${hit.symbol.file}:${hit.symbol.start}-${end} — ${hit.symbol.name} (${hit.symbol.kind}, ${hit.via})\n\`\`\`\n${body}\n\`\`\``;
    if (used + block.length > maxChars) break;
    parts.push(block);
    used += block.length;
  }

  return parts.join('\n\n');
}
