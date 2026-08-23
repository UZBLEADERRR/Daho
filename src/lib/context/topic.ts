/*
 * Mavzu holati — «qayerda edik?» degan savolga javob.
 *
 * Qirq xabardan keyin model suhbat nima haqida ketayotganini
 * yoʻqotadi: eski xabarlar xulosaga tushgan, xulosa esa umumiy.
 * Shuning uchun ALOHIDA, kichik va aniq holat saqlanadi: maqsad
 * nima, hozir nima ustida ishlanyapti, qanday qaror qabul qilingan,
 * qaysi savol ochiq qolgan.
 *
 * Bu ataylab TUZILMALI (JSON) — erkin matn vaqt oʻtib shishib ketadi,
 * tuzilma esa maydonlar soni bilan cheklangan.
 */

import { jsonAny } from '../providers';
import { getState, setState } from '../store';
import type { Chat, TopicState } from '../types';

/** Har bir maydonning chegarasi — holat shishib ketmasin. */
const LIMIT = { entities: 8, decisions: 6, questions: 4, text: 160 };

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    topic: { type: 'STRING' },
    goal: { type: 'STRING' },
    current_task: { type: 'STRING' },
    entities: { type: 'ARRAY', items: { type: 'STRING' } },
    decisions: { type: 'ARRAY', items: { type: 'STRING' } },
    open_questions: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['topic', 'current_task'],
};

const PROMPT = `Suhbatning oxirgi qismidan MAVZU HOLATINI yangila.

Maydonlar:
- topic — suhbat nima haqida (3-6 soʻz)
- goal — foydalanuvchi nimaga erishmoqchi (bir jumla)
- current_task — HOZIR nima qilinyapti (bir jumla)
- entities — muhim nomlar: loyiha, fayl, texnologiya, odam
- decisions — qabul qilingan qarorlar («Supabase ishlatamiz»)
- open_questions — javobsiz qolgan savollar

Qoidalar:
- Avvalgi holat berilgan boʻlsa uni YANGILA, noldan yozma.
- Bajarilgan qaror ochiq savoldan olib tashlanadi.
- Har band qisqa boʻlsin. Faqat JSON qaytar.`;

function kes(text: unknown, n = LIMIT.text): string {
  return String(text ?? '').trim().slice(0, n);
}

function tozala(raw: Partial<TopicState>): TopicState {
  const list = (v: unknown, n: number) =>
    (Array.isArray(v) ? v : [])
      .map((x) => kes(x, 90))
      .filter(Boolean)
      .slice(0, n);
  return {
    topic: kes(raw.topic, 60),
    goal: kes(raw.goal),
    current_task: kes(raw.current_task),
    entities: list(raw.entities, LIMIT.entities),
    decisions: list(raw.decisions, LIMIT.decisions),
    open_questions: list(raw.open_questions, LIMIT.questions),
    updatedAt: Date.now(),
  };
}

/** Holatni modelga koʻrsatiladigan qisqa matnga aylantiradi. */
export function topicBlock(state?: TopicState): string {
  if (!state?.topic) return '';
  const rows = [`## Hozirgi ish 🎯`, `Mavzu: ${state.topic}`];
  if (state.goal) rows.push(`Maqsad: ${state.goal}`);
  if (state.current_task) rows.push(`Hozir: ${state.current_task}`);
  if (state.entities.length) rows.push(`Tegishli: ${state.entities.join(', ')}`);
  if (state.decisions.length) {
    rows.push('Kelishilgan:', ...state.decisions.map((d) => `- ${d}`));
  }
  if (state.open_questions.length) {
    rows.push('Ochiq savollar:', ...state.open_questions.map((q) => `- ${q}`));
  }
  return rows.join('\n');
}

/**
 * Holatni yangilaydi.
 *
 * Har xabarda emas — bu ham soʻrov, u ham pul turadi. Bir necha
 * xabarda bir marta yetadi, chunki mavzu tez almashmaydi.
 */
export async function refreshTopic(chatId: string, signal?: AbortSignal): Promise<void> {
  const chat = getState().chats.find((c) => c.id === chatId);
  if (!chat) return;

  const oxirgi = chat.messages.slice(-10);
  if (oxirgi.length < 4) return;

  const body = oxirgi
    .map((m) => `${m.role === 'user' ? 'Foydalanuvchi' : 'Daho'}: ${m.text.replace(/```[\s\S]*?```/g, '[kod]').slice(0, 400)}`)
    .join('\n')
    .slice(0, 6000);

  const avval = chat.topicState ? `Avvalgi holat:\n${JSON.stringify(chat.topicState)}\n\n` : '';

  try {
    const raw = await jsonAny<Partial<TopicState>>(
      `${PROMPT}\n\n${avval}Suhbat:\n${body}`,
      SCHEMA,
      signal,
    );
    const next = { ...tozala(raw), messageCount: chat.messages.length };
    if (!next.topic) return;
    setState((s) => ({
      chats: s.chats.map((c) => (c.id === chatId ? { ...c, topicState: next } : c)),
    }));
  } catch {
    /* holat yangilanmasa ham suhbat ishlayveradi */
  }
}

/** Holatni yangilash vaqti keldimi. */
export function topicStale(chat: Chat | undefined): boolean {
  if (!chat || chat.messages.length < 4) return false;
  const state = chat.topicState;
  if (!state) return true;
  // Har 6 xabarda bir marta.
  return chat.messages.length - (state.messageCount ?? 0) >= 6;
}
