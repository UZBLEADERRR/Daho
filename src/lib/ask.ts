import { useSyncExternalStore } from 'react';

/* ------------------------------------------------------------------ */
/*  Agentning savoli                                                   */
/* ------------------------------------------------------------------ */

export interface PendingQuestion {
  id: string;
  /** Qaysi suhbat yoki loyihada soʻralyapti */
  scope: 'chat' | 'code';
  targetId: string;
  question: string;
  /** Tayyor variantlar; boʻsh boʻlsa faqat erkin javob */
  options: string[];
  /** Bir nechta variant tanlash mumkinmi */
  multi: boolean;
  askedAt: number;
}

interface Entry extends PendingQuestion {
  resolve: (answer: string) => void;
}

let questions: Entry[] = [];
let qSnapshot: PendingQuestion[] = [];
const qListeners = new Set<() => void>();

function emitQuestions(): void {
  qSnapshot = questions.map(({ resolve: _resolve, ...rest }) => rest);
  qListeners.forEach((l) => l());
}

function subscribeQuestions(listener: () => void): () => void {
  qListeners.add(listener);
  return () => qListeners.delete(listener);
}

export function usePendingQuestions(): PendingQuestion[] {
  return useSyncExternalStore(
    subscribeQuestions,
    () => qSnapshot,
    () => qSnapshot,
  );
}

export function usePendingQuestion(
  scope: 'chat' | 'code',
  targetId: string,
): PendingQuestion | undefined {
  return usePendingQuestions().find((q) => q.scope === scope && q.targetId === targetId);
}

export interface AskOptions {
  scope: 'chat' | 'code';
  targetId: string;
  question: string;
  options?: string[];
  multi?: boolean;
  signal?: AbortSignal;
}

/**
 * Foydalanuvchidan javob soʻraydi va u javob berguncha kutadi.
 * Ish toʻxtatilsa (`signal`) soʻrov bekor qilinadi.
 */
export function askUser(opts: AskOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const entry: Entry = {
      id: `q_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      scope: opts.scope,
      targetId: opts.targetId,
      question: opts.question,
      options: (opts.options ?? []).slice(0, 6),
      multi: Boolean(opts.multi),
      askedAt: Date.now(),
      resolve,
    };

    const finish = (answer: string) => {
      questions = questions.filter((q) => q.id !== entry.id);
      emitQuestions();
      resolve(answer);
    };
    entry.resolve = finish;

    opts.signal?.addEventListener(
      'abort',
      () => {
        questions = questions.filter((q) => q.id !== entry.id);
        emitQuestions();
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );

    questions = [...questions, entry];
    emitQuestions();
  });
}

export function answerQuestion(id: string, answer: string): void {
  questions.find((q) => q.id === id)?.resolve(answer);
}

/* ------------------------------------------------------------------ */
/*  Ish davomida qoʻshimcha fikr                                       */
/* ------------------------------------------------------------------ */

const inbox = new Map<string, string[]>();
const iListeners = new Set<() => void>();
let iSnapshot: Record<string, number> = {};

function key(scope: 'chat' | 'code', targetId: string): string {
  return `${scope}:${targetId}`;
}

function emitInbox(): void {
  iSnapshot = Object.fromEntries([...inbox.entries()].map(([k, v]) => [k, v.length]));
  iListeners.forEach((l) => l());
}

/**
 * Foydalanuvchi ish davomida yozgan qoʻshimcha koʻrsatmani navbatga qoʻyadi.
 * Agent keyingi qadamda uni oʻqiydi va hisobga oladi.
 */
export function interject(scope: 'chat' | 'code', targetId: string, text: string): void {
  const clean = text.trim();
  if (!clean) return;
  const k = key(scope, targetId);
  inbox.set(k, [...(inbox.get(k) ?? []), clean]);
  emitInbox();
}

/** Navbatdagi qoʻshimchalarni olib tashlaydi va qaytaradi. */
export function drainInterjections(scope: 'chat' | 'code', targetId: string): string[] {
  const k = key(scope, targetId);
  const list = inbox.get(k) ?? [];
  if (!list.length) return [];
  inbox.delete(k);
  emitInbox();
  return list;
}

export function useInterjectionCount(scope: 'chat' | 'code', targetId: string): number {
  const snap = useSyncExternalStore(
    (listener) => {
      iListeners.add(listener);
      return () => iListeners.delete(listener);
    },
    () => iSnapshot,
    () => iSnapshot,
  );
  return snap[key(scope, targetId)] ?? 0;
}
