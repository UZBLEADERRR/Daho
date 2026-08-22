/**
 * Sahifadan matn oladi.
 *
 * Butun HTML ni yuborish notoʻgʻri: u juda katta va menyu, reklama,
 * skript bilan toʻla. Shuning uchun asosiy matnni ajratib, tozalab
 * yuboramiz — javob ham aniqroq boʻladi, token ham kam ketadi.
 */

const NOISE = 'script,style,noscript,svg,nav,header,footer,aside,form,iframe,button';

function readable(): string {
  // Maqola boʻlsa oʻshani olamiz, boʻlmasa butun sahifani.
  const root =
    document.querySelector('article') ??
    document.querySelector('main') ??
    document.body;

  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(NOISE).forEach((el) => el.remove());

  return (clone.innerText ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 24_000);
}

export interface PageInfo {
  title: string;
  url: string;
  text: string;
  selection: string;
  words: number;
}

function collect(): PageInfo {
  const text = readable();
  return {
    title: document.title,
    url: location.href,
    text,
    selection: (window.getSelection()?.toString() ?? '').trim().slice(0, 8000),
    words: text ? text.split(/\s+/).length : 0,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'daho:page') {
    reply(collect());
    return true;
  }
  return undefined;
});
