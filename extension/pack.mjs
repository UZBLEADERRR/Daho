/**
 * Kengaytmani tarqatishga tayyorlaydi.
 *
 * Natija — `public/daho-extension.zip`. Bu arxivni ikki joyda ishlatiladi:
 *   • Chrome Web Store ga yuklash (haqiqiy oʻrnatish yoʻli);
 *   • serverdagi `/extension` sahifasidan yuklab olish.
 *
 * Chrome Web Store dan tashqari yoʻl bilan «haqiqiy» oʻrnatib boʻlmaydi:
 * Chrome 2018 dan beri qoʻlda .crx tashlashni bloklaydi. Shuning uchun
 * bu skript aynan Do'kon talab qiladigan shaklda arxivlaydi va manifestni
 * oldindan tekshiradi — rad javobi kelmasin.
 */

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'public');
const outFile = join(outDir, 'daho-extension.zip');

/* ------------------------------------------------------------------ */
/*  Manifestni tekshirish                                              */
/* ------------------------------------------------------------------ */

const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const problems = [];

if (manifest.manifest_version !== 3) problems.push('manifest_version 3 boʻlishi kerak');
if (!manifest.name) problems.push('name yoʻq');
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? '')) problems.push('version notoʻgʻri');
if (!manifest.description) problems.push('description yoʻq — Doʻkon talab qiladi');
if ((manifest.description ?? '').length > 132) problems.push('description 132 belgidan uzun');

/*
 * Doʻkon 128px ni majburiy soʻraydi; 16/32/48 boʻlmasa brauzer
 * kattasini kichraytiradi va panel yonidagi belgi xira chiqadi.
 */
for (const size of ['16', '32', '48', '128']) {
  const path = manifest.icons?.[size];
  if (!path) problems.push(`icons.${size} yoʻq`);
  else if (!existsSync(join(here, path))) problems.push(`ikonka topilmadi: ${path}`);
}

// Har bir koʻrsatilgan fayl haqiqatan bormi.
const referenced = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  manifest.action?.default_popup,
  manifest.options_page,
  ...(manifest.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])]),
].filter(Boolean);

for (const file of referenced) {
  if (!existsSync(join(here, file))) problems.push(`manifestda koʻrsatilgan fayl yoʻq: ${file}`);
}

if (problems.length) {
  console.error('Kengaytma paketlanmadi:');
  for (const p of problems) console.error('  •', p);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/*  Arxivga tushadigan fayllar                                         */
/* ------------------------------------------------------------------ */

/*
 * Server manzilini kengaytmaga singdiramiz.
 *
 * Aks holda foydalanuvchi uni qoʻlda yozishi kerak, yozmasa kengaytma
 * jimgina Google’ga toʻgʻridan-toʻgʻri murojaat qiladi va «kalit yoʻq»
 * yoki 503 xatosiga uriladi. Railway oʻz domenini oʻzgaruvchida beradi.
 */
const serverUrl = (
  process.env.DAHO_SERVER_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
).replace(/\/+$/, '');

writeFileSync(
  join(here, 'config.json'),
  JSON.stringify({ serverUrl }, null, 2) + '\n',
);
if (serverUrl) console.log(`  server: ${serverUrl}`);
else console.log('  server manzili berilmadi — foydalanuvchi oʻzi kiritadi');

const SKIP = new Set(['pack.mjs', 'README.md', '.DS_Store', 'node_modules', 'dist']);

function walk(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push({ full, rel });
  }
  return out;
}

const files = walk(here);

/* ------------------------------------------------------------------ */
/*  ZIP yozish (kutubxonasiz — deflate Node ichida bor)                */
/* ------------------------------------------------------------------ */

function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.rel, 'utf8');
    const raw = readFileSync(entry.full);
    const packed = deflateRawSync(raw, { level: 9 });
    // Siqilgani kattaroq chiqsa — siqmasdan qoʻyamiz.
    const deflate = packed.length < raw.length;
    const body = deflate ? packed : raw;
    const sum = crc32(raw) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // kerakli versiya
    local.writeUInt16LE(0x0800, 6);        // UTF-8 nomlar
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);

    chunks.push(local, name, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(deflate ? 8 : 0, 10);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);

    central.push(dir, name);
    offset += local.length + name.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuf, end]);
}

mkdirSync(outDir, { recursive: true });
const archive = zip(files);
createWriteStream(outFile).end(archive);

console.log(
  `Kengaytma tayyor: public/daho-extension.zip — ` +
    `${files.length} ta fayl, ${(archive.length / 1024).toFixed(1)} KB, v${manifest.version}`,
);
