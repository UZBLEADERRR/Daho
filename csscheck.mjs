import postcss from 'postcss';
import { readFileSync } from 'fs';
const css = readFileSync('src/styles.css', 'utf8');
const root = postcss.parse(css, { from: 'src/styles.css' });
const bad = [];
root.walkAtRules((at) => {
  if (!at.nodes) return;
  at.nodes.forEach((n) => {
    // media/supports ichida toʻgʻridan-toʻgʻri deklaratsiya — selektor yoʻqolgan
    if (n.type === 'decl') bad.push(`@${at.name} (${at.params}) ichida selektorsiz: ${n.prop}: ${n.value}  [qator ${n.source.start.line}]`);
  });
});
root.nodes.forEach((n) => {
  if (n.type === 'decl') bad.push(`Ildizda selektorsiz: ${n.prop}: ${n.value} [qator ${n.source.start.line}]`);
});
// Boʻsh qoidalar
root.walkRules((r) => { if (!r.nodes.length) bad.push(`Boʻsh qoida: ${r.selector} [qator ${r.source.start.line}]`); });
console.log(bad.length ? bad.join('\n') : 'CSS toza');
