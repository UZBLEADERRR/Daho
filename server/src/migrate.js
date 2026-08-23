/*
 * Bazani serverning oʻzi yangilaydi.
 *
 * Nega kerak: `supabase/setup.sql` 2900 qatordan oshdi. Uni Supabase
 * veb muharririga qoʻlda tashlash — ayniqsa telefonda — brauzerni
 * qotirib qoʻyadi. Shuning uchun fayl Docker tasviriga qoʻshiladi va
 * server uni oʻzi bajaradi: egasi hech nima nusxalamaydi.
 *
 * Xavfsizlik: bu yerda FAQAT tasvir ichidagi tayyor fayl bajariladi.
 * Tashqaridan SQL qabul qilinmaydi — «istalgan soʻrovni ishlat» degan
 * yoʻl yoʻq. Qoʻlda ishga tushirish esa faqat admin uchun.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from './env.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/*
 * Fayl ikki joyda boʻlishi mumkin: Docker tasvirida `/app/sql/setup.sql`,
 * ishlab chiqish paytida esa repozitoriyning `supabase/` papkasida.
 */
const JOYLAR = [
  path.join(HERE, '..', 'sql', 'setup.sql'),
  path.join(HERE, '..', '..', 'supabase', 'setup.sql'),
];

let cached = null;

/** Tayyor SQL faylini oʻqiydi va barmoq izini hisoblaydi. */
export function setupSql() {
  if (cached) return cached;
  for (const joy of JOYLAR) {
    try {
      const text = readFileSync(joy, 'utf8');
      cached = {
        text,
        hash: createHash('sha256').update(text).digest('hex').slice(0, 16),
        joy,
      };
      return cached;
    } catch {
      /* keyingisini sinaymiz */
    }
  }
  return null;
}

/*
 * Ulanish.
 *
 * Supabase bazasining sertifikati oʻz markaziga imzolangan, shuning
 * uchun avval ODATDAGIDEK — tekshiruv bilan — ulanamiz. Faqat aynan
 * sertifikat zanjiri xatosida tekshiruvsiz qayta urinamiz va buni
 * javobda ochiq aytamiz (`ssl: 'tekshirilmagan'`), yashirmaymiz.
 * Ulanishning oʻzi ikkala holatda ham shifrlangan.
 */
const ZANJIR_XATOSI = /self[- ]signed|unable to (verify|get local issuer)|certificate/i;

async function connect(urlArg) {
  const url = urlArg ?? env.databaseUrl;
  if (!url) throw new Error('DATABASE_URL yoʻq');

  const oching = async (ssl) => {
    const client = new pg.Client({ connectionString: url, ssl });
    await client.connect();
    return client;
  };

  // Mahalliy baza (sinov) shifrsiz ishlaydi — SSL ni majburlamaymiz.
  if (/sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    return { client: await oching(false), ssl: 'yoʻq' };
  }

  try {
    return { client: await oching({ rejectUnauthorized: true }), ssl: 'tekshirilgan' };
  } catch (err) {
    if (!ZANJIR_XATOSI.test(String(err?.message ?? err))) throw err;
    return { client: await oching({ rejectUnauthorized: false }), ssl: 'tekshirilmagan' };
  }
}

/** Bazada saqlangan barmoq izi — oxirgi marta qaysi fayl bajarilgan. */
async function storedHash(client) {
  try {
    const { rows } = await client.query(
      "select value ->> 'hash' as hash from public.app_settings where key = 'schema_hash'",
    );
    return rows[0]?.hash ?? '';
  } catch {
    // Jadval hali yoʻq — demak baza umuman quyilmagan.
    return '';
  }
}

/**
 * SQL ni bajaradi.
 *
 * `force` boʻlmasa va barmoq izi bir xil boʻlsa — hech nima qilinmaydi.
 * Bir necha nusxa bir vaqtda koʻtarilsa ham faqat bittasi ishlashi
 * uchun maslahat qulfi (`pg_advisory_lock`) olinadi.
 */
export async function runSetup({ force = false } = {}) {
  const file = setupSql();
  if (!file) return { ok: false, error: 'setup.sql topilmadi' };

  const { client, ssl } = await connect();
  try {
    const oldHash = await storedHash(client);
    if (!force && oldHash === file.hash) {
      return { ok: true, holat: 'oʻzgarmagan', hash: file.hash, ssl };
    }

    // 8247301 — shu vazifa uchun tanlangan doimiy raqam.
    await client.query('select pg_advisory_lock(8247301)');
    try {
      // Qulfni olgach qayta tekshiramiz: boshqa nusxa ulgurgan boʻlishi mumkin.
      if (!force && (await storedHash(client)) === file.hash) {
        return { ok: true, holat: 'boshqa nusxa bajardi', hash: file.hash, ssl };
      }

      const boshlandi = Date.now();
      await client.query(file.text);
      await client.query(
        `insert into public.app_settings (key, value)
         values ('schema_hash', jsonb_build_object('hash', $1::text, 'at', now()))
         on conflict (key) do update set value = excluded.value`,
        [file.hash],
      );
      return {
        ok: true,
        holat: oldHash ? 'yangilandi' : 'quyildi',
        hash: file.hash,
        soniya: Math.round((Date.now() - boshlandi) / 100) / 10,
        ssl,
      };
    } finally {
      await client.query('select pg_advisory_unlock(8247301)');
    }
  } finally {
    await client.end();
  }
}

/** Baza holati — panelga koʻrsatish uchun. */
export async function dbStatus() {
  const file = setupSql();
  if (!env.databaseUrl) {
    return { ulangan: false, sabab: 'DATABASE_URL yoʻq', fayl_hash: file?.hash ?? '' };
  }
  let client;
  try {
    ({ client } = await connect());
    const { rows } = await client.query(
      "select to_regclass('public.ai_models') is not null as bor",
    );
    return {
      ulangan: true,
      katalog_bor: Boolean(rows[0]?.bor),
      baza_hash: await storedHash(client),
      fayl_hash: file?.hash ?? '',
    };
  } catch (err) {
    return { ulangan: false, sabab: String(err?.message ?? err), fayl_hash: file?.hash ?? '' };
  } finally {
    await client?.end().catch(() => {});
  }
}

/**
 * Server koʻtarilganda avtomatik tekshiruv.
 *
 * DATABASE_URL boʻlmasa jimgina oʻtkazib yuboriladi — ilova avvalgidek
 * ishlayveradi, faqat sxemani egasi qoʻlda quyadi.
 */
export async function autoMigrate() {
  if (!env.databaseUrl) return;
  try {
    const out = await runSetup();
    if (out.holat !== 'oʻzgarmagan') console.log('[daho] baza:', JSON.stringify(out));
  } catch (err) {
    console.error('[daho] bazani yangilab boʻlmadi:', String(err?.message ?? err));
  }
}
