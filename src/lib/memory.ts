/**
 * Xotira — Daho sizni eslab qoladi.
 *
 * Har suhbat noldan boshlanardi: universitetingiz, loyihalaringiz, qanday
 * javob yoqishi — hammasini qaytadan aytishga toʻgʻri kelardi.
 *
 * Endi suhbat davomida aytilgan DOIMIY faktlar ajratib olinadi va har bir
 * yangi suhbatga qoʻshiladi. «Doimiy» degani: ertaga ham toʻgʻri boʻlib
 * qoladigan narsa (kasbi, maqsadi, uslub talabi), bir martalik gap emas
 * («bugun charchadim»).
 *
 * Faktlar telefonda saqlanadi va foydalanuvchi ularni koʻrishi, tahrirlashi
 * va oʻchirishi mumkin — bu muhim, chunki xotira xato boʻlsa hamma javob
 * xato boʻladi.
 */

import { completeAny } from './providers';
import { getState, setState } from './store';
import type { Memory } from './types';
import { uid } from './utils';

/** Bir vaqtda saqlanadigan eng koʻp fakt soni. */
const MAX_FACTS = 60;

export function allMemories(): Memory[] {
  return getState().memories ?? [];
}

export function addMemory(text: string, source: Memory['source'] = 'qoʻlda'): Memory | null {
  const clean = text.trim().slice(0, 200);
  if (!clean) return null;

  // Takrorni qoʻshmaymiz — bir xil fakt ikki marta turmasin.
  const existing = allMemories();
  const norm = (v: string) => v.toLowerCase().replace(/[^a-zа-яʻʼ0-9\s]/gi, '').trim();
  if (existing.some((m) => norm(m.text) === norm(clean))) return null;

  const item: Memory = { id: uid('mem_'), text: clean, source, createdAt: Date.now() };
  setState((s) => ({ memories: [item, ...(s.memories ?? [])].slice(0, MAX_FACTS) }));
  return item;
}

export function updateMemory(id: string, text: string): void {
  setState((s) => ({
    memories: (s.memories ?? []).map((m) =>
      m.id === id ? { ...m, text: text.trim().slice(0, 200) } : m,
    ),
  }));
}

export function deleteMemory(id: string): void {
  setState((s) => ({ memories: (s.memories ?? []).filter((m) => m.id !== id) }));
}

export function clearMemories(): void {
  setState({ memories: [] });
}

/** Tizim koʻrsatmasiga qoʻshiladigan matn. */
export function memoryBlock(): string {
  const list = allMemories();
  if (!list.length) return '';
  return (
    '## Foydalanuvchi haqida eslab qolganlaring\n' +
    list.map((m) => `- ${m.text}`).join('\n') +
    '\nBularni hisobga ol, lekin har javobda takrorlab sanab oʻtirma.'
  );
}

/* ------------------------------------------------------------------ */
/*  Suhbatdan fakt ajratish                                            */
/* ------------------------------------------------------------------ */

const EXTRACT_PROMPT = `Quyida foydalanuvchi bilan boʻlgan suhbat parchasi bor.
Undan foydalanuvchi haqidagi DOIMIY faktlarni ajratib ol.

Doimiy fakt — ertaga ham toʻgʻri boʻlib qoladigan narsa:
- kasbi, oʻqish joyi, kursi, yoshi
- loyihalari, biznesi, brendi
- maqsadlari va rejalari
- qanday javob yoqishi (uslub, til, uzunlik)
- bilim darajasi, qaysi texnologiyalarni ishlatishi
- muhim shaxsiy holatlar (masalan qaysi shaharda yashashi)

Doimiy EMAS — bularni olma:
- bir martalik soʻrovlar («shu kodni tuzat», «rasm chiz»)
- kayfiyat va vaqtinchalik holat («bugun charchadim»)
- sen aytgan narsalar, faqat FOYDALANUVCHI haqidagi maʼlumot
- allaqachon eslab qolinganlar (pastda roʻyxati bor)

Har bir faktni bitta qisqa jumlada, oʻzbek tilida yoz.
Yangi fakt boʻlmasa — boʻsh roʻyxat qaytar.

Javobni FAQAT JSON massiv koʻrinishida ber, boshqa matnsiz:
["fakt bir", "fakt ikki"]`;

/**
 * Suhbatdan yangi faktlarni ajratib, xotiraga qoʻshadi.
 * Xato boʻlsa jim oʻtadi — xotira suhbatni buzmasligi kerak.
 */
export async function learnFromChat(chatId: string, signal?: AbortSignal): Promise<number> {
  const { settings, chats } = getState();
  if (!settings.memoryEnabled) return 0;

  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return 0;

  // Oxirgi almashuvlarni olamiz — hammasi shart emas.
  const recent = chat.messages
    .slice(-8)
    .filter((m) => m.text.trim())
    .map((m) => `${m.role === 'user' ? 'Foydalanuvchi' : 'Daho'}: ${m.text.slice(0, 700)}`)
    .join('\n\n');
  if (recent.length < 80) return 0;

  const known = allMemories()
    .map((m) => `- ${m.text}`)
    .join('\n');

  try {
    const answer = await completeAny(
      settings.model,
      `${EXTRACT_PROMPT}\n\n## Allaqachon eslab qolinganlar\n${known || '(hali yoʻq)'}\n\n## Suhbat\n${recent}`,
      { temperature: 0.2, signal },
    );

    const match = answer.match(/\[[\s\S]*\]/);
    if (!match) return 0;
    const facts = JSON.parse(match[0]) as unknown[];

    let added = 0;
    for (const fact of facts.slice(0, 5)) {
      if (typeof fact !== 'string') continue;
      if (addMemory(fact, 'suhbat')) added += 1;
    }
    return added;
  } catch {
    // Model JSON qaytarmadi yoki tarmoq uzildi — xotira shart emas.
    return 0;
  }
}
