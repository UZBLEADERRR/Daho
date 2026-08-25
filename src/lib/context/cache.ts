/*
 * Javob keshi.
 *
 * Bir xil savol qayta berilsa — modelga qayta bormaymiz. «Supabase
 * nima?» degan savolga javob bir marta yozilgan boʻlsa, ikkinchi
 * marta uning narxi nol boʻlishi kerak.
 *
 * Moslik LEKSIK yoʻl bilan oʻlchanadi (embedding emas): qoʻshimcha
 * soʻrov talab qilmaydi, yaʼni keshning oʻzi token yemaydi. Chegara
 * ataylab baland — notoʻgʻri javobni qaytarib berish keshdan
 * foydalanmaslikdan yomonroq.
 */

import { similarity, tokenize } from './retrieve';

interface Entry {
  question: string;
  words: string[];
  answer: string;
  at: number;
}

const KEY = 'daho.cache.v1';
const MAX = 60;
/** Bir hafta — undan eskisi eskirgan boʻlishi mumkin. */
const TTL = 7 * 24 * 60 * 60_000;
/** Shu darajadan past moslikda kesh ishlatilmaydi. */
const THRESHOLD = 0.92;

/** Kesh faqat SHU turdagi savollarga tegishli. */
function cacheable(text: string): boolean {
  const clean = text.trim();
  if (clean.length < 8 || clean.length > 300) return false;
  /*
   * Shaxsiy yoki vaqtga bogʻliq savol keshlanmaydi: «mening
   * jadvalim», «bugun», «oxirgi» — javob har safar boshqacha.
   */
  if (/mening|menda|jadvalim|bugun|ertaga|hozir|kecha|oxirgi|soat necha|qancha qoldi/i.test(clean)) {
    return false;
  }
  // Vosita talab qiladigan buyruqlar ham keshlanmaydi.
  if (/yoz|yasa|qil|tuzat|yubor|och|qidir|chiz|saqla|oʻchir|ochir/i.test(clean)) return false;
  return true;
}

function read(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Entry[];
    const chegara = Date.now() - TTL;
    return Array.isArray(list) ? list.filter((e) => e.at > chegara) : [];
  } catch {
    return [];
  }
}

function write(list: Entry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* xotira toʻlgan boʻlsa kesh ishlamaydi — zarari yoʻq */
  }
}

/** Tayyor javob bormi. */
export function cachedAnswer(question: string): string | null {
  if (!cacheable(question)) return null;
  /*
   * Bitta soʻz ham yetadi.
   *
   * «Supabase nima?» da «nima» toʻxtatuvchi soʻz boʻlgani uchun
   * bitta «supabase» qoladi — ikkitadan kam deb rad etsak, aynan
   * eng koʻp takrorlanadigan qisqa savollar keshdan foydalanmasdi.
   * Notoʻgʻri moslikdan quyidagi IKKI TOMONLAMA tekshiruv saqlaydi.
   */
  const words = tokenize(question);
  if (!words.length) return null;

  for (const entry of read()) {
    /*
     * Ikki tomonlama tekshiramiz: savol javobga ham, javob savolga
     * ham mos boʻlsin. Bir tomonlama moslik uzun savolni qisqasiga
     * notoʻgʻri bogʻlab qoʻyishi mumkin.
     */
    const a = similarity(words, entry.question);
    const b = similarity(entry.words, question);
    if (Math.min(a, b) >= THRESHOLD) return entry.answer;
  }
  return null;
}

/** Javobni keshga qoʻyadi. */
export function remember(question: string, answer: string): void {
  if (!cacheable(question)) return;
  const clean = answer.trim();
  // Juda qisqa yoki juda uzun javobni saqlamaymiz.
  if (clean.length < 40 || clean.length > 6000) return;
  // Vosita ishlatilgan javob takrorlanmasligi mumkin — uni saqlamaymiz.
  if (/\[kod\]|```/.test(clean) && clean.length > 2000) return;

  const list = read().filter((e) => e.question !== question.trim());
  list.unshift({
    question: question.trim(),
    words: tokenize(question),
    answer: clean,
    at: Date.now(),
  });
  write(list);
}

export function clearCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* eʼtiborsiz */
  }
}
