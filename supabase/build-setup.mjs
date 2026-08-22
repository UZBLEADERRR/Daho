/**
 * `supabase/setup.sql` ni qayta yigʻadi.
 *
 * Migratsiyalarni tartib bilan bitta faylga birlashtiradi — foydalanuvchi
 * Supabase SQL Editor ga bitta faylni qoʻyadi, toʻqqiztasini tartib bilan
 * yugurtirmaydi. Tartib xato boʻlsa migratsiya toʻxtaydi, shuning uchun
 * buni odamga qoldirmaymiz.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const head = `-- ============================================================================
--  Daho — bazani bir marta sozlash
--
--  Bu fayl \`supabase/migrations/\` dagi hamma migratsiyani TARTIB BILAN
--  birlashtiradi. Supabase → SQL Editor ga shu faylning oʻzini qoʻyib
--  «Run» bosing — boshqa hech narsa kerak emas.
--
--  Bir necha marta ishga tushirsa ham xavfsiz: hammasi «if not exists» va
--  «create or replace» bilan yozilgan, eski bazadagi yetishmagan ustunlar
--  esa oʻzi toʻldiriladi.
--
--  QOʻLDA TAHRIRLANMAYDI — \`npm run sql\` uni qayta yasaydi.
-- ============================================================================
`;

const body = files
  .map(
    (f) =>
      `\n\n-- ==========================================================================\n` +
      `--  ${f}\n` +
      `-- ==========================================================================\n\n` +
      readFileSync(join(dir, f), 'utf8').trimEnd(),
  )
  .join('');

writeFileSync(join(here, 'setup.sql'), head + body + '\n');
console.log(`setup.sql yangilandi — ${files.length} ta migratsiya`);
