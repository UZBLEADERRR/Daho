/*
 * Ilova maʼlumotlari uchun ombor.
 *
 * Ilgari hammasi bitta localStorage kalitiga solinardi. localStorage esa
 * ~5 MB — bitta yasalgan rasm base64 holida ~1 MB, video sahnalari esa
 * rasm ham, ovoz ham. Chegara toʻlgach `setItem` xato beradi, xato esa
 * jimgina yutilardi: ilova ishlayveradi, lekin hech narsa saqlanmaydi.
 * Foydalanuvchi chiqib kirsa — oxirgi muvaffaqiyatli saqlashdan keyingi
 * hamma narsa yoʻq.
 *
 * Endi asosiy ombor IndexedDB (yuzlab megabayt), localStorage esa faqat
 * kichik zaxira: ilova ochilishida mavzu/sozlama darrov koʻrinsin va
 * IndexedDB ishlamaydigan brauzerda ham ilova yashab qolsin.
 */

const DB_NAME = 'daho';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => done(req.result);
      req.onerror = () => done(null);
      // Boshqa oyna bazani band qilib turgan boʻlsa — kutib qolmaymiz.
      req.onblocked = () => done(null);
      setTimeout(() => done(null), 4000);
    } catch {
      done(null);
    }
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          req.onsuccess = () => resolve(req.result as T);
          req.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export function idbGet<T>(key: string): Promise<T | null> {
  return run<T>('readonly', (store) => store.get(key));
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbDelete(key: string): Promise<void> {
  await run('readwrite', (store) => store.delete(key));
}

/** Brauzer qancha joy bergani va qanchasi band — «Maʼlumotlar» boʻlimi uchun. */
export async function storageEstimate(): Promise<{ usedMb: number; quotaMb: number } | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || !est.quota) return null;
    return {
      usedMb: Math.round(((est.usage ?? 0) / 1024 / 1024) * 10) / 10,
      quotaMb: Math.round((est.quota / 1024 / 1024) * 10) / 10,
    };
  } catch {
    return null;
  }
}

/**
 * Ilova yopilganda maʼlumot oʻchib ketmasligini soʻraydi. Android va
 * brauzerlar joy tugaganda «vaqtinchalik» omborni oʻzi tozalab yuborishi
 * mumkin — bu soʻrov shuni toʻxtatadi.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
