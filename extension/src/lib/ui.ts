/** Kichik DOM yordamchilari — kengaytmada React ishlatilmaydi. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function $<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`${selector} topilmadi`);
  return node;
}

/** Oddiy markdown — qalin, kursiv, kod va roʻyxat. Xavfsiz: HTML yozilmaydi. */
export function renderMarkdown(target: HTMLElement, text: string): void {
  target.textContent = '';
  for (const block of text.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('```')) {
      const pre = el('pre', 'code');
      pre.textContent = trimmed.replace(/^```\w*\n?/, '').replace(/```$/, '');
      target.appendChild(pre);
      continue;
    }

    // Bitta boʻlak ichida ham matn, ham roʻyxat boʻlishi mumkin —
    // ketma-ket kelgan bandlarni alohida roʻyxatga yigʻamiz.
    let list: HTMLUListElement | null = null;
    let paragraph: string[] = [];

    const flush = () => {
      if (!paragraph.length) return;
      const p = el('p');
      inline(p, paragraph.join(' '));
      target.appendChild(p);
      paragraph = [];
    };

    for (const line of trimmed.split('\n')) {
      const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      const heading = line.match(/^\s*#{1,4}\s+(.*)$/);

      if (heading) {
        flush();
        list = null;
        target.appendChild(el('b', 'head-line', heading[1]));
        continue;
      }
      if (bullet) {
        flush();
        if (!list) {
          list = el('ul');
          target.appendChild(list);
        }
        const li = el('li');
        inline(li, bullet[1]);
        list.appendChild(li);
        continue;
      }
      list = null;
      if (line.trim()) paragraph.push(line.trim());
    }
    flush();
  }
}

/** `**qalin**` va `` `kod` `` — matn sifatida qoʻshiladi, HTML sifatida emas. */
function inline(target: HTMLElement, text: string): void {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) target.appendChild(document.createTextNode(text.slice(last, index)));
    const token = match[0];
    if (token.startsWith('**')) {
      target.appendChild(el('b', '', token.slice(2, -2)));
    } else {
      target.appendChild(el('code', '', token.slice(1, -1)));
    }
    last = index + token.length;
  }
  if (last < text.length) target.appendChild(document.createTextNode(text.slice(last)));
}

export function tokenLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)} mln`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
