// Artbordlarni parts/ dan yigʻadi: base.css + <Nom>.css + <Nom>.html -> <Nom>.dc.html
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const parts = join(here, 'parts');
const base = readFileSync(join(parts, 'base.css'), 'utf8');

const names = readdirSync(parts)
  .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
  .map((f) => f.replace(/\.html$/, ''));

for (const name of names) {
  const extraPath = join(parts, `${name}.css`);
  const extra = existsSync(extraPath) ? '\n' + readFileSync(extraPath, 'utf8') : '';
  const frag = readFileSync(join(parts, '_status.frag'), 'utf8').trimEnd();
  const body = readFileSync(join(parts, `${name}.html`), 'utf8').trim().replace('<!--@status-->', frag);
  const out = [
    '<!doctype html>',
    '<html>',
    '<head><meta charset="utf-8"><script src="./support.js"></script></head>',
    '<body>',
    '<x-dc>',
    '<helmet>',
    '<style>',
    base + extra.trimEnd(),
    '</style>',
    '</helmet>',
    body,
    '</x-dc>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
  writeFileSync(join(here, `${name}.dc.html`), out);
  console.log(`${name}.dc.html  ${(out.length / 1024).toFixed(1)} KB`);
}
