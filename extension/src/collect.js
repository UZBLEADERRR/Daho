/*
 * Sahifadan maʼlumot yigʻuvchi.
 *
 * Bu skript faqat OʻQIYDI: ekranda nima turgan boʻlsa oʻshani matn
 * qilib beradi. Hech narsa bosmaydi, hech narsa yubormaydi — nima
 * qilish kerakligini foydalanuvchi panelda oʻzi hal qiladi.
 */

const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ */
/*  YouTube subtitrlari                                                */
/* ------------------------------------------------------------------ */

/**
 * Video matnini (subtitrlarini) oladi.
 *
 * Avval faqat sarlavha, tavsif va izohlar yigʻilardi — model videoning
 * ichida nima deyilganini BILMASDAN javob berardi va shuning uchun
 * xato aytardi. Endi haqiqiy subtitr matni olinadi.
 *
 * Yoʻli: sahifaning oʻz HTML ida `ytInitialPlayerResponse` bor, uning
 * ichida subtitr fayllarining manzili turadi. Content script sahifa
 * oʻzgaruvchilarini oʻqiy olmaydi, lekin HTML ni qayta oʻqiy oladi —
 * u brauzer keshidan keladi, qoʻshimcha yuk tushmaydi.
 */
async function fetchTranscript() {
  try {
    const html = await (await fetch(location.href, { credentials: 'include' })).text();
    const marker = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var|<\/script>)/s);
    if (!marker) return null;

    let player;
    try {
      player = JSON.parse(marker[1]);
    } catch {
      return null;
    }

    const tracks =
      player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    if (!tracks.length) return null;

    // Avval sahifa tili, keyin oʻzbek/rus/ingliz, boʻlmasa birinchisi.
    const wanted = [document.documentElement.lang, 'uz', 'ru', 'en'];
    const track =
      wanted.map((code) => tracks.find((t) => (t.languageCode ?? '').startsWith(code)))
        .find(Boolean) ?? tracks[0];

    const url = `${track.baseUrl}&fmt=json3`;
    const data = await (await fetch(url, { credentials: 'include' })).json();

    const lines = (data?.events ?? [])
      .filter((e) => e.segs)
      .map((e) => ({
        vaqt: Math.round((e.tStartMs ?? 0) / 1000),
        matn: e.segs.map((seg) => seg.utf8 ?? '').join('').replace(/\s+/g, ' ').trim(),
      }))
      .filter((l) => l.matn);

    if (!lines.length) return null;

    // Har 30 soniyani bitta boʻlakka yigʻamiz — model uchun ham oʻqishli,
    // ham token tejaydi (har qatorga vaqt yozilsa sarf ikki barobar oshadi).
    const chunks = [];
    for (const line of lines) {
      const slot = Math.floor(line.vaqt / 30);
      const last = chunks[chunks.length - 1];
      if (last && last.slot === slot) last.matn += ' ' + line.matn;
      else chunks.push({ slot, vaqt: line.vaqt, matn: line.matn });
    }

    return {
      til: track.languageCode ?? '',
      avtomatik: Boolean(track.kind === 'asr'),
      qatorlar: chunks.map((c) => `[${mmss(c.vaqt)}] ${c.matn}`),
    };
  } catch {
    return null;
  }
}

function mmss(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Sahifadagi ochiq transkript panelidan oʻqish — zaxira yoʻl. */
function transcriptFromPanel() {
  const rows = [...document.querySelectorAll('ytd-transcript-segment-renderer')];
  if (!rows.length) return null;
  const qatorlar = rows
    .map((row) => {
      const t = clean(row.querySelector('.segment-timestamp')?.textContent);
      const x = clean(row.querySelector('.segment-text')?.textContent);
      return x ? `[${t}] ${x}` : '';
    })
    .filter(Boolean);
  return qatorlar.length ? { til: '', avtomatik: false, qatorlar } : null;
}

/** YouTube — sarlavha, kanal, tavsif, subtitr va izohlar. */
async function collectYouTube() {
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

  const transcript = (await fetchTranscript()) ?? transcriptFromPanel();

  // Video hozir qayerda turgani — «shu joyda nima dedi?» degan savol uchun.
  const video = document.querySelector('video');
  const hozir = video && Number.isFinite(video.currentTime)
    ? mmss(Math.floor(video.currentTime))
    : '';

  return {
    manba: 'youtube',
    havola: location.href,
    sarlavha: title,
    kanal: channel,
    korishlar: views,
    tavsif: description,
    hozirgi_vaqt: hozir,
    subtitr: transcript
      ? {
          til: transcript.til,
          avtomatik: transcript.avtomatik,
          // Uzun video butun kontekstni yeb qoʻymasin.
          matn: transcript.qatorlar.join('\n').slice(0, 40000),
        }
      : null,
    subtitr_yoq_sababi: transcript ? '' : 'Bu videoda subtitr yoqilmagan.',
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

async function collect() {
  const host = location.hostname;
  if (host.includes('youtube.com')) return collectYouTube();
  if (host.includes('telegram.org')) return collectTelegram();
  if (host.includes('instagram.com')) return collectInstagram();
  return collectGeneric();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'daho:collect') return undefined;
  // Subtitr tarmoqdan olinadi — javob asinxron qaytadi.
  Promise.resolve()
    .then(collect)
    .then((data) => reply({ ok: true, data }))
    .catch((err) => reply({ ok: false, error: String(err?.message ?? err) }));
  return true;
});
