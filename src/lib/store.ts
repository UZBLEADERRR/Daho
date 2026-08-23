import { useSyncExternalStore } from 'react';
import { FALLBACK_MODELS } from './models';
import { idbGet, idbSet, requestPersistentStorage } from './storage';
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
  connectors: [],
  supabaseToken: '',
  googleClientId: '',
  googleRedirect: '',
  tgToken: '',
  igToken: '',
  igUserId: '',
  serverUrl: '',
  serverSecret: '',
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
    connectors: Array.isArray(saved.connectors) ? saved.connectors : [],
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

/**
 * localStorage da faqat kichik narsalar qoladi: ilova ochilishi bilanoq
 * mavzu va sozlama koʻrinsin. Ogʻir maʼlumot (suhbat, rasm, video, kitob)
 * IndexedDB da — u yerda joy yuzlab megabayt.
 */
const LIGHT_KEY = 'daho.light.v1';

interface LightState {
  settings: Settings;
  view: AppState['view'];
}

function loadLight(): AppState {
  try {
    const raw = localStorage.getItem(LIGHT_KEY);
    if (raw) {
      const light = JSON.parse(raw) as Partial<LightState>;
      return migrate({ settings: light.settings, view: light.view });
    }
    // Eski nusxa — hammasi bitta kalitda edi.
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy) return migrate(JSON.parse(legacy) as Partial<AppState>);
  } catch {
    /* buzuq boʻlsa — pastda IndexedDB dan tiklanadi */
  }
  return structuredClone(EMPTY_STATE);
}

let state: AppState = loadLight();
const listeners = new Set<() => void>();

/** Saqlash muvaffaqiyatsiz boʻlsa — foydalanuvchiga aytish uchun. */
let storageError = '';
export function getStorageError(): string {
  return storageError;
}

let hydrated = false;
export function isHydrated(): boolean {
  return hydrated;
}

/**
 * IndexedDB dan toʻliq holatni oʻqiydi. Ilova shu tugagach koʻrsatiladi,
 * aks holda hali oʻqilmagan boʻsh holat ustiga yozib yuborilardi.
 */
export async function hydrate(): Promise<void> {
  if (hydrated) return;
  try {
    const saved = await idbGet<Partial<AppState>>(STORAGE_KEY);
    if (saved) {
      state = migrate(saved);
    } else {
      // Birinchi ishga tushish yoki eski versiyadan koʻchish.
      const legacy = localStorage.getItem(STORAGE_KEY);
      if (legacy) {
        state = migrate(JSON.parse(legacy) as Partial<AppState>);
        const moved = await idbSet(STORAGE_KEY, state);
        // Koʻchirish oʻtgandagina eski kalitni boʻshatamiz.
        if (moved) localStorage.removeItem(STORAGE_KEY);
      }
    }
  } catch (err) {
    console.warn('Maʼlumotni oʻqishda xato:', err);
  }
  hydrated = true;
  void requestPersistentStorage();
  listeners.forEach((l) => l());
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function writeNow(): Promise<void> {
  // Holat oʻqilmasidan yozib yuborsak — bor maʼlumot ustiga boʻsh holat tushadi.
  if (!hydrated) return;

  // Kichik qismi localStorage ga: ilova keyingi safar darrov ochilsin.
  try {
    const light: LightState = { settings: state.settings, view: state.view };
    localStorage.setItem(LIGHT_KEY, JSON.stringify(light));
  } catch {
    /* sozlama saqlanmasa ham asosiy ombor ishlaydi */
  }

  const ok = await idbSet(STORAGE_KEY, state);
  if (ok) {
    storageError = '';
    return;
  }

  // IndexedDB ishlamadi — oxirgi chora sifatida localStorage.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageError = '';
  } catch {
    storageError =
      'Maʼlumot saqlanmadi — qurilmada joy tugagan boʻlishi mumkin. '
      + 'Sozlamalar → Maʼlumotlar boʻlimidan zaxira nusxa oling va keraksiz '
      + 'rasm/videolarni oʻchiring.';
    console.warn(storageError);
  }
  listeners.forEach((l) => l());
}

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void writeNow();
  }, 120);
}

/** Kutib turgan yozuvni darhol bajaradi. */
export function flushState(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return writeNow();
}

if (typeof document !== 'undefined') {
  // Android ilovani `beforeunload` bermay yopadi — `hidden` ishonchliroq.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushState();
  });
  window.addEventListener('pagehide', () => void flushState());
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

/**
 * Foydalanuvchi maʼlumotini tozalaydi — qurilma sozlamalari qoladi.
 *
 * NEGA KERAK: suhbatlar, loyihalar, kitoblar va konspektlar qurilmada
 * (IndexedDB) turadi. Hisobdan chiqilganda ular joyida qolardi va
 * KEYINGI odam kirganda oʻsha suhbatlarni koʻrardi. Bitta telefonni
 * ikki kishi ishlatsa — bu maʼlumot sizib chiqishi.
 *
 * Sozlamalar (mavzu, shrift, qurilmadagi kalitlar) tegilmaydi: ular
 * hisobga emas, QURILMAGA tegishli.
 */
export function clearUserData(): void {
  const settings = state.settings;
  state = { ...structuredClone(EMPTY_STATE), settings };
  persist();
  listeners.forEach((l) => l());
}

export function resetState(): void {
  state = structuredClone(EMPTY_STATE);
  persist();
  listeners.forEach((l) => l());
}
