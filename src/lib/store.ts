import { useSyncExternalStore } from 'react';
import { FALLBACK_MODELS } from './models';
import type { AppState, Settings } from './types';

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
  supabaseUrl: '',
  supabaseAnonKey: '',
  publishDomain: '',
  aiSource: 'auto',
  cloudBackup: true,
  userName: '',
  university: '',
  customInstructions: '',
  providers: [],
  hiddenModels: [],
  favoriteModels: [],
  roleModels: { bosh: '', dizayn: '', kod: '', tekshir: '', matn: '' },
  autoContinue: true,
  maxContinues: 6,
  agentRounds: 60,
  autoPickModel: true,
  autoPool: [],
  memoryEnabled: true,
  freeOnly: false,
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
  automations: [],
  memories: [],
  view: { tab: 'chat', section: 'bugun', courseId: null, bookId: null, codeId: null },
};

/** Eski saqlangan holatdagi ishlamay qolgan model nomlarini tozalaydi. */
const RETIRED_MODELS = /^(gemini-1\.|gemini-2\.0|gemini-2\.5-(flash|pro)$)/;

/** Saqlangan holatni bugungi sxemaga keltiradi (eski nusxalar uchun). */
function migrate(parsed: Partial<AppState>): AppState {
  const saved: Partial<Settings> = parsed.settings ?? {};
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    // Ichma-ich obyektlar: yangi maydonlar qoʻshilganda yoʻqolib qolmasin.
    roleModels: { ...DEFAULT_SETTINGS.roleModels, ...(saved.roleModels ?? {}) },
    providers: Array.isArray(saved.providers) ? saved.providers : [],
    hiddenModels: Array.isArray(saved.hiddenModels) ? saved.hiddenModels : [],
    autoPool: Array.isArray(saved.autoPool) ? saved.autoPool : [],
    favoriteModels: Array.isArray(saved.favoriteModels) ? saved.favoriteModels : [],
  };
  if (RETIRED_MODELS.test(settings.model)) settings.model = DEFAULT_SETTINGS.model;

  return {
    ...structuredClone(EMPTY_STATE),
    ...parsed,
    settings,
    books: Array.isArray(parsed.books) ? parsed.books : [],
    memories: Array.isArray(parsed.memories) ? parsed.memories : [],
    automations: Array.isArray(parsed.automations) ? parsed.automations : [],
    view: { ...EMPTY_STATE.view, ...(parsed.view ?? {}) },
  };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(EMPTY_STATE);
    return migrate(JSON.parse(raw) as Partial<AppState>);
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

/** Koʻrinish holati — qaysi bo'lim ochiq (sahifa almashganda yoʻqolmaydi). */
export function updateView(patch: Partial<AppState['view']>): void {
  setState((prev) => ({ view: { ...prev.view, ...patch } }));
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
    state = migrate(parsed);
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
