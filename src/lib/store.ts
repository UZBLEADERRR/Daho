import { useSyncExternalStore } from 'react';
import { FALLBACK_MODELS } from './models';
import type { AppState, Book, BookChapter, Settings } from './types';
import { uid } from './utils';

const STORAGE_KEY = 'daho.state.v1';

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  // Model roʻyxati birinchi ulanishda API dan olinadi va bu qiymat
  // avtomatik eng yangi modelga almashtiriladi.
  model: FALLBACK_MODELS.chat,
  imageModel: FALLBACK_MODELS.image,
  ttsModel: FALLBACK_MODELS.tts,
  theme: 'tun',
  accent: '#8b7cf6',
  fontScale: 1,
  temperature: 0.8,
  autoSpeak: false,
  ttsEngine: 'gemini',
  ttsVoice: 'sardor',
  ttsLang: 'uz-UZ',
  ttsRate: 1,
  ttsVoiceUri: '',
  sttEngine: 'gemini',
  sttLang: 'uz-UZ',
  githubToken: '',
  publishDomain: '',
  aiSource: 'auto',
  cloudBackup: true,
  userName: '',
  university: '',
  customInstructions: '',
};

const EMPTY_STATE: AppState = {
  version: 2,
  settings: DEFAULT_SETTINGS,
  chats: [],
  activeChatId: null,
  artifacts: [],
  notes: [],
  tasks: [],
  projects: [],
  schedule: [],
  timeLogs: [],
  apps: [],
  courses: [],
  videos: [],
  code: [],
  routes: [],
  books: [],
  browserHistory: [],
};

/** Eski saqlangan holatdagi ishlamay qolgan model nomlarini tozalaydi. */
const RETIRED_MODELS = /^(gemini-1\.|gemini-2\.0|gemini-2\.5-(flash|pro)$)/;

/**
 * Eski yoki chala saqlangan kitoblarni tuzatadi.
 * Masalan bob raqami yoʻqolган boʻlsa — tartib boʻyicha tiklaymiz,
 * matn maydoni boʻlmasa — boʻsh satr qoʻyamiz (chiqarishda xato bermasin).
 */
function healBooks(books: Book[] | undefined): Book[] {
  if (!Array.isArray(books)) return [];
  return books.map((book) => ({
    ...book,
    illustrated: Boolean(book?.illustrated),
    chapters: (Array.isArray(book?.chapters) ? book.chapters : []).map(
      (chapter, index): BookChapter => ({
        ...chapter,
        id: chapter?.id ?? uid('bob'),
        no: Number.isFinite(chapter?.no) ? chapter.no : index + 1,
        title: chapter?.title ?? `${index + 1}-bob`,
        brief: chapter?.brief ?? '',
        content: chapter?.content ?? '',
        words: Number.isFinite(chapter?.words) ? chapter.words : 0,
        status: chapter?.status ?? (chapter?.content ? 'tayyor' : 'kutilmoqda'),
        images: Array.isArray(chapter?.images) ? chapter.images : undefined,
        updatedAt: chapter?.updatedAt ?? Date.now(),
      }),
    ),
  }));
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(EMPTY_STATE);
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const settings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) };
    if (RETIRED_MODELS.test(settings.model)) settings.model = DEFAULT_SETTINGS.model;
    return {
      ...structuredClone(EMPTY_STATE),
      ...parsed,
      settings,
      books: healBooks(parsed.books),
    };
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Saqlashda xato (xotira toʻlgan boʻlishi mumkin):', err);
    }
  }, 120);
}

export function getState(): AppState {
  return state;
}

/**
 * Holatni yangilaydi. `patch` — yoki qisman obyekt, yoki joriy holatdan
 * qisman obyekt qaytaruvchi funksiya.
 */
export function setState(
  patch: Partial<AppState> | ((prev: AppState) => Partial<AppState>),
): void {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  persist();
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Holat o'zgarishini kuzatish (React'dan tashqarida — masalan sinxronizatsiya). */
export function subscribeState(listener: () => void): () => void {
  return subscribe(listener);
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

export function updateSettings(patch: Partial<Settings>): void {
  setState((prev) => ({ settings: { ...prev.settings, ...patch } }));
}

/** Barcha ma'lumotni JSON sifatida qaytaradi (zaxira nusxa uchun). */
export function exportState(): string {
  return JSON.stringify(state, null, 2);
}

/** JSON zaxira nusxadan tiklaydi. Xato bo'lsa `false` qaytaradi. */
export function importState(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as Partial<AppState>;
    if (!parsed || typeof parsed !== 'object') return false;
    state = {
      ...structuredClone(EMPTY_STATE),
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
    };
    persist();
    listeners.forEach((l) => l());
    return true;
  } catch {
    return false;
  }
}

export function resetState(): void {
  state = structuredClone(EMPTY_STATE);
  persist();
  listeners.forEach((l) => l());
}
