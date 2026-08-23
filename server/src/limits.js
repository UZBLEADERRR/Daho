/*
 * Yuk boshqaruvi — 1000 foydalanuvchini xotirjam koʻtarish uchun.
 *
 * Uchta muammo hal qilinadi:
 *
 * 1. HAR soʻrovda tokenni Supabase’dan tekshirish. 1000 odam ishlaganda
 *    bu GoTrue’ga minutiga minglab soʻrov demakdir va u birinchi boʻlib
 *    tiqiladi. Token oʻzgarmaydi — shuning uchun tekshiruv natijasi
 *    keshlanadi (tokenning oʻz muddatidan oshmaydi).
 *
 * 2. Bitta foydalanuvchi butun serverni band qilib qoʻyishi. Har kimga
 *    bir vaqtda nechta soʻrov yuborish mumkinligi cheklanadi.
 *
 * 3. Umumiy oqim. Provayderga bir vaqtda ochiladigan ulanish soni
 *    chegaralanadi, ortiqchasi navbatda kutadi — rad etilmaydi.
 *
 * Hammasi jarayon xotirasida. Bitta Railway nusxasi uchun shu yetarli;
 * bir nechta nusxa boʻlsa Redis kerak boʻladi (izoh quyida).
 */

/* ------------------------------------------------------------------ */
/*  Token keshi                                                        */
/* ------------------------------------------------------------------ */

const tokenCache = new Map();
/*
 * Ayni damda tekshirilayotgan tokenlar.
 *
 * Ilova ochilganda bir necha soʻrov birdan ketadi va hammasi bir xil
 * token bilan keladi. Usiz har biri alohida Supabase’ga borardi —
 * aynan eng gavjum daqiqada. Endi birinchisi soʻraydi, qolganlari
 * oʻsha javobni kutadi.
 */
const inFlight = new Map();
const TOKEN_TTL = 5 * 60_000;
const TOKEN_CACHE_MAX = 5000;

/** JWT ichidagi `sub` va `exp` — imzo tekshirilmaydi, faqat muddat uchun. */
function peek(token) {
  try {
    const body = token.split('.')[1];
    const json = Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const data = JSON.parse(json);
    return { sub: data.sub, exp: Number(data.exp ?? 0) * 1000 };
  } catch {
    return null;
  }
}

/**
 * Tokenni tekshiradi — natija keshlanadi.
 *
 * Natija `{ user, sabab }`: nosozlik boʻlsa SABABI ham qaytadi. Ilgari
 * faqat `null` qaytardi va panelda hamma nosozlik «sessiya muddati
 * tugagan» boʻlib koʻrinardi — hatto kalit notoʻgʻri boʻlganda ham.
 *
 * @param {string} token
 * @param {(t: string) => Promise<{user: object|null, sabab?: string}>} verify
 */
export async function cachedUser(token, verify) {
  if (!token) return { user: null, sabab: 'token yoʻq' };

  const hit = tokenCache.get(token);
  if (hit && hit.until > Date.now()) return { user: hit.user };

  // Muddati oʻtgan token uchun tarmoqqa chiqmaymiz.
  const claims = peek(token);
  if (claims?.exp && claims.exp < Date.now()) {
    tokenCache.delete(token);
    return { user: null, sabab: 'muddati oʻtgan' };
  }

  const pending = inFlight.get(token);
  const out = pending
    ? await pending
    : await (() => {
        const task = verify(token).finally(() => inFlight.delete(token));
        inFlight.set(token, task);
        return task;
      })();
  if (!out?.user) return { user: null, sabab: out?.sabab ?? 'tekshiruvdan oʻtmadi' };

  // Xotira cheksiz oʻsmasin — eng eskisi chiqib ketadi.
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    tokenCache.delete(tokenCache.keys().next().value);
  }
  const until = Math.min(Date.now() + TOKEN_TTL, claims?.exp || Date.now() + TOKEN_TTL);
  tokenCache.set(token, { user: out.user, until });
  return { user: out.user };
}

/** Foydalanuvchi chiqqanda yoki bloklanganda keshni tozalash. */
export function forgetToken(token) {
  tokenCache.delete(token);
}

/* ------------------------------------------------------------------ */
/*  Tezlik chegarasi                                                   */
/* ------------------------------------------------------------------ */

const buckets = new Map();

/**
 * «Token bucket» — daqiqasiga N soʻrov, qisqa portlashlarga ruxsat.
 *
 * @returns {{ok: boolean, retryAfter: number}}
 */
export function rateLimit(key, perMinute = 60, burst = 20) {
  const now = Date.now();
  const rate = perMinute / 60_000;
  const found = buckets.get(key) ?? { tokens: burst, at: now };

  found.tokens = Math.min(burst, found.tokens + (now - found.at) * rate);
  found.at = now;

  if (found.tokens < 1) {
    buckets.set(key, found);
    return { ok: false, retryAfter: Math.ceil((1 - found.tokens) / rate / 1000) };
  }

  found.tokens -= 1;
  buckets.set(key, found);
  return { ok: true, retryAfter: 0 };
}

// Uzoq jim turgan kalitlar xotirada qolmasin.
setInterval(() => {
  const chegara = Date.now() - 10 * 60_000;
  for (const [key, value] of buckets) {
    if (value.at < chegara) buckets.delete(key);
  }
  for (const [key, value] of tokenCache) {
    if (value.until < Date.now()) tokenCache.delete(key);
  }
}, 60_000).unref?.();

/* ------------------------------------------------------------------ */
/*  Navbat                                                             */
/* ------------------------------------------------------------------ */

/**
 * Bir vaqtda ochiq soʻrovlar soni cheklanadi.
 *
 * Nega rad etmaymiz: AI soʻrovi uzoq (10–60 s). Yuk koʻtarilganda
 * «keyinroq urining» deyish oʻrniga bir necha soniya kutish yaxshiroq —
 * foydalanuvchi farqni sezmaydi, server esa tiqilmaydi.
 */
export function createGate({ max = 24, perUser = 3, maxWaitMs = 30_000 } = {}) {
  let active = 0;
  const perUserActive = new Map();
  const waiting = [];

  const bosh = () => {
    while (waiting.length && active < max) {
      const next = waiting.findIndex((w) => (perUserActive.get(w.user) ?? 0) < perUser);
      if (next < 0) return;
      const [job] = waiting.splice(next, 1);
      clearTimeout(job.timer);
      active += 1;
      perUserActive.set(job.user, (perUserActive.get(job.user) ?? 0) + 1);
      job.resolve(() => {
        active -= 1;
        const left = (perUserActive.get(job.user) ?? 1) - 1;
        if (left <= 0) perUserActive.delete(job.user);
        else perUserActive.set(job.user, left);
        bosh();
      });
    }
  };

  return {
    /** Ruxsat kutadi. Qaytgan funksiya — ish tugaganda chaqiriladi. */
    enter(user) {
      const mine = perUserActive.get(user) ?? 0;
      if (active < max && mine < perUser) {
        active += 1;
        perUserActive.set(user, mine + 1);
        return Promise.resolve(() => {
          active -= 1;
          const left = (perUserActive.get(user) ?? 1) - 1;
          if (left <= 0) perUserActive.delete(user);
          else perUserActive.set(user, left);
          bosh();
        });
      }

      return new Promise((resolve, reject) => {
        const job = { user, resolve, reject, timer: null };
        job.timer = setTimeout(() => {
          const at = waiting.indexOf(job);
          if (at >= 0) waiting.splice(at, 1);
          reject(new Error('Server hozir band — bir necha soniyadan soʻng qayta urining.'));
        }, maxWaitMs);
        /*
         * `unref()` QILINMAYDI: jarayonda boshqa ish boʻlmasa taymer
         * ishlamay qolardi va navbatdagi soʻrov abadiy kutardi.
         */
        waiting.push(job);
      });
    },

    stats() {
      return { active, waiting: waiting.length, users: perUserActive.size, max, perUser };
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Qisqa muddatli kesh                                                */
/* ------------------------------------------------------------------ */

/**
 * Bir xil javob qaytaradigan soʻrovlar uchun (masalan `resolve_model`).
 * Bazaga har safar bormaslik — 1000 foydalanuvchida sezilarli farq.
 */
export function createCache(ttlMs = 60_000, max = 500) {
  const store = new Map();
  return {
    async get(key, make) {
      const hit = store.get(key);
      if (hit && hit.until > Date.now()) return hit.value;
      const value = await make();
      if (store.size >= max) store.delete(store.keys().next().value);
      store.set(key, { value, until: Date.now() + ttlMs });
      return value;
    },
    clear() {
      store.clear();
    },
    size() {
      return store.size;
    },
  };
}
