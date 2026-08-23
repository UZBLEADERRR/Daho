/*
 * Token budjeti va prioritet.
 *
 * Asosiy qoida: Daho hech qachon butun tarixni modelga yubormaydi.
 * Uning oʻrniga har soʻrovda «shu savolga javob berish uchun nimani
 * bilishim kerak?» degan savolga javob yigʻiladi va u BELGILANGAN
 * chegaraga sigʻdiriladi.
 *
 * Chegaradan oshsa nimani tashlashni bilish kerak. Tartib ataylab
 * qatʼiy: joriy savol va yaqin xabarlar hech qachon kesilmaydi,
 * avval eng kam foyda beradigan qism ketadi.
 */

/** Kontekst boʻlagi. */
export interface Piece {
  id: string;
  /** Modelga ketadigan matn */
  text: string;
  /**
   * Muhimlik. Katta raqam — avval tashlanadi.
   *   0 — joriy savol va yaqin xabarlar (hech qachon kesilmaydi)
   *   1 — joriy vazifa/mavzu holati
   *   2 — mos xotiralar
   *   3 — suhbat xulosasi
   *   4 — qolgani
   */
  priority: number;
  /** Boʻlakni qisqartirish mumkin boʻlsa — eng kam qoldiriladigan hajm */
  minChars?: number;
}

/**
 * Tokenni belgilar soni orqali taxmin qilamiz.
 *
 * Haqiqiy tokenizator brauzerda ogʻir (bir necha megabayt jadval) va
 * har provayder uchun boshqacha. Bizga aniq raqam emas, TOʻGʻRI NISBAT
 * kerak: budjetni ushlab turish uchun shu yetadi. Oʻzbekcha va
 * kirill matn lotinchadan zichroq, shuning uchun 3.6 olingan.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const kirill = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  const bolgich = kirill > text.length / 4 ? 2.8 : 3.6;
  return Math.ceil(text.length / bolgich);
}

export interface BudgetPlan {
  /** Chegaraga sigʻgan boʻlaklar (tartibi saqlangan) */
  pieces: Piece[];
  usedTokens: number;
  /** Nima tashlangani — kuzatish va nosozlikni topish uchun */
  dropped: string[];
  /** Nima qisqartirilgani */
  trimmed: string[];
}

/**
 * Boʻlaklarni budjetga sigʻdiradi.
 *
 * Avval sigʻmaganini QISQARTIRADI (`minChars` boʻlsa), keyingina
 * butunlay tashlaydi — chunki yarim xotira yoʻq xotiradan yaxshi.
 */
export function fitBudget(pieces: Piece[], maxTokens: number): BudgetPlan {
  const kept = [...pieces];
  const dropped: string[] = [];
  const trimmed: string[] = [];

  const total = () => kept.reduce((n, p) => n + estimateTokens(p.text), 0);

  /*
   * Ikki bosqich.
   *
   * Avval QISQARTIRAMIZ: yarim xotira yoʻq xotiradan yaxshi. Shundan
   * keyin ham sigʻmasa — eng kam muhimini butunlay tashlaymiz.
   * Tartib har ikkalasida ham bir xil: katta `priority` avval ketadi.
   */
  const pastdan = () => [...kept].filter((p) => p.priority > 0).sort((a, b) => b.priority - a.priority);

  for (const piece of pastdan()) {
    if (total() <= maxTokens) break;
    if (!piece.minChars || piece.text.length <= piece.minChars) continue;
    const ortiqcha = total() - maxTokens;
    const kerak = Math.max(piece.minChars, piece.text.length - ortiqcha * 4);
    if (kerak < piece.text.length) {
      piece.text = `${piece.text.slice(0, kerak).trimEnd()}\n…`;
      trimmed.push(piece.id);
    }
  }

  for (const piece of pastdan()) {
    if (total() <= maxTokens) break;
    const at = kept.indexOf(piece);
    if (at >= 0) {
      kept.splice(at, 1);
      dropped.push(piece.id);
    }
  }

  return { pieces: kept, usedTokens: total(), dropped, trimmed };
}

/**
 * Ish turiga qarab budjet.
 *
 * Hamma ishga 32 000 token berish — pul isrofi. Oddiy savolga kichik
 * budjet yetadi, murakkab tuzatishga koʻproq kerak.
 */
export type Ogirlik = 'oddiy' | 'normal' | 'murakkab' | 'arxitektura';

const BUDJET: Record<Ogirlik, number> = {
  oddiy: 3000,
  normal: 8000,
  murakkab: 16000,
  arxitektura: 32000,
};

export function budgetFor(ogirlik: Ogirlik): number {
  return BUDJET[ogirlik];
}

/** Soʻrov ogʻirligini matndan taxmin qiladi. */
export function weighRequest(text: string, hasFiles = false): Ogirlik {
  const uzunlik = text.length;
  if (
    /arxitektura|architecture|refactor|qayta qur|butun loyiha|migratsiya|migrate|tizimni qayta/i.test(
      text,
    )
  ) {
    return 'arxitektura';
  }
  if (
    /debug|xato|bug|ishlamayapti|tuzat|nega ishlamaydi|test|optimallash|performance/i.test(text)
    || uzunlik > 1200
    || hasFiles
  ) {
    return 'murakkab';
  }
  if (uzunlik < 120 && !/\n/.test(text)) return 'oddiy';
  return 'normal';
}
