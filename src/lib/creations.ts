import { streamResilient } from './resilient';
import { blocksEmbedding, normalizeUrl } from './openlink';
import { getState, setState } from './store';
import type { Artifact, Course, CourseTopic, MiniApp } from './types';
import { uid } from './utils';

/* ------------------------------------------------------------------ */
/*  Mini ilovalar                                                      */
/* ------------------------------------------------------------------ */

export interface AppMeta {
  name?: string;
  icon?: string;
  description?: string;
}

/** `<!-- daho:app name="Kalkulyator" icon="🧮" -->` ni o'qiydi. */
export function extractAppMeta(html: string): AppMeta {
  const tag = html.match(/<!--\s*daho:app([^>]*?)-->/i);
  if (!tag) return {};
  const read = (key: string) => tag[1].match(new RegExp(`${key}\\s*=\\s*"([^"]*)"`, 'i'))?.[1];
  return {
    name: read('name')?.trim(),
    icon: read('icon')?.trim(),
    description: read('desc')?.trim() ?? read('description')?.trim(),
  };
}

const FALLBACK_ICONS = ['🧩', '📱', '⚙️', '🎯', '📊', '🧮', '🎲', '📝'];

export function saveApp(
  html: string,
  fallbackName: string,
  meta: AppMeta = {},
): MiniApp {
  const parsed = extractAppMeta(html);
  const app: MiniApp = {
    id: uid('app_'),
    name: (meta.name ?? parsed.name ?? fallbackName).slice(0, 40) || 'Ilova',
    icon:
      (meta.icon ?? parsed.icon ?? '').slice(0, 4) ||
      FALLBACK_ICONS[Math.floor(Math.random() * FALLBACK_ICONS.length)],
    description: (meta.description ?? parsed.description ?? '').slice(0, 120),
    html,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    opens: 0,
  };
  setState((s) => ({ apps: [app, ...s.apps] }));
  return app;
}

/** Tashqi havolani mini ilova sifatida qoʻshadi. */
export function saveLinkApp(url: string, name: string, icon = '🔗', description = ''): MiniApp {
  const clean = normalizeUrl(url);
  const app: MiniApp = {
    id: uid('app_'),
    name: name.trim().slice(0, 40) || new URL(clean).hostname,
    icon: icon.slice(0, 4) || '🔗',
    description: description.slice(0, 120),
    html: '',
    url: clean,
    // Bunday saytlar iframe’da ochilmaydi — darhol brauzerga yoʻnaltiramiz.
    external: blocksEmbedding(clean),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    opens: 0,
  };
  setState((s) => ({ apps: [app, ...s.apps] }));
  return app;
}

export function updateApp(id: string, patch: Partial<MiniApp>): void {
  setState((s) => ({
    apps: s.apps.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a)),
  }));
}

export function deleteApp(id: string): void {
  setState((s) => ({ apps: s.apps.filter((a) => a.id !== id) }));
}

/* ------------------------------------------------------------------ */
/*  Rejim uchun qoʻshimcha koʻrsatmalar                                */
/* ------------------------------------------------------------------ */

export const APP_BUILDER_BRIEF = `
Foydalanuvchi ILOVA soʻrayapti. Quyidagi tartibda ishla:

1. Avval 3-5 qatorda ilovaning rejasini yoz: nomi, nima qiladi, qanday ekranlar/boʻlimlari bor,
   qanday maʼlumot saqlanadi.
2. Soʻng BITTA \`\`\`html bloki ichida toʻliq, mustaqil ishlaydigan ilovani ber.

Ilova talablari — bularni birma-bir bajar:
- Faylning eng boshida shu qatorni yoz:
  <!-- daho:app name="Ilova nomi" icon="🧮" desc="bir jumlalik tavsif" -->
  icon sifatida bitta mos emoji tanla.
- Barcha HTML, CSS va JavaScript shu bitta faylda boʻlsin. Tashqi CDN, shrift, rasm ISHLATMA.
- Telefon ekraniga moslashgan: kattа tugmalar, katta shrift, bir ustunli tartib.
- Maʼlumot saqlanishi kerak boʻlsa localStorage ishlat va kalitni ilova nomiga bogʻla.
- Qorongʻi fon (#0e0e12), yorugʻ matn, bitta urgʻu rangi. Silliq oʻtishlar, radiusli burchaklar.
- Barcha yozuvlar oʻzbek tilida.
- Xatoliklarni ushla: boʻsh kiritish, notoʻgʻri son — foydalanuvchiga tushunarli xabar chiqsin.
- Kod toza va izohlangan boʻlsin; funksiyalarni mayda boʻlaklarga ajrat.
3. Blokdan keyin bir jumlada ilovadan qanday foydalanishni tushuntir.`;

export const DOC_BRIEF = `
Foydalanuvchi HUJJAT soʻrayapti. Toʻliq, tayyor hujjatni markdown koʻrinishida yoz:
- Boshida \`#\` bilan sarlavha.
- Mantiqiy boʻlimlar \`##\` bilan, kerak boʻlsa \`###\` kichik boʻlimlar.
- Roʻyxatlar, qalin urgʻular va qisqa xatboshilar ishlat.
- Hajmi mavzuga mos: kamida 400 soʻz.
- Kod bloklaridan foydalanma (ular hujjatga tushmaydi), zarur boʻlsa oddiy matn sifatida yoz.
Javobingda faqat hujjatning oʻzini ber — foydalanuvchi uni Word, PDF yoki slayd qilib yuklab oladi.`;

export const COURSE_BRIEF = `
Foydalanuvchi biror sohani OʻRGANMOQCHI. Quyidagicha ishla:
1. Bir-ikki jumlada kurs haqida ayt.
2. \`create_course\` vositasini chaqir. Mavzular soni kamida 40, imkon boʻlsa 100 ta boʻlsin;
   eng oddiy mavzudan boshlab murakkabiga qarab tartibla. Har bir mavzuga bir jumlalik izoh yoz.
3. Vosita natijasidan keyin foydalanuvchiga «Agent → Kurslar» boʻlimidan mavzuni bosib
   darsni ochishi mumkinligini ayt.`;

export const VIDEO_BRIEF = `
Foydalanuvchi VIDEO soʻrayapti. Video studiyasi alohida ochiladi — sen faqat bir jumlada
tasdiqla va qanday video tayyorlanayotganini ayt. Kod yoki ssenariy yozma.`;

/* ------------------------------------------------------------------ */
/*  Kurs darslari                                                      */
/* ------------------------------------------------------------------ */

function lessonPrompt(course: Course, topic: CourseTopic): string {
  return `Sen "${course.title}" kursining oʻqituvchisisan. Soha: ${course.field}. ` +
    `Daraja: ${course.level}. Talabaning maqsadi: ${course.goal || 'sohani puxta oʻzlashtirish'}.

Mavzu: «${topic.title}»
${topic.summary ? `Nima oʻrganiladi: ${topic.summary}` : ''}

Shu mavzu boʻyicha BITTA toʻliq, mustaqil ishlaydigan HTML dars sahifasini yoz.
Faqat \`\`\`html bloki qaytar, boshqa hech qanday matn yozma.

Dars sahifasi majburiy tarkibi:
1. Sarlavha va bir jumlalik maqsad.
2. Tushuntirish — sodda tildan boshlab, bosqichma-bosqich. Qiyin atamalarni izohla.
3. Kamida bitta VIZUAL: SVG diagramma, jadval, taqqoslash kartochkalari yoki animatsiyali misol.
   Vizual mavzuni haqiqatan tushuntirsin, bezak boʻlmasin.
4. 2-3 ta yechilgan misol yoki namuna.
5. Interaktiv TEST: kamida 5 ta savol, variantli. Javob tanlangach darhol toʻgʻri/notoʻgʻri
   koʻrsatilsin va qisqa izoh chiqsin. Oxirida natija (necha ball) va qayta boshlash tugmasi.
6. «Qisqacha xulosa» — 3-5 punkt.

Texnik talablar:
- Barcha CSS va JS shu faylda. Tashqi CDN, shrift, rasm ISHLATMA.
- Telefon ekraniga moslashgan, kattа tugmalar, bir ustunli tartib.
- Qorongʻi fon (#0e0e12), yorugʻ matn (#ededf0), urgʻu rangi #8b7cf6.
- Hamma matn oʻzbek tilida (lotin yozuvi).
- Sahifa uzun boʻlsa boʻlimlarni yigʻiladigan qilma — talaba pastga scroll qilsin.`;
}

/**
 * Mavzu uchun interaktiv dars yaratadi va uni artifact sifatida saqlaydi.
 * Yaratilgan artifact id sini qaytaradi.
 */
export async function generateLesson(
  course: Course,
  topic: CourseTopic,
  onProgress?: (chars: number) => void,
  signal?: AbortSignal,
): Promise<Artifact> {
  const { settings } = getState();
  let text = '';

  // Chidamli oqim: server band boʻlsa kutadi, model javobni kesib qoʻysa
  // oʻzi davom ettiradi — dars yarim qolmaydi.
  await streamResilient({
    apiKey: settings.apiKey,
    model: settings.model,
    contents: [{ role: 'user', parts: [{ text: lessonPrompt(course, topic) }] }],
    temperature: 0.7,
    signal,
    onText: (chunk) => {
      text += chunk;
      onProgress?.(text.length);
    },
    rollback: (chars) => {
      text = text.slice(0, Math.max(0, text.length - chars));
      onProgress?.(text.length);
    },
    allowModelSwap: true,
  });

  const match = text.match(/```html\s*\n([\s\S]*?)```/i) ?? text.match(/```\s*\n([\s\S]*?)```/);
  const html = (match?.[1] ?? text).trim();
  if (html.length < 200) throw new Error('Dars yaratilmadi — qaytadan urinib koʻring.');

  const artifact: Artifact = {
    id: uid('a_'),
    kind: 'html',
    title: topic.title,
    content: html,
    lang: 'html',
    createdAt: Date.now(),
    pinned: true,
  };

  setState((s) => ({
    artifacts: [artifact, ...s.artifacts],
    courses: s.courses.map((c) =>
      c.id === course.id
        ? {
            ...c,
            topics: c.topics.map((t) =>
              t.id === topic.id ? { ...t, lessonArtifactId: artifact.id } : t,
            ),
          }
        : c,
    ),
  }));

  return artifact;
}

export function markTopicDone(courseId: string, topicId: string, done: boolean): void {
  setState((s) => ({
    courses: s.courses.map((c) =>
      c.id === courseId
        ? { ...c, topics: c.topics.map((t) => (t.id === topicId ? { ...t, done } : t)) }
        : c,
    ),
  }));
}

export function deleteCourse(id: string): void {
  setState((s) => ({ courses: s.courses.filter((c) => c.id !== id) }));
}
