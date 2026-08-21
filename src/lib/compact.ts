/*
 * Kontekstni siqish — uzun ishlarda tokenni tejaydi.
 *
 * Muammo: agent sikli har qadamda model javobi va vosita natijasini
 * `contents` ga qoʻshib boradi, hech narsa olib tashlanmaydi. 60 qadamlik
 * ishda 2000 qatorli fayl bir marta oʻqilsa, oʻsha 2000 qator qolgan 55
 * qadamning HAR BIRIDA qayta yuboriladi. Narx keskin oshadi va model
 * diqqati susayadi.
 *
 * Yechim: eski vosita natijalari qisqartiriladi — nima qilinganini
 * bildiruvchi bir qator qoladi. Yaqin qadamlar toʻliq turadi, chunki
 * model aynan ular ustida ishlayapti. Fayl kerak boʻlsa qayta oʻqiydi:
 * bitta qoʻshimcha chaqiruv 55 marta takrorlashdan arzon.
 */

import type { GeminiContent, GeminiPart } from './gemini';

/** Oxirgi shuncha qadam toʻliq holida qoladi. */
const KEEP_VERBATIM = 6;

/** Shundan uzun natija siqiladi (belgi). */
const BIG_RESULT = 1200;

/** Siqishdan keyin qoldiriladigan boshlanish (belgi). */
const KEEP_HEAD = 200;

/**
 * Siqishga arzimaydigan vositalar — ularning natijasi qisqa va
 * keyingi qadamlar uchun muhim.
 */
const NEVER_COMPACT = new Set(['ask_user', 'todo', 'plan_check', 'plan_write']);

function partSize(part: GeminiPart): number {
  const p = part as Record<string, unknown>;
  if (typeof p.text === 'string') return p.text.length;
  if (p.inlineData) return String((p.inlineData as { data?: string }).data ?? '').length;
  if (p.functionResponse) {
    try {
      return JSON.stringify((p.functionResponse as { response?: unknown }).response ?? {}).length;
    } catch {
      return 0;
    }
  }
  if (p.functionCall) {
    try {
      return JSON.stringify(p.functionCall).length;
    } catch {
      return 0;
    }
  }
  return 0;
}

/** Kontekstning taxminiy hajmi (belgi). Token emas, lekin nisbat toʻgʻri. */
export function contextSize(contents: GeminiContent[]): number {
  let total = 0;
  for (const c of contents) for (const p of c.parts ?? []) total += partSize(p);
  return total;
}

/** Katta javobni qisqa xulosaga aylantiradi. */
function shrink(name: string, response: unknown): Record<string, unknown> {
  let text: string;
  try {
    text = JSON.stringify(response);
  } catch {
    text = String(response);
  }
  if (text.length <= BIG_RESULT) return response as Record<string, unknown>;

  return {
    _siqilgan: true,
    _izoh:
      `«${name}» natijasi qisqartirildi (${text.length} belgi edi). ` +
      'Aynan kerak boʻlsa vositani qayta chaqir.',
    boshlanishi: text.slice(0, KEEP_HEAD),
  };
}

/**
 * Eski vosita natijalarini siqadi.
 *
 * Faqat `functionResponse` larga tegiladi — model javoblari va fikrlash
 * imzolari aynan qoladi, aks holda Gemini zanjiri buziladi.
 */
export function compactContents(contents: GeminiContent[]): {
  contents: GeminiContent[];
  saved: number;
} {
  if (contents.length <= KEEP_VERBATIM * 2) return { contents, saved: 0 };

  const before = contextSize(contents);
  // Oxirgi qadamlarga tegmaymiz — model aynan ular ustida ishlayapti.
  const cut = Math.max(0, contents.length - KEEP_VERBATIM * 2);

  const out = contents.map((entry, i) => {
    if (i >= cut) return entry;

    let changed = false;
    const parts = (entry.parts ?? []).map((part) => {
      const p = part as Record<string, unknown>;

      // Katta rasm — eski qadamda kerak emas, oʻrniga izoh qoldiramiz.
      if (p.inlineData) {
        changed = true;
        return { text: '[eski skrinshot olib tashlandi]' };
      }

      const fr = p.functionResponse as { name?: string; response?: unknown } | undefined;
      if (!fr || NEVER_COMPACT.has(fr.name ?? '')) return part;

      const shrunk = shrink(fr.name ?? 'vosita', fr.response);
      if (shrunk === fr.response) return part;
      changed = true;
      return { functionResponse: { name: fr.name ?? 'vosita', response: shrunk } };
    });

    return changed ? { ...entry, parts: parts as GeminiPart[] } : entry;
  });

  return { contents: out, saved: before - contextSize(out) };
}

/* ------------------------------------------------------------------ */
/*  Takrorlanishni aniqlash                                            */
/* ------------------------------------------------------------------ */

export interface LoopGuard {
  /** Chaqiruvni qayd qiladi; takroriy xato boʻlsa ogohlantirish qaytaradi. */
  note(name: string, args: unknown, ok: boolean): string | null;
}

/**
 * Bir xil vosita bir xil argument bilan qayta-qayta xato bersa — agent
 * tiqilib qolgan. Uni bundan xabardor qilamiz, aks holda qolgan
 * qadamlarni shunga sarflaydi.
 */
export function createLoopGuard(limit = 3): LoopGuard {
  const fails = new Map<string, number>();

  return {
    note(name, args, ok) {
      let key: string;
      try {
        key = `${name}:${JSON.stringify(args)}`;
      } catch {
        key = name;
      }

      if (ok) {
        fails.delete(key);
        return null;
      }

      const count = (fails.get(key) ?? 0) + 1;
      fails.set(key, count);
      if (count < limit) return null;

      fails.set(key, 0);
      return (
        `«${name}» ayni shu argumentlar bilan ${count} marta xato berdi. ` +
        'Yana takrorlama — boshqa yoʻl tanla: faylni qayta oʻqib holatini ' +
        'tekshir, boshqa vosita ishlat yoki foydalanuvchidan soʻra.'
      );
    },
  };
}
