/**
 * Mahalliy holatni Supabase bilan sinxronlaydi.
 *
 * Qoida: telefon/brauzerdagi nusxa asosiy manba bo'lib qoladi (ilova
 * internetsiz ham to'liq ishlaydi), bulut esa zaxira va qurilmalar orasidagi
 * ko'prik. Har bir element (suhbat, konspekt, vazifa...) alohida satr;
 * kim keyin yozgan bo'lsa — o'sha qoladi (server vaqti bo'yicha).
 */
import { getState, setState, subscribeState } from '../store';
import type { AppState, Settings } from '../types';
import { supa } from './client';
import { cloudEnabled } from './config';
import { accountSnapshot } from './account';

const COLLECTIONS = [
  'chats',
  'artifacts',
  'notes',
  'tasks',
  'projects',
  'schedule',
  'timeLogs',
  'apps',
  'courses',
  'videos',
  'code',
  'routes',
] as const;

type Collection = (typeof COLLECTIONS)[number];

/** Qurilmada qoladigan maxfiy sozlamalar — bulutga hech qachon ketmaydi. */
const DEVICE_ONLY: Array<keyof Settings> = ['apiKey', 'githubToken', 'connectors', 'serverSecret', 'supabaseToken', 'googleAuth', 'googleRedirect', 'igToken', 'tgToken'];

/** Bitta element uchun chegara — juda katta video/rasm bulutga chiqmaydi. */
const MAX_ITEM_BYTES = 1_200_000;
/** Bitta so'rovdagi umumiy hajm. */
const MAX_BATCH_BYTES = 2_500_000;

const SHADOW_KEY = 'daho.sync.v1';

interface Shadow {
  userId: string;
  cursor: string;
  items: Record<string, string>; // "collection:id" -> hash
}

function emptyShadow(userId: string): Shadow {
  return { userId, cursor: '1970-01-01T00:00:00.000Z', items: {} };
}

function readShadow(userId: string): Shadow {
  try {
    const raw = localStorage.getItem(SHADOW_KEY);
    if (!raw) return emptyShadow(userId);
    const parsed = JSON.parse(raw) as Shadow;
    if (parsed.userId !== userId) return emptyShadow(userId);
    return { ...emptyShadow(userId), ...parsed };
  } catch {
    return emptyShadow(userId);
  }
}

function writeShadow(shadow: Shadow): void {
  try {
    localStorage.setItem(SHADOW_KEY, JSON.stringify(shadow));
  } catch {
    /* xotira to'lgan — keyingi safar yoziladi */
  }
}

/** Tez va yengil xesh (FNV-1a) — element o'zgarganini bilish uchun. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + text.length.toString(36);
}

/* ---------------------------------------------------------------- holat */

export type SyncPhase = 'off' | 'kutmoqda' | 'ishlamoqda' | 'xato';

export interface SyncState {
  phase: SyncPhase;
  lastAt: number;
  error: string;
  /** Hajmi katta bo'lgani uchun bulutga chiqmagan elementlar soni */
  skipped: number;
  pushed: number;
  pulled: number;
}

let syncState: SyncState = { phase: 'off', lastAt: 0, error: '', skipped: 0, pushed: 0, pulled: 0 };
const syncListeners = new Set<() => void>();

function setSync(patch: Partial<SyncState>): void {
  syncState = { ...syncState, ...patch };
  syncListeners.forEach((l) => l());
}

export function getSyncState(): SyncState {
  return syncState;
}

export function subscribeSync(listener: () => void): () => void {
  syncListeners.add(listener);
  return () => syncListeners.delete(listener);
}

/* ---------------------------------------------------------------- yuborish */

interface Row {
  user_id: string;
  collection: string;
  item_id: string;
  payload: unknown;
  deleted: boolean;
  device: string;
}

function deviceTag(): string {
  return navigator.userAgent.includes('Android') ? 'android' : 'web';
}

function localItems(state: AppState): Map<string, { collection: Collection; item: unknown; json: string }> {
  const map = new Map<string, { collection: Collection; item: unknown; json: string }>();
  for (const collection of COLLECTIONS) {
    const list = (state[collection] ?? []) as Array<{ id?: string }>;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item?.id) continue;
      map.set(`${collection}:${item.id}`, {
        collection,
        item,
        json: JSON.stringify(item),
      });
    }
  }
  return map;
}

function shareableSettings(settings: Settings): Partial<Settings> {
  const copy: Record<string, unknown> = { ...settings };
  for (const key of DEVICE_ONLY) delete copy[key as string];
  return copy as Partial<Settings>;
}

async function push(userId: string, shadow: Shadow): Promise<void> {
  const sb = supa();
  if (!sb) return;

  const state = getState();
  const items = localItems(state);
  const rows: Row[] = [];
  let skipped = 0;

  for (const [key, entry] of items) {
    if (entry.json.length > MAX_ITEM_BYTES) {
      skipped += 1;
      continue;
    }
    const next = hash(entry.json);
    if (shadow.items[key] === next) continue;
    rows.push({
      user_id: userId,
      collection: entry.collection,
      item_id: key.slice(entry.collection.length + 1),
      payload: entry.item,
      deleted: false,
      device: deviceTag(),
    });
  }

  // Mahalliy o'chirilganlar — bulutda ham o'chsin.
  for (const key of Object.keys(shadow.items)) {
    if (items.has(key) || key.startsWith('settings:')) continue;
    const index = key.indexOf(':');
    rows.push({
      user_id: userId,
      collection: key.slice(0, index),
      item_id: key.slice(index + 1),
      payload: null,
      deleted: true,
      device: deviceTag(),
    });
  }

  // Sozlamalar (maxfiylarsiz).
  const settingsJson = JSON.stringify(shareableSettings(state.settings));
  const settingsHash = hash(settingsJson);
  if (shadow.items['settings:me'] !== settingsHash) {
    rows.push({
      user_id: userId,
      collection: 'settings',
      item_id: 'me',
      payload: JSON.parse(settingsJson),
      deleted: false,
      device: deviceTag(),
    });
  }

  setSync({ skipped });
  if (!rows.length) return;

  // Bo'laklarga bo'lib yuboramiz — bitta so'rov juda katta bo'lmasin.
  let batch: Row[] = [];
  let bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const { error } = await sb.from('sync_items').upsert(batch, {
      onConflict: 'user_id,collection,item_id',
    });
    if (error) throw new Error(error.message);
    for (const row of batch) {
      const key = `${row.collection}:${row.item_id}`;
      if (row.deleted) delete shadow.items[key];
      else shadow.items[key] = hash(JSON.stringify(row.payload));
    }
    setSync({ pushed: syncState.pushed + batch.length });
    batch = [];
    bytes = 0;
  };

  for (const row of rows) {
    const size = row.payload ? JSON.stringify(row.payload).length : 64;
    if (batch.length >= 40 || bytes + size > MAX_BATCH_BYTES) await flush();
    batch.push(row);
    bytes += size;
  }
  await flush();
}

/* ---------------------------------------------------------------- olish */

interface RemoteRow {
  collection: string;
  item_id: string;
  payload: Record<string, unknown> | null;
  deleted: boolean;
  updated_at: string;
}

/**
 * Mahalliy tomonda oʻzgargan, lekin hali yuborilmagan elementlar.
 * Bulutdagi eski nusxa ularni bosib ketmasligi kerak.
 */
function dirtyKeys(shadow: Shadow): Set<string> {
  const dirty = new Set<string>();
  for (const [key, entry] of localItems(getState())) {
    if (shadow.items[key] && shadow.items[key] !== hash(entry.json)) dirty.add(key);
  }
  return dirty;
}

function applyRemote(rows: RemoteRow[], shadow: Shadow): number {
  if (!rows.length) return 0;

  const state = getState();
  const patch: Partial<AppState> = {};
  const buckets = new Map<Collection, Array<{ id?: string }>>();
  const dirty = dirtyKeys(shadow);
  let settingsPatch: Partial<Settings> | null = null;

  for (const row of rows) {
    if (row.collection === 'settings') {
      const localSettings = hash(JSON.stringify(shareableSettings(state.settings)));
      const settingsDirty =
        Boolean(shadow.items['settings:me']) && shadow.items['settings:me'] !== localSettings;
      if (row.payload && !row.deleted && !settingsDirty) {
        settingsPatch = { ...(row.payload as Partial<Settings>) };
        for (const key of DEVICE_ONLY) delete settingsPatch[key];
        shadow.items['settings:me'] = hash(JSON.stringify(row.payload));
      }
      continue;
    }

    const collection = row.collection as Collection;
    if (!COLLECTIONS.includes(collection)) continue;
    // Bu yerda mahalliy oʻzgarish bor — u ustun turadi va keyin yuboriladi.
    if (dirty.has(`${collection}:${row.item_id}`)) continue;

    if (!buckets.has(collection)) {
      buckets.set(collection, [...((state[collection] ?? []) as Array<{ id?: string }>)]);
    }
    const list = buckets.get(collection)!;
    const at = list.findIndex((x) => x?.id === row.item_id);
    const key = `${collection}:${row.item_id}`;

    if (row.deleted) {
      if (at >= 0) list.splice(at, 1);
      delete shadow.items[key];
      continue;
    }
    if (!row.payload) continue;

    if (at >= 0) list[at] = row.payload as { id?: string };
    else list.push(row.payload as { id?: string });
    shadow.items[key] = hash(JSON.stringify(row.payload));
  }

  for (const [collection, list] of buckets) {
    (patch as Record<string, unknown>)[collection] = list;
  }
  if (settingsPatch) {
    patch.settings = { ...state.settings, ...settingsPatch };
  }
  if (Object.keys(patch).length) setState(patch);
  return rows.length;
}

async function pull(userId: string, shadow: Shadow): Promise<void> {
  const sb = supa();
  if (!sb) return;

  for (let page = 0; page < 40; page += 1) {
    const { data, error } = await sb
      .from('sync_items')
      .select('collection,item_id,payload,deleted,updated_at')
      .eq('user_id', userId)
      .gt('updated_at', shadow.cursor)
      .order('updated_at', { ascending: true })
      .limit(200);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RemoteRow[];
    if (!rows.length) return;

    const applied = applyRemote(rows, shadow);
    shadow.cursor = rows[rows.length - 1].updated_at;
    setSync({ pulled: syncState.pulled + applied });
    if (rows.length < 200) return;
  }
}

/* ---------------------------------------------------------------- boshqaruv */

let running = false;
let pending = false;

/** Bir marta to'liq sinxronizatsiya (avval olish, keyin yuborish). */
export async function syncNow(): Promise<void> {
  if (!cloudEnabled) return;
  const account = accountSnapshot();
  if (!account?.signed_in) return;
  if (running) {
    pending = true;
    return;
  }

  running = true;
  setSync({ phase: 'ishlamoqda', error: '' });
  const shadow = readShadow(account.user_id);

  try {
    await pull(account.user_id, shadow);
    await push(account.user_id, shadow);
    writeShadow(shadow);
    setSync({ phase: 'kutmoqda', lastAt: Date.now(), error: '' });
  } catch (err) {
    writeShadow(shadow);
    setSync({ phase: 'xato', error: String((err as Error)?.message ?? err) });
  } finally {
    running = false;
    if (pending) {
      pending = false;
      void syncNow();
    }
  }
}

let stopStore: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let started = false;

/** Sinxronizatsiyani yoqadi: o'zgarishda, vaqti-vaqti bilan va qaytganda. */
export function startSync(): void {
  if (!cloudEnabled || started) return;
  started = true;
  setSync({ phase: 'kutmoqda' });

  void syncNow();

  stopStore = subscribeState(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void syncNow(), 6000);
  });

  timer = setInterval(() => void syncNow(), 60000);
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', onVisible);
}

function onVisible(): void {
  if (document.visibilityState === 'visible') void syncNow();
}

export function stopSync(): void {
  started = false;
  stopStore?.();
  stopStore = null;
  if (timer) clearInterval(timer);
  if (debounce) clearTimeout(debounce);
  window.removeEventListener('online', syncNow);
  document.removeEventListener('visibilitychange', onVisible);
  setSync({ phase: 'off' });
}

/** Chiqishda mahalliy soyani tozalaydi (boshqa hisob aralashib ketmasin). */
export function clearSyncShadow(): void {
  try {
    localStorage.removeItem(SHADOW_KEY);
  } catch {
    /* e'tiborsiz */
  }
}
