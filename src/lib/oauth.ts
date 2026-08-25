/*
 * Ulanish — token oʻrniga tugma.
 *
 * Oddiy foydalanuvchi GitHub’da Personal Access Token yasashni bilmaydi
 * va bilishi shart emas. Shuning uchun endi u xizmat sahifasida bir
 * marta «ruxsat beraman» deydi, qolganini Daho serveri qiladi: mijoz
 * siri (client secret) faqat oʻsha yerda turadi.
 *
 * Qaytish manzili bitta: <server>/oauth/callback. Xizmat sozlamasida
 * roʻyxatdan oʻtkaziladigan yagona manzil shu.
 */

import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { SERVER_URL } from './cloud/config';
import { getState, updateSettings } from './store';

export type OauthProvider = 'github' | 'supabase' | 'google';

export interface ProviderInfo {
  label: string;
  client_id: string;
  scope: string;
  pkce: boolean;
  ready: boolean;
  redirect_uri: string;
  env: string[];
}

interface PublicConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  gateway?: string;
  server?: string;
  oauth?: Record<string, ProviderInfo>;
}

/* ------------------------------------------------------------------ */
/*  Server sozlamasi                                                   */
/* ------------------------------------------------------------------ */

let cached: PublicConfig | null = null;
let loading: Promise<PublicConfig> | null = null;

function base(): string {
  const manual = (getState().settings.serverUrl ?? '').trim().replace(/\/+$/, '');
  return manual || SERVER_URL;
}

/** Serverning ochiq sozlamasi (bir marta olinadi). */
export async function publicConfig(): Promise<PublicConfig> {
  if (cached) return cached;
  if (loading) return loading;
  const root = base();
  if (!root) return {};

  loading = (async () => {
    try {
      const res = await fetch(`${root}/api/public-config`);
      cached = res.ok ? ((await res.json()) as PublicConfig) : {};
    } catch {
      cached = {};
    } finally {
      loading = null;
    }
    return cached ?? {};
  })();
  return loading;
}

/** Qaysi xizmatlarga ulanish mumkin. */
export async function connectable(): Promise<Record<string, ProviderInfo>> {
  return (await publicConfig()).oauth ?? {};
}

/** Xizmat ulanganmi (token bormi). */
export function connected(provider: OauthProvider): boolean {
  const { settings } = getState();
  if (provider === 'github') return Boolean(settings.githubToken);
  if (provider === 'supabase') return Boolean(settings.supabaseToken);
  return Boolean(settings.googleAuth?.accessToken);
}

/** Ulanishni uzadi — token oʻchiriladi. */
export function disconnect(provider: OauthProvider): void {
  if (provider === 'github') updateSettings({ githubToken: '' });
  else if (provider === 'supabase') updateSettings({ supabaseToken: '' });
  else updateSettings({ googleAuth: undefined });
}

/* ------------------------------------------------------------------ */
/*  PKCE                                                               */
/* ------------------------------------------------------------------ */

const VERIFIER_KEY = 'daho.oauth.verifier';
const PROVIDER_KEY = 'daho.oauth.provider';

function randomString(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Ulanish                                                            */
/* ------------------------------------------------------------------ */

/**
 * Ulanishni boshlaydi.
 *
 * Vebda shu oynada xizmat sahifasiga oʻtiladi va qaytgach
 * `finishConnect()` ishlaydi. Telefonda tizim brauzeri ochiladi va
 * natija deep link bilan qaytadi.
 */
export async function startConnect(provider: OauthProvider): Promise<void> {
  const root = base();
  if (!root) {
    throw new Error(
      'Daho serveri topilmadi. Ilovani Railway manzilidan oching yoki Sozlamalarda server manzilini kiriting.',
    );
  }

  const info = (await connectable())[provider];
  if (info && !info.ready) {
    throw new Error(`${info.label} ulanishi hali sozlanmagan (server: ${info.env.join(', ')}).`);
  }

  const verifier = randomString();
  // localStorage: telefonda ilova fonga tushadi, sessionStorage yoʻqolishi mumkin.
  localStorage.setItem(VERIFIER_KEY, verifier);
  localStorage.setItem(PROVIDER_KEY, provider);

  const params = new URLSearchParams({ challenge: await challengeOf(verifier) });
  if (!isNative()) {
    const { origin, pathname } = window.location;
    params.set('back', `${origin}${pathname}`.replace(/\/index\.html$/, '/'));
  }

  const url = `${root}/api/oauth/start/${provider}?${params}`;

  if (isNative()) {
    await Browser.open({ url });
    return;
  }
  window.location.href = url;
}

/** Kodni tokenga almashtirib saqlaydi. */
async function saveCode(provider: OauthProvider, code: string): Promise<string> {
  const verifier = localStorage.getItem(VERIFIER_KEY) ?? '';
  const res = await fetch(`${base()}/api/oauth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, code, verifier }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error ?? 'Token olinmadi');
  }

  localStorage.removeItem(VERIFIER_KEY);
  localStorage.removeItem(PROVIDER_KEY);

  if (provider === 'github') {
    updateSettings({ githubToken: data.access_token });
  } else if (provider === 'supabase') {
    updateSettings({ supabaseToken: data.access_token });
  } else {
    updateSettings({
      googleAuth: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? '',
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      },
    });
  }
  return provider;
}

/**
 * Sahifa ochilganda chaqiriladi: manzilda `?code=` boʻlsa ulanishni
 * yakunlaydi. Qaytgan qiymat — ulangan xizmat nomi yoki boʻsh satr.
 */
export async function finishConnect(): Promise<string> {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return '';

  const provider = (params.get('provider') ||
    localStorage.getItem(PROVIDER_KEY) ||
    '') as OauthProvider;
  if (!provider) return '';

  try {
    const done = await saveCode(provider, code);
    return done;
  } finally {
    // Manzilni tozalaymiz — kod tarixda qolmasin.
    params.delete('code');
    params.delete('provider');
    params.delete('state');
    const rest = params.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${rest ? `?${rest}` : ''}`,
    );
  }
}

/** Telefonda deep link bilan qaytganda ishlaydi. */
export function listenDeepLink(onDone: (provider: string) => void): void {
  if (!isNative()) return;
  void CapApp.addListener('appUrlOpen', ({ url }) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    const code = parsed.searchParams.get('code');
    if (!code) return;
    const provider = (parsed.searchParams.get('provider') ||
      localStorage.getItem(PROVIDER_KEY) ||
      '') as OauthProvider;
    if (!provider) return;
    void Browser.close().catch(() => undefined);
    void saveCode(provider, code)
      .then(onDone)
      .catch(() => undefined);
  });
}
