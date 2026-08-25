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

/*
 * Nega bu qism murakkab.
 *
 * Model videoning ICHIDA nima deyilganini bilmasa, sarlavha va izohlarga
 * qarab taxmin qiladi — va xato aytadi. Shuning uchun haqiqiy subtitr
 * matni kerak. Lekin YouTube uni bitta ishonchli yoʻl bilan bermaydi:
 * baʼzi videoda sahifa HTML ida turadi, baʼzida faqat ichki API
 * (InnerTube) qaytaradi, baʼzida esa faqat ekrandagi transkript panelida
 * boʻladi. Shuning uchun tartib bilan hammasi sinab koʻriladi.
 */

function mmss(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Havoladan video id sini oladi (watch, shorts, embed, youtu.be). */
function videoId() {
  const url = new URL(location.href);
  const v = url.searchParams.get('v');
  if (v) return v;
  const m = url.pathname.match(/\/(shorts|embed|v)\/([\w-]{6,})/);
  if (m) return m[2];
  if (url.hostname === 'youtu.be') return url.pathname.slice(1);
  return '';
}

/**
 * `nom = { … }` koʻrinishidagi JSON ni HTML dan ajratib oladi.
 *
 * Oddiy regex bu yerda ishlamaydi: JSON ichida ham `}` va `;` bor.
 * Shuning uchun qavslar sanaladi — satr ichidagilari hisobga olinmaydi.
 */
function jsonAfter(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const open = html.indexOf('{', at);
  if (open < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(open, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Sahifa HTML i — bir marta olinadi, brauzer keshidan keladi. */
let pageHtml = null;
async function watchHtml() {
  if (pageHtml !== null) return pageHtml;
  try {
    pageHtml = await (await fetch(location.href, { credentials: 'include' })).text();
  } catch {
    pageHtml = '';
  }
  return pageHtml;
}

/** 1-yoʻl: sahifa HTML idagi player javobi. */
async function tracksFromHtml() {
  const html = await watchHtml();
  if (!html) return [];
  const player = jsonAfter(html, 'ytInitialPlayerResponse');
  return player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
}

/**
 * 2-yoʻl: YouTube ning ichki API si.
 *
 * Sahifa HTML ida subtitr roʻyxati boʻlmasligi mumkin (masalan video
 * SPA orqali almashtirilgan boʻlsa — HTML eskisiniki). API esa aynan
 * shu video uchun javob beradi.
 */
async function tracksFromApi() {
  const id = videoId();
  if (!id) return [];
  const html = await watchHtml();
  const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const version = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? '2.20240101.00.00';
  if (!key) return [];

  try {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: id,
        context: { client: { clientName: 'WEB', clientVersion: version, hl: 'uz', gl: 'UZ' } },
      }),
    });
    const data = await res.json();
    return data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  } catch {
    return [];
  }
}

/** Sahifa tili → oʻzbek → rus → ingliz → birinchisi. */
function pickTrack(tracks) {
  const wanted = [document.documentElement.lang, 'uz', 'ru', 'en'];
  for (const code of wanted) {
    if (!code) continue;
    const found = tracks.find((t) => (t.languageCode ?? '').startsWith(code));
    if (found) return found;
  }
  return tracks[0];
}

/** Subtitr faylini oʻqiydi: avval json3, boʻlmasa XML. */
async function readTrack(track) {
  const base = track?.baseUrl;
  if (!base) return [];

  try {
    const res = await fetch(`${base}&fmt=json3`, { credentials: 'include' });
    const data = await res.json();
    const lines = (data?.events ?? [])
      .filter((e) => e.segs)
      .map((e) => ({
        vaqt: Math.round((e.tStartMs ?? 0) / 1000),
        matn: e.segs.map((seg) => seg.utf8 ?? '').join('').replace(/\s+/g, ' ').trim(),
      }))
      .filter((l) => l.matn);
    if (lines.length) return lines;
  } catch {
    /* XML ga oʻtamiz */
  }

  // json3 boʻsh qaytishi mumkin — eski XML koʻrinishi koʻpincha ishlaydi.
  try {
    const xml = await (await fetch(base, { credentials: 'include' })).text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    return [...doc.querySelectorAll('text')]
      .map((node) => ({
        vaqt: Math.round(Number(node.getAttribute('start') ?? 0)),
        matn: clean(
          new DOMParser().parseFromString(
            `<x>${node.textContent ?? ''}</x>`,
            'text/html',
          ).body.textContent,
        ),
      }))
      .filter((l) => l.matn);
  } catch {
    return [];
  }
}

/**
 * 3-yoʻl: ekrandagi transkript paneli.
 *
 * Bu yerda panelni OCHAMIZ ham. Odatda skript hech narsa bosmaydi, lekin
 * bu istisno: foydalanuvchi aynan «shu videoni tahlil qil» deb soʻragan,
 * panel esa faqat koʻrsatiladi — hech narsa oʻzgarmaydi va yuborilmaydi.
 */
async function transcriptFromPanel(openIt = true) {
  const oqi = () =>
    [...document.querySelectorAll('ytd-transcript-segment-renderer')]
      .map((row) => {
        const t = clean(row.querySelector('.segment-timestamp')?.textContent);
        const x = clean(row.querySelector('.segment-text')?.textContent);
        return x ? `[${t}] ${x}` : '';
      })
      .filter(Boolean);

  let qatorlar = oqi();
  if (qatorlar.length) return { til: '', avtomatik: false, qatorlar };
  if (!openIt) return null;

  // «Transkriptni koʻrsatish» tugmasi — tilga qarab matni har xil,
  // shuning uchun harakat (aria-label) boʻyicha qidiramiz.
  const button = [...document.querySelectorAll('button, tp-yt-paper-button, yt-button-shape button')]
    .find((el) => /transcript|transkript|расшифровк/i.test(
      `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`,
    ));
  if (!button) return null;

  button.click();
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    qatorlar = oqi();
    if (qatorlar.length) return { til: '', avtomatik: false, qatorlar };
  }
  return null;
}

/** 30 soniyalik boʻlaklarga yigʻadi — oʻqishli va token tejaydi. */
function toChunks(lines) {
  const chunks = [];
  for (const line of lines) {
    const slot = Math.floor(line.vaqt / 30);
    const last = chunks[chunks.length - 1];
    if (last && last.slot === slot) last.matn += ' ' + line.matn;
    else chunks.push({ slot, vaqt: line.vaqt, matn: line.matn });
  }
  return chunks.map((c) => `[${mmss(c.vaqt)}] ${c.matn}`);
}

/** Video matnini oladi — barcha yoʻllarni tartib bilan sinaydi. */
async function fetchTranscript() {
  try {
    let tracks = await tracksFromHtml();
    if (!tracks.length) tracks = await tracksFromApi();

    if (tracks.length) {
      // Tanlangan til boʻsh chiqsa boshqalarini ham sinaymiz.
      const order = [pickTrack(tracks), ...tracks].filter(
        (t, i, arr) => t && arr.indexOf(t) === i,
      );
      for (const track of order.slice(0, 3)) {
        const lines = await readTrack(track);
        if (lines.length) {
          return {
            til: track.languageCode ?? '',
            avtomatik: track.kind === 'asr',
            qatorlar: toChunks(lines),
          };
        }
      }
    }

    return await transcriptFromPanel();
  } catch {
    return null;
  }
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

  const transcript = await fetchTranscript();

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
