/*
 * Context Builder — har soʻrovda modelga nima ketishini hal qiladi.
 *
 * Asosiy qoida: Daho hech qachon butun tarixni yubormaydi. U
 * «hozirgi savolga javob berish uchun tarixdan nimani bilishim
 * kerak?» degan savolga javob yigʻadi:
 *
 *     tizim koʻrsatmasi
 *   + mavzu holati        (qayerda edik)
 *   + mos xotiralar       (hammasi emas — faqat savolga tegishlisi)
 *   + suhbat xulosasi     (eski qism, tuzilmali)
 *   + oxirgi 8 xabar
 *   + joriy savol
 *
 * Soʻng hammasi token budjetiga sigʻdiriladi: sigʻmasa eng kam foyda
 * beradigan qism birinchi boʻlib ketadi, joriy savol va yaqin
 * xabarlarga esa hech qachon tegilmaydi.
 */

import { allMemories } from '../memory';
import type { Chat, Memory } from '../types';
import { budgetFor, fitBudget, estimateTokens, weighRequest, type Piece } from './budget';
import { rank } from './retrieve';
import { summaryBlock, summaryOf, KEEP_TURNS } from './summary';
import { topicBlock } from './topic';

export interface BuiltContext {
  /** Tizim koʻrsatmasiga qoʻshiladigan bloklar (tartib bilan) */
  blocks: string[];
  /** Tarixdan nechta oxirgi xabar olinadi */
  keepTurns: number;
  /** Xulosa qaysi xabargacha — undan oldingilari yuborilmaydi */
  summaryUpto: number;
  /** Kuzatish uchun: nimaga qancha ketdi */
  report: {
    budget: number;
    used: number;
    dropped: string[];
    trimmed: string[];
    memories: number;
  };
}

/**
 * Kontekstni yigʻadi.
 *
 * @param chat    joriy suhbat
 * @param text    foydalanuvchining hozirgi xabari
 * @param system  tizim koʻrsatmasi (u budjetda hisobga olinadi, lekin kesilmaydi)
 */
export function buildContext(
  chat: Chat | undefined,
  text: string,
  system: string,
  opts: { hasFiles?: boolean } = {},
): BuiltContext {
  const ogirlik = weighRequest(text, opts.hasFiles);
  const budget = budgetFor(ogirlik);

  const { summary, upto } = summaryOf(chat);

  /*
   * Xotiradan faqat MOS keladiganini olamiz.
   *
   * Avval oltmishta faktning hammasi har soʻrovga qoʻshilardi —
   * «hosilani tushuntir» degan savolga «Telegram boti ulangan» degan
   * fakt ham ketardi.
   */
  const memories: Memory[] = allMemories();
  const mos = rank(memories, text, (m) => m.text, { top: 5, threshold: 0.28 });
  const memoryText = mos.length
    ? ['## Foydalanuvchi haqida', ...mos.map((m) => `- ${m.item.text}`)].join('\n')
    : '';

  const pieces: Piece[] = [
    // Tizim koʻrsatmasi — kesilmaydi, lekin budjetda hisobga olinadi.
    { id: 'system', text: system, priority: 0 },
    { id: 'topic', text: topicBlock(chat?.topicState), priority: 1, minChars: 120 },
    { id: 'memory', text: memoryText, priority: 2, minChars: 60 },
    { id: 'summary', text: summaryBlock(summary), priority: 3, minChars: 200 },
  ].filter((p) => p.text.trim());

  /*
   * Tarix uchun joy ajratamiz.
   *
   * Xabarlar bu yerda emas, `toContents` da qoʻshiladi — shuning uchun
   * ularning oʻrniga budjetdan ulush ajratib qoʻyamiz va nechta xabar
   * sigʻishini qaytaramiz.
   */
  const tarixUlushi = Math.round(budget * 0.45);
  const plan = fitBudget(pieces, Math.max(0, budget - tarixUlushi));

  return {
    blocks: plan.pieces.filter((p) => p.id !== 'system').map((p) => p.text),
    keepTurns: ogirlik === 'oddiy' ? 4 : KEEP_TURNS,
    summaryUpto: summary ? upto : 0,
    report: {
      budget,
      used: plan.usedTokens + estimateTokens(text),
      dropped: plan.dropped,
      trimmed: plan.trimmed,
      memories: mos.length,
    },
  };
}
