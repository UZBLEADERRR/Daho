/**
 * YouTube bilan ishlash.
 *
 * Ilova videoni yuklab olmaydi (bu YouTube shartlariga zid) — buning oʻrniga:
 *   - havolani chatning oʻzida pleyer qilib koʻrsatadi;
 *   - Gemini videoni **havolasi orqali** koʻradi, shuning uchun subtitrni
 *     tarjima qilish, mazmunini chiqarish va vaqt belgilarini olish uchun
 *     hech narsani yuklab olish shart emas;
 *   - tarjimadan .srt subtitr fayli yasab beradi;
 *   - tarjima qilingan matnni bitta ovozli fayl (audio) qilib oʻqiydi.
 */
import { generateFromVideo } from './gemini';
import { getState } from './store';

export interface VideoRef {
  id: string;
  url: string;
  start?: number;
}

const PATTERNS = [
  /(?:youtube\.com|youtube-nocookie\.com)\/watch\?[^\s]*?v=([A-Za-z0-9_-]{6,})/i,
  /youtu\.be\/([A-Za-z0-9_-]{6,})/i,
  /(?:youtube\.com|youtube-nocookie\.com)\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{6,})/i,
];

/** Havoladan YouTube video identifikatorini ajratadi. */
export function parseYouTube(raw: string): VideoRef | null {
  const url = raw.trim();
  for (const pattern of PATTERNS) {
    const match = url.match(pattern);
    if (match?.[1]) {
      const start = url.match(/[?&](?:t|start)=(\d+)/)?.[1];
      return {
        id: match[1],
        url: `https://www.youtube.com/watch?v=${match[1]}`,
        start: start ? Number(start) : undefined,
      };
    }
  }
  return null;
}

/** Matn ichidagi barcha YouTube havolalari (takrorsiz). */
export function findVideos(text: string): VideoRef[] {
  const out: VideoRef[] = [];
  const seen = new Set<string>();
  for (const raw of text.match(/https?:\/\/[^\s)<>"']+/g) ?? []) {
    const ref = parseYouTube(raw);
    if (ref && !seen.has(ref.id)) {
      seen.add(ref.id);
      out.push(ref);
    }
  }
  return out;
}

/** YouTube qidiruv sahifasi — qidiruv ishlamay qolganda zaxira yoʻl. */
export function searchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export function embedUrl(ref: VideoRef): string {
  const params = new URLSearchParams({ rel: '0', playsinline: '1' });
  if (ref.start) params.set('start', String(ref.start));
  return `https://www.youtube-nocookie.com/embed/${ref.id}?${params.toString()}`;
}

export function thumbUrl(ref: VideoRef): string {
  return `https://i.ytimg.com/vi/${ref.id}/hqdefault.jpg`;
}

/* ------------------------------------------------------------------ */
/*  Tarjima va subtitr                                                 */
/* ------------------------------------------------------------------ */

export interface Caption {
  /** Boshlanish vaqti, soniyada */
  start: number;
  end: number;
  text: string;
}

export interface VideoRead {
  title: string;
  language: string;
  summary: string;
  captions: Caption[];
}

const READ_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    language: { type: 'STRING', description: 'Videodagi asl til' },
    summary: { type: 'STRING', description: 'Qisqacha mazmun, 4-8 jumla' },
    captions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          start: { type: 'NUMBER', description: 'boshlanish, soniya' },
          end: { type: 'NUMBER', description: 'tugash, soniya' },
          text: { type: 'STRING' },
        },
        required: ['start', 'end', 'text'],
      },
    },
  },
  required: ['title', 'language', 'summary', 'captions'],
} as const;

const LANG_NAME: Record<string, string> = {
  'uz-UZ': 'oʻzbek',
  uz: 'oʻzbek',
  'ru-RU': 'rus',
  ru: 'rus',
  'en-US': 'ingliz',
  en: 'ingliz',
  'tr-TR': 'turk',
  tr: 'turk',
};

export function languageName(code: string): string {
  return LANG_NAME[code] ?? LANG_NAME[code.slice(0, 2)] ?? code;
}

/* ------------------------------------------------------------------ */
/*  Video haqiqatan bormi                                              */
/* ------------------------------------------------------------------ */

/**
 * Video mavjudligini tekshiradi.
 *
 * NEGA KERAK: model «video top» deyilganda havolani OʻYLAB TOPISHI
 * mumkin. Eng koʻp uchraydigani `dQw4w9WgXcQ` — mashq maʼlumotidagi
 * eng mashhur id (Rick Astley). Ilgari shu id javobga tushib ketardi
 * va foydalanuvchi butunlay boshqa video koʻrardi.
 *
 * Tekshiruv RASM orqali: `hqdefault.jpg` mavjud video uchun katta
 * surat, mavjud boʻlmagani uchun 120×90 kulrang oʻrinbosar qaytaradi.
 * Bu yoʻl CORS talab qilmaydi, shuning uchun brauzerda ishonchli.
 */
export function videoExists(id: string, timeoutMs = 6000): Promise<boolean> {
  if (typeof Image === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.src = '';
      resolve(false);
    }, timeoutMs);

    img.onload = () => {
      clearTimeout(timer);
      // Oʻrinbosar surat 120×90 — undan kattasi haqiqiy video.
      resolve(img.naturalWidth > 120);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    img.src = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
  });
}

/**
 * Videoning haqiqiy sarlavhasi (oEmbed).
 *
 * Kalit talab qilmaydi. Tarmoq yoki CORS toʻsib qoʻysa boʻsh satr
 * qaytadi — bu holda sarlavhasiz davom etamiz, chunki mavjudlikni
 * `videoExists` allaqachon tasdiqlagan.
 */
export async function videoTitle(id: string, signal?: AbortSignal): Promise<string> {
  try {
    const url =
      'https://www.youtube.com/oembed?format=json&url=' +
      encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
    const res = await fetch(url, { signal });
    if (!res.ok) return '';
    const data = (await res.json()) as { title?: string };
    return String(data?.title ?? '');
  } catch {
    return '';
  }
}

/** Roʻyxatdan faqat HAQIQATAN mavjud videolarni qoldiradi. */
export async function keepReal(
  refs: VideoRef[],
  signal?: AbortSignal,
): Promise<Array<VideoRef & { title: string }>> {
  const checked = await Promise.all(
    refs.slice(0, 8).map(async (ref) => {
      if (!(await videoExists(ref.id))) return null;
      return { ...ref, title: await videoTitle(ref.id, signal) };
    }),
  );
  return checked.filter((v): v is VideoRef & { title: string } => v !== null);
}

/* ------------------------------------------------------------------ */
/*  Subtitr ichidan qidirish                                           */
/* ------------------------------------------------------------------ */

/**
 * Uzun videodan faqat KERAKLI qismni ajratadi.
 *
 * Soatlab davom etgan suhbatning butun matnini modelga berish —
 * oʻn minglab token. Buning oʻrniga subtitr boʻlaklarga boʻlinadi,
 * savolga eng mos boʻlaklar tanlanadi va faqat oʻshalar beriladi.
 * Har boʻlak vaqt belgisi bilan keladi, shunda javobda «12:40 da
 * aytilgan» deb koʻrsatish mumkin.
 */
export interface Parcha {
  start: number;
  end: number;
  text: string;
}

/** Subtitrni ~40 soniyalik boʻlaklarga yigʻadi. */
export function chunkCaptions(captions: Caption[], seconds = 40): Parcha[] {
  const out: Parcha[] = [];
  let joriy: Parcha | null = null;

  for (const c of captions) {
    if (!joriy || c.start - joriy.start >= seconds) {
      if (joriy) out.push(joriy);
      joriy = { start: c.start, end: c.end, text: c.text };
    } else {
      joriy.end = c.end;
      joriy.text += ` ${c.text}`;
    }
  }
  if (joriy) out.push(joriy);
  return out;
}

/** `754` → `12:34` */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/**
 * Videoni oʻqiydi: sarlavha, asl til, qisqacha mazmun va tarjima qilingan
 * subtitrlar (vaqt belgilari bilan).
 */
export async function readVideo(
  ref: VideoRef,
  targetLang = 'uz-UZ',
  signal?: AbortSignal,
): Promise<VideoRead> {
  const { settings } = getState();
  const lang = languageName(targetLang);

  const prompt =
    `Ushbu videoni toʻliq koʻrib chiq va ${lang} tilida quyidagini qaytar:\n` +
    `1. title — videoning sarlavhasi (asl tilida).\n` +
    `2. language — videoda gapirilayotgan asl til.\n` +
    `3. summary — mazmuni ${lang} tilida, 4-8 jumla, asosiy fikrlar bilan.\n` +
    `4. captions — butun videoning ${lang} tiliga TARJIMA qilingan subtitri. ` +
    `Har bir boʻlak 2-7 soniya boʻlsin, boshlanish va tugash vaqti bilan. ` +
    `Boʻlaklar vaqt boʻyicha ketma-ket va uzilishsiz boʻlsin. ` +
    `Tarjima soʻzma-soʻz emas, tabiiy va tushunarli boʻlsin.\n` +
    `Video: ${ref.url}`;

  const data = await generateFromVideo<VideoRead>(
    settings.apiKey,
    settings.model,
    ref.url,
    prompt,
    READ_SCHEMA as unknown as Record<string, unknown>,
    signal,
  );

  return {
    title: data.title ?? '',
    language: data.language ?? '',
    summary: data.summary ?? '',
    captions: (data.captions ?? [])
      .filter((c) => c && typeof c.text === 'string' && c.text.trim())
      .map((c) => ({
        start: Math.max(0, Number(c.start) || 0),
        end: Math.max(0, Number(c.end) || 0),
        text: c.text.trim(),
      }))
      .sort((a, b) => a.start - b.start),
  };
}

function srtTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const pad = (n: number, size = 2) => String(n).padStart(size, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/** Subtitrlarni .srt fayl matniga aylantiradi. */
export function toSrt(captions: Caption[]): string {
  return captions
    .map((c, i) => {
      const end = c.end > c.start ? c.end : c.start + 2;
      return `${i + 1}\n${srtTime(c.start)} --> ${srtTime(end)}\n${c.text}\n`;
    })
    .join('\n');
}

/** Subtitrlarni ovozli oʻqish uchun bitta oqim matnga birlashtiradi. */
export function toNarration(read: VideoRead, limit = 4500): string {
  const body = read.captions.map((c) => c.text).join(' ');
  const text = body.trim() || read.summary;
  if (text.length <= limit) return text;
  // Juda uzun boʻlsa — mazmun + boshlanish qismi (bitta audio uchun yetarli).
  return `${read.summary}\n\n${text.slice(0, limit - read.summary.length - 4)}…`;
}
