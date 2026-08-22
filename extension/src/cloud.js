/*
 * Kengaytmadagi Daho hisobi.
 *
 * Avval kengaytma foydalanuvchidan oʻz Gemini kalitini soʻrardi — oddiy
 * foydalanuvchi buni qila olmaydi. Endi ilovadagi hisob bilan kiriladi va
 * soʻrovlar server orqali oʻtadi: tarif, limit va sarf oʻsha yerda
 * hisoblanadi.
 *
 * Kengaytmaga hech qanday manzil yozilmaydi: u Daho serveridan
 * `/api/public-config` ni soʻrab, qayerga kirishni oʻzi biladi.
 */

const CONFIG_TTL = 10 * 60 * 1000;
let configCache = null;

/** Server manzili — Sozlamalarda allaqachon bor. */
async function serverUrl() {
  const s = await chrome.storage.local.get('serverUrl');
  return (s.serverUrl ?? '').replace(/\/+$/, '');
}

/** Supabase manzili va ochiq kaliti — serverdan olinadi. */
export async function cloudConfig() {
  if (configCache && Date.now() - configCache.at < CONFIG_TTL) return configCache.value;

  const base = await serverUrl();
  if (!base) return null;

  try {
    const res = await fetch(`${base}/api/public-config`);
    if (!res.ok) return null;
    const value = await res.json();
    if (!value?.supabaseUrl || !value?.supabaseAnonKey) return null;
    configCache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Sessiya                                                            */
/* ------------------------------------------------------------------ */

export async function session() {
  const s = await chrome.storage.local.get('cloudSession');
  return s.cloudSession ?? null;
}

async function save(value) {
  if (value) await chrome.storage.local.set({ cloudSession: value });
  else await chrome.storage.local.remove('cloudSession');
}

function adopt(data) {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    email: data.user?.email ?? '',
  };
}

const MESSAGES = [
  [/invalid login credentials/i, 'Pochta yoki parol notoʻgʻri.'],
  [/email not confirmed/i, 'Pochtangiz hali tasdiqlanmagan.'],
  [/rate limit|too many/i, 'Juda koʻp urinish. Biroz kuting.'],
];

async function readError(res) {
  const body = await res.text().catch(() => '');
  let raw = body.slice(0, 200);
  try {
    const parsed = JSON.parse(body);
    raw = parsed?.error_description ?? parsed?.msg ?? parsed?.message ?? raw;
  } catch {
    /* matn holicha */
  }
  for (const [pattern, text] of MESSAGES) if (pattern.test(raw)) return text;
  return raw || 'Nomaʼlum xato.';
}

export async function signIn(email, password) {
  const cfg = await cloudConfig();
  if (!cfg) throw new Error('Avval Sozlamalarda Daho serveri manzilini kiriting.');

  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  if (!res.ok) throw new Error(await readError(res));

  const next = adopt(await res.json());
  await save(next);
  return next;
}

export async function signOut() {
  await save(null);
}

/** Amaldagi token; muddati tugayotgan boʻlsa yangilaydi. */
export async function accessToken() {
  const s = await session();
  if (!s) return null;
  if (Date.now() < s.expiresAt - 60_000) return s.accessToken;

  const cfg = await cloudConfig();
  if (!cfg) return null;

  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: s.refreshToken }),
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) await save(null);
    return null;
  }
  const next = adopt(await res.json());
  await save(next);
  return next.accessToken;
}

/* ------------------------------------------------------------------ */
/*  Hisob holati                                                       */
/* ------------------------------------------------------------------ */

/** Reja, limit va ochiq modellar. */
export async function account() {
  const cfg = await cloudConfig();
  const token = await accessToken();
  if (!cfg || !token) return null;

  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/my_account`, {
    method: 'POST',
    headers: {
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) return null;
  return res.json();
}

/** Foizli limitlar — foydalanuvchiga token soni koʻrsatilmaydi. */
export async function limits() {
  const cfg = await cloudConfig();
  const token = await accessToken();
  if (!cfg || !token) return null;

  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/usage_windows`, {
    method: 'POST',
    headers: {
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Model soʻrovi. Hisobga kirilgan boʻlsa server orqali (tarif bilan),
 * boʻlmasa foydalanuvchining oʻz kaliti bilan.
 */
export async function aiFetch(path, body, ownKey, query = {}) {
  const cfg = await cloudConfig();
  const token = await accessToken();

  if (cfg && token) {
    const url = new URL(`${cfg.gateway || `${cfg.supabaseUrl}/functions/v1/ai-gateway`}/v1beta${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: cfg.supabaseAnonKey,
      },
      body: JSON.stringify(body),
    });
  }

  if (!ownKey) {
    throw new Error('Daho hisobingizga kiring yoki Sozlamalarda kalit kiriting.');
  }

  const url = new URL(`https://generativelanguage.googleapis.com/v1beta${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ownKey },
    body: JSON.stringify(body),
  });
}
