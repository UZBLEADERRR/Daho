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
