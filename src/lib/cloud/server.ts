/*
 * Daho serveri (Railway) bilan bogʻlanish.
 *
 * Nega kerak: Supabase Edge funksiyalari qisqa vaqtga moʻljallangan va
 * ularni kimdir turtib turishi kerak. Railway dagi server esa DOIM ishlab
 * turadi — navbatni oʻzi tekshiradi, uzun ishlarni (kitob boblari) oxiriga
 * yetkazadi va telefon oʻchiq boʻlsa ham davom etadi.
 *
 * Bundan tashqari serverda haqiqiy terminal bor: Daho Code `npm`, `node`,
 * `python`, `git` ni ishlata oladi — brauzerning oʻzida bu mumkin emas.
 */

import { getState } from '../store';
import { accessToken } from './client';

export interface ServerHealth {
  ok: boolean;
  worker?: {
    picked: number;
    done: number;
    failed: number;
    lastRun: string | null;
    lastError: string | null;
    polling: boolean;
    busy: boolean;
  };
  yetishmayapti?: string[];
  terminal?: boolean;
}

export interface CommandResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  dir?: string;
}

function baseUrl(): string {
  return (getState().settings.serverUrl ?? '').trim().replace(/\/+$/, '');
}

/** Server sozlanganmi. */
export function serverReady(): boolean {
  return /^https?:\/\//i.test(baseUrl());
}

async function headers(): Promise<Record<string, string>> {
  const out: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = (getState().settings.serverSecret ?? '').trim();
  if (secret) out['x-worker-secret'] = secret;
  const token = await accessToken().catch(() => '');
  if (token) out.Authorization = `Bearer ${token}`;
  return out;
}

async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  if (!serverReady()) throw new Error('Server manzili kiritilmagan.');
  const res = await fetch(`${baseUrl()}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: await headers(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error ?? `Server xatosi (${res.status})`);
  return data;
}

/** Server tirikmi va nima sozlanmaganini aytadi. */
export function serverHealth(signal?: AbortSignal): Promise<ServerHealth> {
  return call<ServerHealth>('/health', undefined, signal);
}

/** Fon vazifasini navbatga qoʻyadi — telefon oʻchsa ham bajariladi. */
export function enqueueOnServer(
  kind: string,
  title: string,
  payload: Record<string, unknown>,
  model?: string,
): Promise<{ job: { id: string; status: string } }> {
  return call('/jobs', { kind, title, payload, model });
}

/** Vazifa holatini soʻraydi. */
export function jobStatus(id: string): Promise<{ job: Record<string, unknown> }> {
  return call(`/jobs/${encodeURIComponent(id)}`);
}

/** Navbatni darhol tekshirishga majburlaydi. */
export function pokeServer(limit = 3): Promise<Record<string, unknown>> {
  return call('/tick', { limit });
}

/**
 * Serverda buyruq bajaradi — Daho Code uchun haqiqiy terminal.
 * Server sozlamalarida ENABLE_SHELL=1 boʻlishi kerak.
 */
export function runOnServer(
  command: string,
  opts: { cwd?: string; timeout?: number; signal?: AbortSignal } = {},
): Promise<CommandResult> {
  return call<CommandResult>(
    '/run',
    { command, cwd: opts.cwd, timeout: opts.timeout },
    opts.signal,
  );
}
