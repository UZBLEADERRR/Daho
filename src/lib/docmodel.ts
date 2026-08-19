export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type Block =
  | { type: 'h1' | 'h2' | 'h3'; runs: Run[] }
  | { type: 'p'; runs: Run[] }
  | { type: 'ul' | 'ol'; items: Run[][] }
  | { type: 'code'; text: string }
  | { type: 'img'; id: string; caption: string }
  | { type: 'hr' };

/** `![izoh](daho-img:ID)` — hujjatga qoʻyiladigan rasm belgisi. */
export const IMAGE_MARK = /^!\[([^\]]*)\]\(daho-img:([^)]+)\)$/;

/** `**qalin**`, `*qiya*`, `` `kod` `` — bo'laklarga ajratadi. */
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    const token = m[0];
    if (token.startsWith('**') || token.startsWith('__')) {
      runs.push({ text: token.slice(2, -2), bold: true });
    } else if (token.startsWith('`')) {
      runs.push({ text: token.slice(1, -1), code: true });
    } else {
      runs.push({ text: token.slice(1, -1), italic: true });
    }
    last = m.index + token.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.filter((r) => r.text !== '');
}

export function runsToText(runs: Run[]): string {
  return runs.map((r) => r.text).join('');
}

/** Markdown matnini hujjat bloklariga aylantiradi. */
export function parseDocument(markdown: string): Block[] {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: 'p', runs: parseInline(paragraph.join(' ').trim()) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    const picture = trimmed.match(IMAGE_MARK);
    if (picture) {
      flushParagraph();
      blocks.push({ type: 'img', id: picture[2], caption: picture[1] });
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (/^(---|\*\*\*|___)$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'hr' });
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ type: `h${level}` as 'h1' | 'h2' | 'h3', runs: parseInline(heading[2]) });
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      const items: Run[][] = [parseInline(bullet[1])];
      while (i + 1 < lines.length) {
        const next = lines[i + 1].trim().match(/^[-*+]\s+(.*)$/);
        if (!next) break;
        items.push(parseInline(next[1]));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      const items: Run[][] = [parseInline(numbered[1])];
      while (i + 1 < lines.length) {
        const next = lines[i + 1].trim().match(/^\d+[.)]\s+(.*)$/);
        if (!next) break;
        items.push(parseInline(next[1]));
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    paragraph.push(trimmed);
  }
  flushParagraph();
  return blocks;
}

/** Hujjatning birinchi sarlavhasini nom sifatida oladi. */
export function documentTitle(blocks: Block[], fallback = 'Hujjat'): string {
  const first = blocks.find((b) => b.type === 'h1' || b.type === 'h2');
  if (first && 'runs' in first) return runsToText(first.runs).slice(0, 80);
  const p = blocks.find((b) => b.type === 'p');
  if (p && 'runs' in p) return runsToText(p.runs).slice(0, 60);
  return fallback;
}

export interface Slide {
  title: string;
  bullets: string[];
  notes?: string;
}

/** Markdownni slaydlarga bo'ladi: har bir h1/h2 — yangi slayd. */
export function parseSlides(markdown: string): Slide[] {
  const blocks = parseDocument(markdown);
  const slides: Slide[] = [];
  let current: Slide | null = null;

  for (const block of blocks) {
    if (block.type === 'h1' || block.type === 'h2') {
      if (current) slides.push(current);
      current = { title: runsToText(block.runs), bullets: [] };
      continue;
    }
    if (!current) current = { title: 'Kirish', bullets: [] };

    if (block.type === 'h3') {
      current.bullets.push(runsToText(block.runs));
    } else if (block.type === 'p') {
      const text = runsToText(block.runs).trim();
      if (text) current.bullets.push(text);
    } else if (block.type === 'ul' || block.type === 'ol') {
      current.bullets.push(...block.items.map(runsToText));
    }
  }
  if (current) slides.push(current);

  return slides.length ? slides : [{ title: 'Slayd', bullets: [] }];
}
