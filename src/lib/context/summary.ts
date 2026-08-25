/*
 * Suhbat xulosasi — tuzilmali va chegaralangan.
 *
 * Erkin matnli xulosaning kasali maʼlum: har yangilanishda u oldingi
 * xulosani ichiga oladi va asta-sekin oʻzi ham oʻn minglab tokenga
 * aylanadi. Shuning uchun xulosa TUZILMA boʻyicha yigʻiladi va har
 * maydonning band soni cheklangan — hajm oʻsib ketmaydi.
 */

import { jsonAny } from '../providers';
import { getState, setState } from '../store';
import type { Chat, ChatSummary } from '../types';

/** Oxirgi shuncha xabar har doim toʻliq holida yuboriladi. */
export const KEEP_TURNS = 8;

/** Xulosaga tushmagan eski xabar shundan koʻp boʻlsa — yangilaymiz. */
const TRIGGER = 6;

const LIMIT = { facts: 8, decisions: 6, made: 6, questions: 4, text: 220 };

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    goal: { type: 'STRING' },
    current_state: { type: 'STRING' },
    important_facts: { type: 'ARRAY', items: { type: 'STRING' } },
    decisions: { type: 'ARRAY', items: { type: 'STRING' } },
    made: { type: 'ARRAY', items: { type: 'STRING' } },
    open_questions: { type: 'ARRAY', items: { type: 'STRING' } },
    next_step: { type: 'STRING' },
  },
  required: ['current_state'],
};

const PROMPT = `Suhbatning eski qismidan QISQA XOTIRA yigʻ.

Maydonlar:
- goal — foydalanuvchi nimaga erishmoqchi
- current_state — ish qayerga yetgani (bir-ikki jumla)
- important_facts — foydalanuvchi haqidagi doimiy faktlar
- decisions — kelishilgan qarorlar
- made — yasalgan narsalar (nomi bilan: «Mobil Piyano ilovasi»)
- open_questions — javobsiz qolgan savollar
- next_step — keyingi qadam

Qoidalar:
- Avvalgi xotira berilgan boʻlsa uni YANGILA, takrorlama.
- Salomlashish, minnatdorchilik, takroriy gaplarni tashla.
- Toʻliq matn, kod va roʻyxatlarni yozma — faqat nomini qoldir.
- Har band bitta qisqa qator. Faqat JSON qaytar.`;

function kes(v: unknown, n = LIMIT.text): string {
  return String(v ?? '').trim().slice(0, n);
}

function tozala(raw: Partial<ChatSummary>): ChatSummary {
  const list = (v: unknown, n: number) =>
    (Array.isArray(v) ? v : [])
      .map((x) => kes(x, 120))
      .filter(Boolean)
      .slice(0, n);
  return {
    goal: kes(raw.goal),
    current_state: kes(raw.current_state, 320),
    important_facts: list(raw.important_facts, LIMIT.facts),
    decisions: list(raw.decisions, LIMIT.decisions),
    made: list(raw.made, LIMIT.made),
    open_questions: list(raw.open_questions, LIMIT.questions),
    next_step: kes(raw.next_step),
  };
}

/** Xulosani modelga koʻrsatiladigan matnga aylantiradi. */
export function summaryBlock(summary?: ChatSummary): string {
  if (!summary?.current_state) return '';
  const rows = ['## Suhbatning avvalgi qismi'];
  if (summary.goal) rows.push(`Maqsad: ${summary.goal}`);
  rows.push(`Holat: ${summary.current_state}`);
  if (summary.made.length) rows.push(`Yasalgan: ${summary.made.join('; ')}`);
  if (summary.decisions.length) {
    rows.push('Qarorlar:', ...summary.decisions.map((d) => `- ${d}`));
  }
  if (summary.important_facts.length) {
    rows.push('Muhim:', ...summary.important_facts.map((f) => `- ${f}`));
  }
  if (summary.open_questions.length) {
    rows.push('Ochiq:', ...summary.open_questions.map((q) => `- ${q}`));
  }
  if (summary.next_step) rows.push(`Keyingi qadam: ${summary.next_step}`);
  return rows.join('\n');
}

/** Xabarni xulosa uchun qisqa matnga aylantiradi. */
function line(msg: { role: string; text: string; attachments?: unknown[] }): string {
  const who = msg.role === 'user' ? 'Foydalanuvchi' : 'Daho';
  const text = msg.text
    .replace(/```[\s\S]*?```/g, '[kod]')
    .replace(/\s+/g, ' ')
    .trim();
  const files = msg.attachments?.length ? ` [${msg.attachments.length} fayl]` : '';
  return `${who}: ${text.slice(0, 600)}${files}`;
}

/**
 * Kerak boʻlsa xulosani yangilaydi.
 *
 * Chaqiruvchi kutib turmaydi: xulosa keyingi soʻrovga tayyor boʻlsa
 * yetarli. Arzon model bilan va ~10 xabarda bir marta bajariladi,
 * shuning uchun oʻz narxi sezilmaydi.
 */
export async function refreshSummary(chatId: string, signal?: AbortSignal): Promise<void> {
  const chat = getState().chats.find((c) => c.id === chatId);
  if (!chat) return;

  const upto = chat.recapUpto ?? 0;
  const eski = chat.messages.slice(upto, Math.max(upto, chat.messages.length - KEEP_TURNS));
  if (eski.length < TRIGGER) return;

  const body = eski.map(line).join('\n').slice(0, 12_000);
  const avval = chat.summary ? `Avvalgi xotira:\n${JSON.stringify(chat.summary)}\n\n` : '';

  try {
    const raw = await jsonAny<Partial<ChatSummary>>(
      `${PROMPT}\n\n${avval}Yangi qism:\n${body}`,
      SCHEMA,
      signal,
    );
    const next = tozala(raw);
    if (!next.current_state) return;
    setState((s) => ({
      chats: s.chats.map((c) =>
        c.id === chatId ? { ...c, summary: next, recapUpto: upto + eski.length } : c,
      ),
    }));
  } catch {
    /*
     * Xulosa yasalmasa ham suhbat ishlayveradi — shunchaki eski
     * xabarlar budjet chegarasiga tushib qoladi.
     */
  }
}

/** Suhbatning saqlangan xotirasi va u qaysi xabargacha ekani. */
export function summaryOf(chat: Chat | undefined): { summary?: ChatSummary; upto: number } {
  return { summary: chat?.summary, upto: chat?.recapUpto ?? 0 };
}
