/*
 * Kerakli xotirani topish.
 *
 * Avval BARCHA faktlar har soʻrovga qoʻshilardi. Oltmishta fakt —
 * bir necha ming token, va ularning aksariyati joriy savolga aloqasiz:
 * «hosilani tushuntir» degan savolga «Telegram boti ulangan» degan
 * fakt kerak emas.
 *
 * Endi savolga MOS keladiganlari tanlanadi. Vektor (embedding)
 * qidiruvi emas, LEKSIK moslik ishlatiladi — u qoʻshimcha soʻrov
 * talab qilmaydi, yaʼni oʻzi token yemaydi va oflayn ishlaydi.
 * Embedding kerak boʻlsa keyin shu joyga qoʻshiladi.
 */

/** Oʻzbekcha va rus tilidagi keng tarqalgan soʻzlar — moslikda hisobga olinmaydi. */
const STOP = new Set([
  'va', 'bilan', 'uchun', 'ham', 'bu', 'shu', 'men', 'sen', 'siz', 'biz', 'ular',
  'nima', 'qanday', 'qaysi', 'qachon', 'kim', 'yoki', 'lekin', 'ammo', 'agar',
  'boʻlsa', 'bolsa', 'kerak', 'mumkin', 'oʻzi', 'ozi', 'meni', 'mening', 'menga',
  'the', 'and', 'for', 'with', 'that', 'this', 'you', 'are', 'was', 'have',
  'что', 'как', 'для', 'это', 'мне', 'или',
]);

/** Matnni solishtirish uchun soʻzlarga ajratadi. */
export function tokenize(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[ʻʼ’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Ikki matn qanchalik mos — 0 dan 1 gacha.
 *
 * Oddiy kesishma emas: kam uchraydigan soʻz koʻp uchraydiganidan
 * ogʻirroq (idf gʻoyasi). Shu tufayli «Supabase» kabi nom «loyiha»
 * degan umumiy soʻzdan kuchliroq bogʻlanadi.
 */
export function similarity(query: string[], text: string): number {
  if (!query.length) return 0;
  const words = new Set(tokenize(text));
  if (!words.size) return 0;

  let score = 0;
  for (const q of query) {
    if (words.has(q)) {
      // Uzun soʻz kamroq uchraydi — demak kuchliroq bogʻlanish.
      score += q.length >= 7 ? 1.4 : 1;
      continue;
    }
    /*
     * Oʻzak boʻyicha moslik.
     *
     * Oʻzbekchada qoʻshimchalar koʻp: «Daho» → «Dahoda», «xotira» →
     * «xotirani». Aniq mosliknigina hisoblasak, mavzu boʻyicha eng
     * kerakli fakt topilmay qoladi. Toʻrt harflik oʻzak yetarli:
     * undan qisqasi tasodifiy mos kelib qolishi mumkin.
     */
    const ozak = q.slice(0, 4);
    for (const w of words) {
      if (w.length >= 4 && (w.startsWith(ozak) || q.startsWith(w.slice(0, 4)))) {
        score += 1;
        break;
      }
    }
  }

  /*
   * Boʻluvchi ataylab cheklangan.
   *
   * Soʻrovdagi soʻz soniga boʻlsak, uzun savolda bitta muhim soʻz mos
   * kelgani ham «past baho» olardi — holbuki aynan oʻsha soʻz muhim
   * («Telegramga bugun ertalab xabar yuborib qoʻysang boʻladimi»).
   */
  return Math.min(1, score / Math.min(query.length, 3));
}

export interface Scored<T> {
  item: T;
  score: number;
}

/**
 * Mos keladiganlarini saralaydi.
 *
 * `threshold` — shundan pastini umuman yubormaymiz. Zaif moslik
 * foyda bermaydi, lekin token yeydi.
 */
export function rank<T>(
  items: T[],
  query: string,
  textOf: (item: T) => string,
  opts: { top?: number; threshold?: number } = {},
): Array<Scored<T>> {
  const q = tokenize(query);
  if (!q.length) return [];
  const top = opts.top ?? 5;
  const threshold = opts.threshold ?? 0.28;

  return items
    .map((item) => ({ item, score: similarity(q, textOf(item)) }))
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}
