/**
 * Supabase ulanishi.
 *
 * Telefonda yasalgan ilovaga haqiqiy maʼlumot bazasi kerak boʻladi:
 * roʻyxatga olish, foydalanuvchi hisobi, umumiy roʻyxatlar. localStorage bu
 * ishga yaramaydi — u faqat bitta telefonda qoladi. Supabase esa bepul,
 * REST orqali ishlaydi va brauzerdan toʻgʻridan-toʻgʻri chaqirilaveradi.
 *
 * Bu modul kutubxona qoʻshmaydi (`@supabase/supabase-js` kerak emas) —
 * Supabase ning oʻz REST (PostgREST) API si bilan ishlaydi, shuning uchun
 * ilova hajmi oshmaydi.
 *
 * Xavfsizlik: bu yerda faqat `anon` (ochiq) kalit ishlatiladi — u brauzerga
 * chiqarish uchun moʻljallangan. `service_role` kalitini HECH QACHON
 * kiritmaslik kerak; jadvallarni RLS (Row Level Security) bilan himoyalash
 * Supabase tomonida qilinadi.
 */

import { getState, updateSettings } from './store';

export interface SupabaseLink {
  /** https://xxxx.supabase.co */
  url: string;
  /** Ochiq (anon) kalit */
  anonKey: string;
}

export function supabaseLink(): SupabaseLink | null {
  const { settings } = getState();
  const url = settings.supabaseUrl?.trim();
  const anonKey = settings.supabaseAnonKey?.trim();
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/+$/, ''), anonKey };
}

export function setSupabase(url: string, anonKey: string): void {
  updateSettings({ supabaseUrl: url.trim(), supabaseAnonKey: anonKey.trim() });
}

class SupabaseError extends Error {}

function requireLink(): SupabaseLink {
  const link = supabaseLink();
  if (!link) {
    throw new SupabaseError(
      'Supabase ulanmagan. Sozlamalar → Supabase boʻlimiga loyiha manzili va ' +
        'anon kalitini kiriting.',
    );
  }
  return link;
}

function headers(link: SupabaseLink, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: link.anonKey,
    Authorization: `Bearer ${link.anonKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(body);
    return parsed?.message ?? parsed?.error ?? parsed?.hint ?? body.slice(0, 300);
  } catch {
    return body.slice(0, 300) || `HTTP ${res.status}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Jadval bilan ishlash (PostgREST)                                   */
/* ------------------------------------------------------------------ */

export interface SelectOptions {
  /** Qaysi ustunlar; boʻsh boʻlsa hammasi */
  columns?: string;
  /** `ustun=eq.qiymat` koʻrinishidagi filtrlar */
  filter?: string;
  /** `ustun.asc` yoki `ustun.desc` */
  order?: string;
  limit?: number;
}

/** Jadvaldan yozuvlarni oʻqiydi. */
export async function sbSelect(
  table: string,
  opts: SelectOptions = {},
): Promise<Array<Record<string, unknown>>> {
  const link = requireLink();
  const url = new URL(`${link.url}/rest/v1/${encodeURIComponent(table)}`);
  url.searchParams.set('select', opts.columns?.trim() || '*');
  if (opts.order) url.searchParams.set('order', opts.order);
  if (opts.limit) url.searchParams.set('limit', String(opts.limit));
  // Filtr `ustun=eq.qiymat` shaklida keladi — bir nechtasi `&` bilan.
  for (const part of (opts.filter ?? '').split('&')) {
    const [key, ...rest] = part.split('=');
    if (key && rest.length) url.searchParams.set(key.trim(), rest.join('='));
  }

  const res = await fetch(url.toString(), { headers: headers(link) });
  if (!res.ok) throw new SupabaseError(await readError(res));
  return (await res.json()) as Array<Record<string, unknown>>;
}

/** Jadvalga yozuv qoʻshadi (bir yoki bir nechta). */
export async function sbInsert(
  table: string,
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const link = requireLink();
  const res = await fetch(`${link.url}/rest/v1/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: headers(link, { Prefer: 'return=representation' }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new SupabaseError(await readError(res));
  return (await res.json()) as Array<Record<string, unknown>>;
}

/** Filtrga mos yozuvlarni yangilaydi. */
export async function sbUpdate(
  table: string,
  filter: string,
  patch: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const link = requireLink();
  if (!filter.trim()) throw new SupabaseError('Yangilash uchun filtr shart (xato bilan hammasi oʻzgarib ketmasin).');
  const url = new URL(`${link.url}/rest/v1/${encodeURIComponent(table)}`);
  for (const part of filter.split('&')) {
    const [key, ...rest] = part.split('=');
    if (key && rest.length) url.searchParams.set(key.trim(), rest.join('='));
  }
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: headers(link, { Prefer: 'return=representation' }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new SupabaseError(await readError(res));
  return (await res.json()) as Array<Record<string, unknown>>;
}

/** Filtrga mos yozuvlarni oʻchiradi. */
export async function sbDelete(table: string, filter: string): Promise<number> {
  const link = requireLink();
  if (!filter.trim()) throw new SupabaseError('Oʻchirish uchun filtr shart.');
  const url = new URL(`${link.url}/rest/v1/${encodeURIComponent(table)}`);
  for (const part of filter.split('&')) {
    const [key, ...rest] = part.split('=');
    if (key && rest.length) url.searchParams.set(key.trim(), rest.join('='));
  }
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: headers(link, { Prefer: 'return=representation' }),
  });
  if (!res.ok) throw new SupabaseError(await readError(res));
  const rows = (await res.json()) as unknown[];
  return rows.length;
}

/* ------------------------------------------------------------------ */
/*  Sxema — qanday jadvallar bor                                       */
/* ------------------------------------------------------------------ */

export interface TableInfo {
  name: string;
  columns: Array<{ name: string; type: string; required: boolean }>;
}

/**
 * Loyihadagi jadvallar va ustunlar roʻyxati.
 *
 * PostgREST ildizda OpenAPI tavsifini beradi — undan sxemani oʻqiymiz.
 * Shu tufayli agent qanday jadval borligini bilib ishlaydi, taxmin qilmaydi.
 */
export async function sbSchema(): Promise<TableInfo[]> {
  const link = requireLink();
  const res = await fetch(`${link.url}/rest/v1/`, { headers: headers(link) });
  if (!res.ok) throw new SupabaseError(await readError(res));
  const spec = await res.json();
  const defs = spec?.definitions ?? spec?.components?.schemas ?? {};

  const out: TableInfo[] = [];
  for (const [name, raw] of Object.entries(defs as Record<string, any>)) {
    const props = raw?.properties ?? {};
    const required: string[] = raw?.required ?? [];
    out.push({
      name,
      columns: Object.entries(props).map(([col, meta]: [string, any]) => ({
        name: col,
        type: String(meta?.format ?? meta?.type ?? '?'),
        required: required.includes(col),
      })),
    });
  }
  return out;
}

/** Ulanishni sinab koʻradi. */
export async function sbPing(): Promise<{ ok: boolean; tables: number; message: string }> {
  try {
    const tables = await sbSchema();
    return {
      ok: true,
      tables: tables.length,
      message: tables.length
        ? `Ulandi — ${tables.length} ta jadval koʻrindi`
        : 'Ulandi, lekin jadval yoʻq. Supabase’da jadval yaratib, RLS siyosatini yoqing.',
    };
  } catch (err) {
    return { ok: false, tables: 0, message: String((err as Error)?.message ?? err) };
  }
}

/**
 * Jadval yaratish uchun SQL matni tayyorlaydi.
 *
 * Supabase anon kalit bilan DDL (CREATE TABLE) bajarishga ruxsat bermaydi —
 * bu toʻgʻri, aks holda kim xohlasa bazani oʻzgartirar edi. Shuning uchun
 * agent SQL ni yozib beradi, foydalanuvchi uni Supabase → SQL Editor ga
 * bir marta qoʻyadi.
 */
export function createTableSql(
  table: string,
  columns: Array<{ name: string; type: string; nullable?: boolean }>,
  publicRead = true,
): string {
  const cols = columns
    .map((c) => `  ${c.name} ${c.type}${c.nullable ? '' : ' not null'}`)
    .join(',\n');

  return `-- «${table}» jadvali
create table if not exists public.${table} (
  id bigint generated by default as identity primary key,
${cols},
  created_at timestamptz not null default now()
);

-- Qatorlar himoyasi (RLS) — Supabase’da bu SHART
alter table public.${table} enable row level security;

${
  publicRead
    ? `-- Hamma oʻqiy oladi, hamma yozadi (ochiq demo uchun).
-- Haqiqiy loyihada auth.uid() bilan cheklang!
create policy "${table}_read" on public.${table} for select using (true);
create policy "${table}_insert" on public.${table} for insert with check (true);`
    : `-- Faqat tizimga kirgan foydalanuvchi oʻz yozuvini koʻradi
create policy "${table}_own" on public.${table}
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`
}`;
}
