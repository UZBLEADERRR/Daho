import { useSyncExternalStore } from 'react';
import type { AppState, Settings } from './types';

const STORAGE_KEY = 'daho.state.v1';

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'gemini-2.5-flash',
  imageModel: 'gemini-2.5-flash-image',
  theme: 'tun',
  temperature: 0.8,
  autoSpeak: false,
  ttsLang: 'uz-UZ',
  ttsRate: 1,
  ttsVoiceUri: '',
  sttLang: 'uz-UZ',
  userName: '',
  university: '',
  customInstructions: '',
};

const EMPTY_STATE: AppState = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  chats: [],
  activeChatId: null,
  artifacts: [],
  notes: [],
  tasks: [],
  projects: [],
  schedule: [],
  timeLogs: [],
};

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(EMPTY_STATE);
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      ...structuredClone(EMPTY_STATE),
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
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
