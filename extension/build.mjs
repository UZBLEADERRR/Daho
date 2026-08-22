/**
 * Kengaytmani yigʻish.
 *
 * `dist/` ichiga tayyor kengaytma tushadi — uni Chrome da
 * «Load unpacked» orqali qoʻshsa boʻladi.
 *
 * Server manzilini yigʻish paytida berish mumkin:
 *   DAHO_SUPABASE_URL=… DAHO_SUPABASE_ANON_KEY=… node extension/build.mjs
 * Berilmasa foydalanuvchi sozlamalar sahifasidan kiritadi.
 */

import { build } from 'esbuild';
import { deflateSync } from 'node:zlib';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [
    join(here, 'src/background.ts'),
    join(here, 'src/content.ts'),
    join(here, 'src/popup.ts'),
    join(here, 'src/sidepanel.ts'),
    join(here, 'src/options.ts'),
  ],
  outdir: out,
  bundle: true,
  format: 'esm',
  target: 'chrome114',
  minify: true,
  sourcemap: false,
  define: {
    __SUPABASE_URL__: JSON.stringify(process.env.DAHO_SUPABASE_URL ?? ''),
    __SUPABASE_ANON_KEY__: JSON.stringify(process.env.DAHO_SUPABASE_ANON_KEY ?? ''),
  },
});

for (const file of ['manifest.json', 'popup.html', 'sidepanel.html', 'options.html']) {
  cpSync(join(here, file), join(out, file));
}
cpSync(join(here, 'src/style.css'), join(out, 'style.css'));
cpSync(join(here, '_locales'), join(out, '_locales'), { recursive: true });

// Ikonkalar — yoʻq boʻlsa oddiy PNG yasab qoʻyamiz, aks holda Chrome
// kengaytmani yuklamaydi.
mkdirSync(join(out, 'icons'), { recursive: true });
if (existsSync(join(here, 'icons/128.png'))) {
  cpSync(join(here, 'icons'), join(out, 'icons'), { recursive: true });
} else {
  for (const size of [16, 32, 128]) {
    writeFileSync(join(out, `icons/${size}.png`), makeIcon(size));
  }
}

/** Binafsha kvadrat PNG — vaqtinchalik ikonka. */
function makeIcon(size) {
  const crc = (buf) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, tail]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.concat(Array.from({ length: size }, () => Buffer.from([0x8b, 0x7c, 0xf6]))),
  ]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

console.log(`Kengaytma tayyor: ${out}`);
