/*
 * Sahifadan maʼlumot yigʻuvchi.
 *
 * Bu skript faqat OʻQIYDI: ekranda nima turgan boʻlsa oʻshani matn
 * qilib beradi. Hech narsa bosmaydi, hech narsa yubormaydi — nima
 * qilish kerakligini foydalanuvchi panelda oʻzi hal qiladi.
 */

const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();

/** YouTube — video sarlavhasi, kanal, tavsif va izohlar. */
function collectYouTube() {
  const title = clean(document.querySelector('h1.ytd-watch-metadata')?.textContent);
  const channel = clean(document.querySelector('#owner #channel-name a')?.textContent);
  const views = clean(document.querySelector('#info-container #info')?.textContent);
  const description = clean(
    document.querySelector('#description-inline-expander')?.textContent,
  ).slice(0, 4000);

  const comments = [...document.querySelectorAll('#content-text')]
    .slice(0, 40)
    .map((el) => clean(el.textContent))
    .filter(Boolean);

  return {
    manba: 'youtube',
    havola: location.href,
    sarlavha: title,
    kanal: channel,
    korishlar: views,
    tavsif: description,
    izohlar: comments,
  };
}

/** Telegram Web — ochiq suhbatdagi xabarlar. */
function collectTelegram() {
  const chat = clean(
    document.querySelector('.chat-info .title, .ChatInfo .title')?.textContent,
  );

  const nodes = [
    ...document.querySelectorAll('.message .text-content, .Message .text-content, .message-content'),
  ].slice(-60);

  const messages = nodes
    .map((el) => {
      const bubble = el.closest('.message, .Message');
      const own = bubble?.classList.contains('own') || bubble?.classList.contains('is-own');
      return { kim: own ? 'men' : 'suhbatdosh', matn: clean(el.textContent) };
    })
    .filter((m) => m.matn);

  return { manba: 'telegram', havola: location.href, suhbat: chat, xabarlar: messages };
}

/** Instagram — post matni va izohlar. */
function collectInstagram() {
  const article = document.querySelector('article');
  const texts = [...(article?.querySelectorAll('h1, span[dir="auto"]') ?? [])]
    .map((el) => clean(el.textContent))
    .filter((t) => t.length > 1);

  const author = clean(article?.querySelector('a[role="link"] span')?.textContent);

  return {
    manba: 'instagram',
    havola: location.href,
    muallif: author,
    matnlar: texts.slice(0, 60),
  };
}

/** Boshqa saytlar — asosiy matn. */
function collectGeneric() {
  const main = document.querySelector('main, article') ?? document.body;
  const clone = main.cloneNode(true);
  clone.querySelectorAll('script, style, nav, footer, aside').forEach((el) => el.remove());
  return {
    manba: 'sahifa',
    havola: location.href,
    sarlavha: clean(document.title),
    matn: clean(clone.textContent).slice(0, 12000),
  };
}

function collect() {
  const host = location.hostname;
  if (host.includes('youtube.com')) return collectYouTube();
  if (host.includes('telegram.org')) return collectTelegram();
  if (host.includes('instagram.com')) return collectInstagram();
  return collectGeneric();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'daho:collect') return undefined;
  try {
    reply({ ok: true, data: collect() });
  } catch (err) {
    reply({ ok: false, error: String(err?.message ?? err) });
  }
  return true;
});
