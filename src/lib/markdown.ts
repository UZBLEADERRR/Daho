import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Jadvalni oʻzi siljiydigan qutiga oʻraydi.
 *
 * Avval jadval `width:100%` bilan konteynerga siqilardi: ustunlar tiqilib,
 * matn vertikal boʻlib tushib ketardi va xabar buzilib koʻrinardi. Endi
 * jadval oʻz tabiiy kengligida qoladi va faqat OʻZI yonga siljiydi —
 * xabarning qolgan qismi joyida turadi.
 */
function wrapTables(html: string): string {
  return html
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

/** Markdown matnini xavfsiz HTML ga o'giradi. */
export function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  const clean = DOMPurify.sanitize(raw, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style', 'form', 'input', 'button'],
  });
  return wrapTables(clean);
}
