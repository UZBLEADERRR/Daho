/*
 * Suhbat xotirasi — aylanma xulosa.
 *
 * Muammo: har soʻrovda BUTUN tarix qayta yuboriladi. Suhbat uzaygan
 * sari narx oʻsib boradi va yigirmanchi xabar birinchisidan bir necha
 * barobar qimmat tushadi. Chegara qoʻyish (eski xabarlarni tashlab
 * yuborish) esa xotirani yoʻqotadi — model nima kelishilganini unutadi.
 *
 * Yechim: eski qism BIR MARTA qisqa xulosaga aylantiriladi va shu
 * xulosa saqlanadi. Keyingi soʻrovlarda eski xabarlar oʻrniga oʻsha
 * bir necha qator ketadi. Natijada narx suhbat uzunligidan deyarli
 * qatʼi nazar bir xil boʻlib qoladi.
 *
 * Xulosa arzon model bilan va ~10 xabarda BIR MARTA yasaladi, shuning
 * uchun uning oʻz narxi sezilmaydi.
 */

import { completeAny, pickForJob } from './providers';
import { getState, setState } from './store';
import type { Chat, Message } from './types';

/** Oxirgi shuncha xabar har doim toʻliq holida yuboriladi. */
export const KEEP_TURNS = 8;

/** Xulosaga tushmagan eski xabar shundan koʻp boʻlsa — yangilaymiz. */
const TRIGGER = 6;

/** Xulosaning oʻzi ham cheksiz oʻsmasin. */
const MAX_RECAP = 2400;

/** Xabarni xulosa uchun qisqa matnga aylantiradi. */
function line(msg: Message): string {
  const who = msg.role === 'user' ? 'Foydalanuvchi' : 'Daho';
  // Kod bloklari xulosaga kerak emas — ular alohida saqlangan.
  const text = msg.text
    .replace(/```[\s\S]*?```/g, '[kod]')
    .replace(/\s+/g, ' ')
    .trim();
  const files = msg.attachments?.length ? ` [${msg.attachments.length} fayl]` : '';
  return `${who}: ${text.slice(0, 600)}${files}`;
}

const PROMPT = `Quyida suhbatning eski qismi bor. Undan QISQA xotira yoz.

Nimani saqlash kerak:
- foydalanuvchi haqidagi faktlar (ismi, kasbi, darajasi, tili);
- kelishilgan qarorlar va talablar («kitob 12 bobdan boʻlsin»);
- yasalgan narsalar va ularning nomi («Mobil Piyano ilovasi»);
- hal qilinmagan savol yoki keyingi qadam.

Nimani TASHLASH kerak:
- salomlashish, minnatdorchilik, takroriy gaplar;
- toʻliq matnlar, kod, roʻyxatlar — ularning faqat nomi qolsin.

10 tadan koʻp boʻlmagan qisqa band yoz. Har band bitta qator.
Oʻzbek tilida. Boshqa hech narsa yozma.`;

/** Suhbatga xulosa yozib qoʻyadi. */
function save(chatId: string, recap: string, upto: number): void {
  setState((s) => ({
    chats: s.chats.map((c) =>
      c.id === chatId ? { ...c, recap: recap.slice(0, MAX_RECAP), recapUpto: upto } : c,
    ),
  }));
}

/**
 * Kerak boʻlsa xulosani yangilaydi.
 *
 * Chaqiruvchi kutib turmaydi: xulosa keyingi soʻrovga tayyor boʻlsa
 * yetarli, hozirgisiga ulgurmasa ham zarari yoʻq.
 */
export async function refreshRecap(chatId: string, signal?: AbortSignal): Promise<void> {
  const chat = getState().chats.find((c) => c.id === chatId);
  if (!chat) return;

  const upto = chat.recapUpto ?? 0;
  const eski = chat.messages.slice(upto, Math.max(upto, chat.messages.length - KEEP_TURNS));
  if (eski.length < TRIGGER) return;

  const body = eski.map(line).join('\n').slice(0, 12_000);
  const oldRecap = chat.recap ? `Avvalgi xotira:\n${chat.recap}\n\n` : '';

  try {
    const text = await completeAny(pickForJob('tez'), `${oldRecap}Yangi qism:\n${body}`, {
      system: PROMPT,
      temperature: 0.2,
      signal,
    });
    if (text.trim()) save(chatId, text.trim(), upto + eski.length);
  } catch {
    /*
     * Xulosa yasalmasa ham suhbat ishlayveradi — shunchaki eski
     * xabarlar chegaraga tushib qoladi.
     */
  }
}

/** Suhbatning saqlangan xotirasi va u qaysi xabargacha ekani. */
export function recapOf(chat: Chat | undefined): { text: string; upto: number } {
  return { text: chat?.recap ?? '', upto: chat?.recapUpto ?? 0 };
}
