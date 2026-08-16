import { useSyncExternalStore } from 'react';

export type TaskKind = 'chat' | 'code' | 'video' | 'dars' | 'rasm';

export interface RunningTask {
  id: string;
  kind: TaskKind;
  /** Chat id, loyiha id yoki video id */
  targetId: string;
  title: string;
  note: string;
  startedAt: number;
}

interface Entry extends RunningTask {
  controller: AbortController;
}

const PENDING_KEY = 'daho.pending.v1';

let tasks: Entry[] = [];
const listeners = new Set<() => void>();
let snapshot: RunningTask[] = [];

function emit(): void {
  snapshot = tasks.map(({ controller: _controller, ...rest }) => rest);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Hozir bajarilayotgan barcha vazifalar. */
export function useTasks(): RunningTask[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

export function useTaskFor(kind: TaskKind, targetId: string): RunningTask | undefined {
  return useTasks().find((t) => t.kind === kind && t.targetId === targetId);
}

export function isRunning(kind: TaskKind, targetId: string): boolean {
  return tasks.some((t) => t.kind === kind && t.targetId === targetId);
}

export function stopTask(id: string): void {
  tasks.find((t) => t.id === id)?.controller.abort();
}

export function stopFor(kind: TaskKind, targetId: string): void {
  tasks.filter((t) => t.kind === kind && t.targetId === targetId).forEach((t) => t.controller.abort());
}

/** Vazifa davomida qisqa izohni yangilaydi ("3-fayl yozilmoqda"). */
export function noteTask(id: string, note: string): void {
  const entry = tasks.find((t) => t.id === id);
  if (!entry) return;
  entry.note = note;
  emit();
}

/* ---------- Ekran uygʻoq turishi ---------- */

let wakeLock: any = null;

async function acquireWakeLock(): Promise<void> {
  if (wakeLock || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await (navigator as any).wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => {
      wakeLock = null;
    });
  } catch {
    /* qurilma qoʻllab-quvvatlamasa — jim oʻtamiz */
  }
}

function releaseWakeLock(): void {
  if (!tasks.length && wakeLock) {
    wakeLock.release?.().catch(() => undefined);
    wakeLock = null;
  }
}

// Ilova fonga oʻtib qaytganda qulfni tiklaymiz.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && tasks.length) void acquireWakeLock();
  });
}

/* ---------- Tugallanmagan ish belgisi ---------- */

interface PendingMark {
  kind: TaskKind;
  targetId: string;
  title: string;
  at: number;
}

function readPending(): PendingMark[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as PendingMark[];
  } catch {
    return [];
  }
}

function writePending(list: PendingMark[]): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    /* eʼtiborsiz */
  }
}

function markPending(task: RunningTask): void {
  writePending([
    ...readPending().filter((p) => !(p.kind === task.kind && p.targetId === task.targetId)),
    { kind: task.kind, targetId: task.targetId, title: task.title, at: task.startedAt },
  ]);
}

function clearPending(kind: TaskKind, targetId: string): void {
  writePending(readPending().filter((p) => !(p.kind === kind && p.targetId === targetId)));
}

/**
 * Ilova yopilib qolganda tugallanmagan ishlar roʻyxati.
 * Ochilganda foydalanuvchiga «davom ettirasizmi?» deb koʻrsatiladi.
 */
export function unfinishedTasks(): PendingMark[] {
  return readPending().filter((p) => Date.now() - p.at < 24 * 60 * 60 * 1000);
}

export function forgetUnfinished(kind: TaskKind, targetId: string): void {
  clearPending(kind, targetId);
}

/* ---------- Ishga tushirish ---------- */

export interface StartOptions {
  kind: TaskKind;
  targetId: string;
  title: string;
  note?: string;
}

/**
 * Vazifani reyestrga qoʻshib bajaradi. Foydalanuvchi boshqa sahifaga oʻtsa
 * ham ish davom etadi — chunki u komponentga emas, shu reyestrga bogʻlangan.
 */
export async function startTask<T>(
  opts: StartOptions,
  fn: (signal: AbortSignal, taskId: string) => Promise<T>,
): Promise<T | undefined> {
  // Bir maqsad uchun ikkita bir xil ish yurmasin.
  if (isRunning(opts.kind, opts.targetId)) return undefined;

  const controller = new AbortController();
  const entry: Entry = {
    id: `${opts.kind}_${opts.targetId}_${Date.now().toString(36)}`,
    kind: opts.kind,
    targetId: opts.targetId,
    title: opts.title,
    note: opts.note ?? 'boshlandi',
    startedAt: Date.now(),
    controller,
  };

  tasks = [...tasks, entry];
  emit();
  markPending(entry);
  void acquireWakeLock();

  try {
    return await fn(controller.signal, entry.id);
  } finally {
    tasks = tasks.filter((t) => t.id !== entry.id);
    clearPending(opts.kind, opts.targetId);
    emit();
    releaseWakeLock();
  }
}
