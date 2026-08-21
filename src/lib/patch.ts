/*
 * Unified diff qoʻllash — katta faylni arzon tahrirlash uchun.
 *
 * `write_file` butun faylni qayta yozadi: 500 qatorli faylda bitta
 * qatorni oʻzgartirish 500 qator chiqish tokeni. Diff bilan bu ~10 qator
 * boʻladi. `edit_file` kichik tuzatishga yaxshi, lekin bir necha joyni
 * birdan oʻzgartirish kerak boʻlsa noqulay.
 *
 * Qoʻllab-quvvatlanadi: `@@` boshlangan boʻlaklar, ` ` (kontekst),
 * `-` (oʻchirish), `+` (qoʻshish). Qator raqamlariga ISHONMAYMIZ —
 * kontekst boʻyicha joy qidiriladi, chunki model raqamlarda tez-tez
 * adashadi.
 */

export interface Hunk {
  /** Mos kelishi kerak boʻlgan qatorlar (kontekst + oʻchiriladiganlar) */
  before: string[];
  /** Oʻrniga qoʻyiladigan qatorlar (kontekst + qoʻshiladiganlar) */
  after: string[];
  /** Diffda koʻrsatilgan taxminiy joy — qidiruvni shu yerdan boshlaymiz */
  hint: number;
}

export interface PatchResult {
  ok: boolean;
  content?: string;
  /** Nechta boʻlak qoʻllandi */
  applied: number;
  /** Qoʻllanmagan boʻlaklar haqida izoh */
  failed: string[];
}

/** Diff matnini boʻlaklarga ajratadi. */
export function parseHunks(diff: string): Hunk[] {
  const lines = diff.split('\n');
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;

  for (const line of lines) {
    // Fayl sarlavhalari — eʼtiborsiz qoldiramiz
    if (/^(---|\+\+\+|diff |index )/.test(line)) continue;

    const header = line.match(/^@@\s*-(\d+)/);
    if (header) {
      if (current) hunks.push(current);
      current = { before: [], after: [], hint: Math.max(0, Number(header[1]) - 1) };
      continue;
    }
    if (!current) continue;

    const kind = line[0];
    const text = line.slice(1);

    if (kind === '-') {
      current.before.push(text);
    } else if (kind === '+') {
      current.after.push(text);
    } else if (kind === ' ') {
      current.before.push(text);
      current.after.push(text);
    } else if (line === '') {
      // Boʻsh qator — koʻpincha bu boʻsh kontekst qatori
      current.before.push('');
      current.after.push('');
    }
    // Boshqa belgilar (masalan `\ No newline`) tashlab ketiladi
  }

  if (current) hunks.push(current);
  return hunks.filter((h) => h.before.length || h.after.length);
}

/** Qatorlar ketma-ketligi shu joyda turibdimi. */
function matchesAt(lines: string[], needle: string[], at: number): boolean {
  if (at < 0 || at + needle.length > lines.length) return false;
  for (let i = 0; i < needle.length; i += 1) {
    if (lines[at + i] !== needle[i]) return false;
  }
  return true;
}

/** Boʻsh joy farqini eʼtiborsiz qoldirib solishtiradi. */
function matchesLoose(lines: string[], needle: string[], at: number): boolean {
  if (at < 0 || at + needle.length > lines.length) return false;
  for (let i = 0; i < needle.length; i += 1) {
    if (lines[at + i].trim() !== needle[i].trim()) return false;
  }
  return true;
}

/**
 * Boʻlak joyini topadi: avval koʻrsatilgan joydan, keyin butun fayldan.
 * Qatʼiy moslik topilmasa boʻsh joy farqiga koʻz yumamiz.
 */
function findHunk(lines: string[], before: string[], hint: number): number {
  if (!before.length) return Math.min(hint, lines.length);

  if (matchesAt(lines, before, hint)) return hint;

  // Koʻrsatilgan joydan boshlab ikki tomonga qidiramiz — shunda
  // bir xil kod bir necha marta uchrasa ham eng yaqini tanlanadi.
  for (let d = 1; d <= lines.length; d += 1) {
    if (matchesAt(lines, before, hint - d)) return hint - d;
    if (matchesAt(lines, before, hint + d)) return hint + d;
  }

  for (let i = 0; i <= lines.length - before.length; i += 1) {
    if (matchesLoose(lines, before, i)) return i;
  }

  return -1;
}

/**
 * Diffni faylga qoʻllaydi.
 *
 * Boʻlaklar oxiridan boshiga qarab qoʻllanadi — shunda oldingi
 * boʻlakning qator raqamlari siljimaydi.
 */
export function applyPatch(content: string, diff: string): PatchResult {
  const hunks = parseHunks(diff);
  if (!hunks.length) {
    return { ok: false, applied: 0, failed: ['Diffda birorta ham @@ boʻlagi topilmadi.'] };
  }

  let lines = content.split('\n');
  const failed: string[] = [];
  let applied = 0;

  // Joylarni oldindan topamiz, keyin oxiridan qoʻllaymiz.
  const located = hunks.map((h) => ({ hunk: h, at: findHunk(lines, h.before, h.hint) }));

  for (let i = located.length - 1; i >= 0; i -= 1) {
    const { hunk, at } = located[i];
    if (at < 0) {
      failed.push(
        `Boʻlak topilmadi: «${(hunk.before[0] ?? '').trim().slice(0, 60)}…» — ` +
          'fayl diffdagidan boshqacha boʻlishi mumkin.',
      );
      continue;
    }
    lines = [...lines.slice(0, at), ...hunk.after, ...lines.slice(at + hunk.before.length)];
    applied += 1;
  }

  return {
    ok: applied > 0 && failed.length === 0,
    content: applied > 0 ? lines.join('\n') : undefined,
    applied,
    failed,
  };
}
