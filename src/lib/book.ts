/**
 * Kitob yozuvchi agent.
 *
 * Ish tartibi — haqiqiy muharrir kabi:
 *
 *   1. **Savol-javob.** Foydalanuvchi «kitob yozmoqchiman» deydi; agent
 *      yetishmayotgan narsani soʻraydi (janr, kim uchun, hajm, ohang).
 *   2. **Kitob kitobi (bible).** Qahramonlar, muhit, atamalar, ohang va
 *      vizual uslub bitta joyda qayd etiladi. Bu — izchillikning kaliti:
 *      har bir bob shu hujjat asosida yoziladi, shuning uchun 30-bobdagi
 *      qahramon 3-bobdagidan farq qilmaydi.
 *   3. **Tuzilma.** Boblar roʻyxati, har biriga qisqacha mazmun.
 *   4. **Muqova.** Kitob nomi va uslubiga mos rasm.
 *   5. **Boblar.** Har bir bob yozilgandan soʻng undan «recap» chiqariladi
 *      va keyingi bobga uzatiladi — voqea uzilib qolmaydi.
 *   6. **Rasmlar.** Har bobga muqova bilan bir uslubdagi illyustratsiya.
 *
 * Hamma bosqich `startTask` ichida yuradi, shuning uchun foydalanuvchi
 * boshqa boʻlimga oʻtsa ham yozish davom etaveradi.
 */

import { streamResilient } from './resilient';
import { canMakeImages, completeAny, imageAny, jsonAny, pickForJob } from './providers';
import { getState, setState } from './store';
import { noteTask, startTask } from './tasks';
import type { Artifact, Book, BookBible, BookChapter } from './types';
import { uid } from './utils';

/* ------------------------------------------------------------------ */
/*  Saqlash                                                            */
/* ------------------------------------------------------------------ */

export function getBook(id: string): Book | undefined {
  return getState().books.find((b) => b.id === id);
}

export function patchBook(id: string, patch: Partial<Book>): void {
  setState((s) => ({
    books: s.books.map((b) => (b.id === id ? { ...b, ...patch, updatedAt: Date.now() } : b)),
  }));
}

function patchChapter(bookId: string, chapterId: string, patch: Partial<BookChapter>): void {
  setState((s) => ({
    books: s.books.map((b) =>
      b.id === bookId
        ? {
            ...b,
            updatedAt: Date.now(),
            chapters: b.chapters.map((c) => (c.id === chapterId ? { ...c, ...patch } : c)),
          }
        : b,
    ),
  }));
}

export function deleteBook(id: string): void {
  setState((s) => ({ books: s.books.filter((b) => b.id !== id) }));
}

const EMPTY_BIBLE: BookBible = {
  premise: '',
  audience: '',
  tone: '',
  cast: [],
  setting: '',
  glossary: [],
  visualStyle: '',
  rules: [],
};

export interface BookSetup {
  request: string;
  kind?: string;
  language?: string;
  chapters?: number;
  wordsPerChapter?: number;
  withImages?: boolean;
  chatId?: string;
}

export function createBook(setup: BookSetup): Book {
  const book: Book = {
    id: uid('bk_'),
    title: 'Nomsiz kitob',
    subtitle: '',
    request: setup.request,
    kind: setup.kind ?? 'aniqlanmagan',
    language: setup.language ?? 'oʻzbek',
    stage: 'reja',
    bible: { ...EMPTY_BIBLE },
    chapters: [],
    wordsPerChapter: setup.wordsPerChapter ?? 1200,
    withImages: setup.withImages ?? true,
    chatId: setup.chatId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  setState((s) => ({ books: [book, ...s.books] }));
  return book;
}

/* ------------------------------------------------------------------ */
/*  Savollar — ish boshlanishidan oldin                                */
/* ------------------------------------------------------------------ */

export interface BookQuestion {
  question: string;
  options: string[];
  /** Bir nechta variant tanlash mumkinmi */
  multi: boolean;
}

const QUESTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    savollar: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          savol: { type: 'STRING' },
          variantlar: { type: 'ARRAY', items: { type: 'STRING' } },
          koʻp: { type: 'BOOLEAN' },
        },
        required: ['savol', 'variantlar'],
      },
    },
  },
  required: ['savollar'],
};

/**
 * Foydalanuvchi soʻroviga qarab 3-6 ta aniqlovchi savol tuzadi.
 * Savollar tayyor variantlar bilan keladi — telefonda yozish qiyin.
 */
export async function askBookQuestions(
  request: string,
  signal?: AbortSignal,
): Promise<BookQuestion[]> {
  const prompt = `Foydalanuvchi kitob yozdirmoqchi. Uning soʻrovi:
«${request}»

Kitobni yozishni boshlashdan OLDIN bilishing kerak boʻlgan eng muhim 4-6 ta savolni tuz.
Qoidalar:
- Savollar oʻzbek tilida, qisqa va aniq boʻlsin.
- Har bir savolga 3-5 ta tayyor variant ber (foydalanuvchi telefonda bosib tanlaydi).
- Foydalanuvchi soʻrovida ALLAQACHON aytilgan narsani qayta soʻrama.
- Eng muhimlarini soʻra: janr/turi, kim uchun, hajmi (necha bob), ohang va uslub,
  bosh qahramon yoki asosiy gʻoya, rasm kerakmi.
- Falsafiy yoki noaniq savol berma — javobi kitobning mazmunini oʻzgartiradigan savol ber.`;

  const res = await jsonAny<{
    savollar: Array<{ savol: string; variantlar: string[]; koʻp?: boolean }>;
  }>(prompt, QUESTION_SCHEMA, signal);

  return (res.savollar ?? []).slice(0, 6).map((q) => ({
    question: q.savol,
    options: (q.variantlar ?? []).slice(0, 5),
    multi: Boolean(q.koʻp),
  }));
}

/* ------------------------------------------------------------------ */
/*  Reja: kitob kitobi + boblar                                        */
/* ------------------------------------------------------------------ */

const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sarlavha: { type: 'STRING' },
    kichik_sarlavha: { type: 'STRING' },
    turi: { type: 'STRING' },
    gʻoya: { type: 'STRING' },
    kitobxon: { type: 'STRING' },
    ohang: { type: 'STRING' },
    muhit: { type: 'STRING' },
    vizual_uslub: { type: 'STRING' },
    qahramonlar: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          ism: { type: 'STRING' },
          roli: { type: 'STRING' },
          tavsif: { type: 'STRING' },
        },
        required: ['ism', 'roli', 'tavsif'],
      },
    },
    atamalar: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { atama: { type: 'STRING' }, maʼnosi: { type: 'STRING' } },
        required: ['atama', 'maʼnosi'],
      },
    },
    qoidalar: { type: 'ARRAY', items: { type: 'STRING' } },
    boblar: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sarlavha: { type: 'STRING' },
          mazmuni: { type: 'STRING' },
        },
        required: ['sarlavha', 'mazmuni'],
      },
    },
  },
  required: ['sarlavha', 'gʻoya', 'boblar'],
};

interface PlanResponse {
  sarlavha: string;
  kichik_sarlavha?: string;
  turi?: string;
  gʻoya: string;
  kitobxon?: string;
  ohang?: string;
  muhit?: string;
  vizual_uslub?: string;
  qahramonlar?: Array<{ ism: string; roli: string; tavsif: string }>;
  atamalar?: Array<{ atama: string; maʼnosi: string }>;
  qoidalar?: string[];
  boblar: Array<{ sarlavha: string; mazmuni: string }>;
}

/** Kitobning konsepsiyasi, izchillik hujjati va boblar rejasini tuzadi. */
async function buildPlan(
  book: Book,
  answers: string,
  chapterCount: number,
  signal?: AbortSignal,
): Promise<void> {
  const prompt = `Sen tajribali muharrir va yozuvchisan. Oʻzbek tilida (lotin yozuvi) kitob rejasini tuzasan.

## Foydalanuvchi soʻrovi
${book.request}

${answers ? `## Aniqlashtirilgan javoblar\n${answers}` : ''}

## Vazifang
Shu kitob uchun toʻliq reja tuz:

1. **sarlavha** — jozibador, esda qoladigan nom (oʻzbekcha).
2. **kichik_sarlavha** — bir qatorli izoh.
3. **turi** — badiiy roman / qissa / oʻquv qoʻllanma / biznes / esse / bolalar kitobi va h.k.
4. **gʻoya** — bir-ikki jumlada kitobning oʻzagi.
5. **kitobxon** — kim oʻqiydi.
6. **ohang** — yozuv uslubi (masalan «sokin, tasvirlarga boy» yoki «qisqa, amaliy»).
7. **muhit** — voqea joyi va davri; oʻquv kitobi boʻlsa — soha konteksti.
8. **vizual_uslub** — barcha rasmlar bir xil koʻrinishi uchun aniq uslub tavsifi
   (masalan «iliq oxra ranglar, qoʻlda chizilgan akvarel, yumshoq soyalar»).
9. **qahramonlar** — 3-8 ta. Badiiy boʻlmasa: asosiy tushunchalar yoki shaxslar.
   Har biriga ism, roli va ESLAB QOLINADIGAN aniq tavsif (yoshi, koʻrinishi, xarakteri).
10. **atamalar** — kitob boʻylab bir xil ishlatiladigan 3-10 ta soʻz/atama va maʼnosi.
11. **qoidalar** — 3-6 ta qatʼiy qoida (masalan «hikoya birinchi shaxsda»,
    «har bob savol bilan tugaydi», «texnik atamalar albatta izohlanadi»).
12. **boblar** — AYNAN ${chapterCount} ta bob. Har biriga sarlavha va 2-3 jumlalik mazmun.
    Boblar mantiqiy ketma-ketlikda borsin: boshlanish → rivoj → cho'qqi → yechim
    (oʻquv kitobida: oddiydan murakkabga). Har bob avvalgisining davomi boʻlsin.

Javob faqat JSON.`;

  const plan = await jsonAny<PlanResponse>(prompt, PLAN_SCHEMA, signal);

  const chapters: BookChapter[] = (plan.boblar ?? []).map((c, i) => ({
    id: uid('ch_'),
    number: i + 1,
    title: c.sarlavha,
    brief: c.mazmuni,
    text: '',
    recap: '',
    words: 0,
    done: false,
  }));

  patchBook(book.id, {
    title: plan.sarlavha || book.title,
    subtitle: plan.kichik_sarlavha ?? '',
    kind: plan.turi || book.kind,
    bible: {
      premise: plan.gʻoya ?? '',
      audience: plan.kitobxon ?? '',
      tone: plan.ohang ?? '',
      cast: (plan.qahramonlar ?? []).map((c) => ({
        name: c.ism,
        role: c.roli,
        detail: c.tavsif,
      })),
      setting: plan.muhit ?? '',
      glossary: (plan.atamalar ?? []).map((g) => ({ term: g.atama, meaning: g.maʼnosi })),
      visualStyle: plan.vizual_uslub ?? 'yagona uslub, iliq ranglar',
      rules: plan.qoidalar ?? [],
    },
    chapters,
  });
}

/* ------------------------------------------------------------------ */
/*  Izchillik konteksti                                                */
/* ------------------------------------------------------------------ */

/**
 * Har bir bobga beriladigan «yagona haqiqat» matni. Kitob kitobi +
 * avvalgi boblarning xulosasi. Shu tufayli kitob boshdan oxir bir xil
 * ohangda, bir xil qahramonlar va atamalar bilan qoladi.
 */
function continuityContext(book: Book, upto: number): string {
  const b = book.bible;
  const lines: string[] = [];

  lines.push(`# KITOB: «${book.title}»${book.subtitle ? ` — ${book.subtitle}` : ''}`);
  lines.push(`Turi: ${book.kind}. Tili: ${book.language}.`);
  if (b.premise) lines.push(`Gʻoya: ${b.premise}`);
  if (b.audience) lines.push(`Kitobxon: ${b.audience}`);
  if (b.tone) lines.push(`Ohang va uslub: ${b.tone}`);
  if (b.setting) lines.push(`Muhit: ${b.setting}`);

  if (b.cast.length) {
    lines.push('\n## Qahramonlar / asosiy shaxslar — TAVSIFINI OʻZGARTIRMA');
    for (const c of b.cast) lines.push(`- ${c.name} (${c.role}): ${c.detail}`);
  }
  if (b.glossary.length) {
    lines.push('\n## Atamalar — AYNAN shu maʼnoda ishlat');
    for (const g of b.glossary) lines.push(`- ${g.term} — ${g.meaning}`);
  }
  if (b.rules.length) {
    lines.push('\n## Qatʼiy qoidalar');
    for (const r of b.rules) lines.push(`- ${r}`);
  }

  lines.push('\n## Kitob tuzilmasi');
  for (const c of book.chapters) {
    const mark = c.number < upto ? '✓' : c.number === upto ? '→' : ' ';
    lines.push(`${mark} ${c.number}. ${c.title} — ${c.brief}`);
  }

  const written = book.chapters.filter((c) => c.number < upto && c.recap);
  if (written.length) {
    lines.push('\n## Shu paytgacha nima boʻldi (yozilgan boblar xulosasi)');
    // Oxirgi boblar batafsilroq — yaqin kontekst muhimroq.
    for (const c of written.slice(-8)) lines.push(`${c.number}. ${c.title}: ${c.recap}`);
  }
  const last = written[written.length - 1];
  if (last?.text) {
    lines.push('\n## Avvalgi bobning oxirgi qatorlari — shu joydan ulab ket');
    lines.push(`…${last.text.slice(-700)}`);
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Bob yozish                                                         */
/* ------------------------------------------------------------------ */

async function writeChapter(
  bookId: string,
  chapter: BookChapter,
  signal?: AbortSignal,
  onChars?: (n: number) => void,
): Promise<void> {
  const { settings } = getState();
  const book = getBook(bookId);
  if (!book) return;

  // Kitob matni uchun eng mos model (avto rejim yoqilgan boʻlsa oʻzi tanlaydi).
  const model = pickForJob('matn');
  const context = continuityContext(book, chapter.number);
  const isLast = chapter.number === book.chapters.length;

  const prompt = `${context}

---

# HOZIR YOZILADIGAN BOB
${chapter.number}-bob: «${chapter.title}»
Rejadagi mazmuni: ${chapter.brief}

## Talablar
- Taxminan ${book.wordsPerChapter} soʻz. Qisqartirma — toʻliq yoz.
- Faqat shu bobning matnini yoz. Bob sarlavhasini \`## ${chapter.number}. ${chapter.title}\`
  koʻrinishida bir marta yoz, keyin matn.
- Yuqoridagi qahramonlar, atamalar, ohang va qoidalarga QATʼIY amal qil.
  Qahramon tavsifini oʻzgartirma, yangi ism oʻylab topma (reja talab qilmasa).
- Avvalgi bob qayerda tugagan boʻlsa — oʻsha yerdan tabiiy davom et.
  «Avvalgi bobda…» deb takrorlama.
- Markdown ishlat: xatboshilar, kerak boʻlsa \`###\` kichik boʻlimlar,
  dialog uchun tire (—). Kod bloklaridan foydalanma.
${isLast ? '- Bu OXIRGI bob: kitobni mantiqan yakunla, ochiq savol qoldirma.' : '- Bob oxiri kitobxonni keyingi bobga tortsin.'}
- Boshida yoki oxirida «mana bob», «davom etamiz» kabi izoh YOZMA — faqat kitob matni.`;

  let text = '';
  await streamResilient({
    apiKey: settings.apiKey,
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction:
      'Sen mohir yozuvchisan. Oʻzbek tilida (lotin yozuvi) ravon, jonli va izchil yozasan. ' +
      'Berilgan kontekstdan chetga chiqmaysan.',
    temperature: 0.85,
    signal,
    onText: (chunk) => {
      text += chunk;
      onChars?.(text.length);
    },
    rollback: (chars) => {
      text = text.slice(0, Math.max(0, text.length - chars));
    },
    allowModelSwap: true,
  });

  const clean = text.replace(/^```(?:markdown|md)?\s*\n?|\n?```\s*$/g, '').trim();
  if (clean.length < 200) throw new Error(`${chapter.number}-bob yozilmadi — qaytadan urining.`);

  patchChapter(bookId, chapter.id, {
    text: clean,
    words: clean.split(/\s+/).length,
    done: true,
  });

  // Keyingi boblar uchun qisqa xulosa — izchillikning ikkinchi qatlami.
  try {
    const recap = await completeAny(
      settings.model,
      `Quyidagi bobni 3-4 jumlada xulosala. Nima sodir boʻldi, kim ishtirok etdi, ` +
        `nima oʻzgardi, qanday tugadi. Faqat xulosani yoz:\n\n${clean.slice(0, 6000)}`,
      { temperature: 0.3, signal },
    );
    patchChapter(bookId, chapter.id, { recap: recap.slice(0, 700) });
  } catch {
    // Xulosa chiqmasa bobning boshi ishlatiladi — izchillik baribir saqlanadi.
    patchChapter(bookId, chapter.id, { recap: clean.slice(0, 400) });
  }
}

/* ------------------------------------------------------------------ */
/*  Rasmlar                                                            */
/* ------------------------------------------------------------------ */

function saveImageArtifact(title: string, data: string, mimeType: string): Artifact {
  const artifact: Artifact = {
    id: uid('a_'),
    kind: 'image',
    title,
    content: data,
    mimeType,
    createdAt: Date.now(),
    pinned: true,
  };
  setState((s) => ({ artifacts: [artifact, ...s.artifacts] }));
  return artifact;
}

/** Kitob muqovasi — nomi va uslubiga mos. */
export async function makeCover(bookId: string, signal?: AbortSignal): Promise<Artifact | null> {
  const book = getBook(bookId);
  if (!book) return null;

  const prompt = `Kitob muqovasi uchun rasm. Vertikal, kitob muqovasi nisbatida (2:3).
Kitob nomi: «${book.title}».
Turi: ${book.kind}. Gʻoyasi: ${book.bible.premise}.
Muhit: ${book.bible.setting}.
Vizual uslub: ${book.bible.visualStyle}.
Rasm professional kitob muqovasidek kuchli va yodda qoladigan boʻlsin: aniq markaziy tasvir,
chuqur ranglar, kayfiyat ${book.bible.tone || 'jiddiy va jozibali'}.
Rasm ustiga HECH QANDAY matn, harf yoki yozuv chizma — faqat tasvir.`;

  const images = await imageAny(prompt, [], signal);
  const image = images[0];
  if (!image) return null;

  const artifact = saveImageArtifact(`${book.title} — muqova`, image.data, image.mimeType);
  patchBook(bookId, { coverArtifactId: artifact.id });
  return artifact;
}

/** Bob uchun illyustratsiya — muqova bilan bir uslubda. */
async function makeChapterImage(
  bookId: string,
  chapter: BookChapter,
  signal?: AbortSignal,
): Promise<void> {
  const book = getBook(bookId);
  if (!book) return;

  const prompt = `Kitob ichidagi illyustratsiya (${chapter.number}-bob).
Kitob: «${book.title}». Bob: «${chapter.title}».
Bobda nima boʻladi: ${chapter.brief}
Muhit: ${book.bible.setting}.
Vizual uslub — kitobning BARCHA rasmlari bilan bir xil boʻlishi shart: ${book.bible.visualStyle}.
${book.bible.cast.length ? `Qahramonlar koʻrinishi: ${book.bible.cast.map((c) => `${c.name} — ${c.detail}`).join('; ')}` : ''}
Gorizontal, kayfiyati bobga mos. Rasmda matn yoki harf boʻlmasin.`;

  try {
    const images = await imageAny(prompt, [], signal);
    const image = images[0];
    if (!image) return;
    const artifact = saveImageArtifact(`${chapter.number}. ${chapter.title}`, image.data, image.mimeType);
    patchChapter(bookId, chapter.id, { imageArtifactId: artifact.id });
  } catch {
    /* rasm chiqmasa kitob baribir yoziladi */
  }
}

/* ------------------------------------------------------------------ */
/*  Toʻliq jarayon                                                     */
/* ------------------------------------------------------------------ */

export interface WriteOptions {
  /** Savollarga berilgan javoblar (matn koʻrinishida) */
  answers?: string;
  chapterCount?: number;
  onStep?: (step: string) => void;
}

/**
 * Kitobni boshidan oxirigacha yozadi. Uzilib qolsa — qayta chaqirilganda
 * yozilmagan bobdan davom etadi (yozilganini qaytadan yozmaydi).
 */
export async function writeBook(bookId: string, opts: WriteOptions = {}): Promise<void> {
  const book = getBook(bookId);
  if (!book) return;

  await startTask(
    { kind: 'kitob', targetId: bookId, title: book.title, note: 'reja tuzilmoqda' },
    async (signal, taskId) => {
      const step = (text: string) => {
        noteTask(taskId, text);
        opts.onStep?.(text);
      };

      try {
        patchBook(bookId, { stage: 'reja', error: undefined });

        // 1. Reja — hali tuzilmagan boʻlsa.
        const fresh = getBook(bookId);
        if (fresh && !fresh.chapters.length) {
          step('reja va qahramonlar tayyorlanmoqda');
          await buildPlan(fresh, opts.answers ?? '', opts.chapterCount ?? 12, signal);
        }

        // Rasm modeli yoʻq boʻlsa (masalan faqat matn modeli ulangan) —
        // kitobni rasmsiz yozamiz, ish toʻxtab qolmasin.
        const images = canMakeImages();
        if (!images && getBook(bookId)?.withImages) {
          patchBook(bookId, { withImages: false });
          step('rasm modeli yoʻq — kitob rasmsiz yoziladi');
        }

        // 2. Muqova.
        const withCover = getBook(bookId);
        if (images && withCover && !withCover.coverArtifactId) {
          patchBook(bookId, { stage: 'muqova' });
          step('muqova chizilmoqda');
          await makeCover(bookId, signal).catch(() => null);
        }

        // 3. Boblar — bittalab, izchillik konteksti bilan.
        patchBook(bookId, { stage: 'yozilmoqda' });
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const current = getBook(bookId);
          if (!current) return;
          const next = current.chapters.find((c) => !c.done);
          if (!next) break;

          step(`${next.number}/${current.chapters.length}-bob: ${next.title}`);
          await writeChapter(bookId, next, signal, (chars) =>
            noteTask(taskId, `${next.number}-bob — ${chars} belgi`),
          );

          if (current.withImages) {
            step(`${next.number}-bobga rasm chizilmoqda`);
            await makeChapterImage(bookId, next, signal);
          }
        }

        patchBook(bookId, { stage: 'tayyor' });
        step('kitob tayyor');
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          patchBook(bookId, { stage: 'yozilmoqda' });
          return;
        }
        patchBook(bookId, { stage: 'xato', error: String((err as Error)?.message ?? err) });
      }
    },
  );
}

/** Bitta bobni qaytadan yozadi (foydalanuvchi yoqtirmasa). */
export async function rewriteChapter(bookId: string, chapterId: string): Promise<void> {
  const book = getBook(bookId);
  const chapter = book?.chapters.find((c) => c.id === chapterId);
  if (!book || !chapter) return;

  patchChapter(bookId, chapterId, { done: false, text: '', recap: '' });
  await startTask(
    { kind: 'kitob', targetId: bookId, title: book.title, note: `${chapter.number}-bob qayta yozilmoqda` },
    async (signal, taskId) => {
      try {
        await writeChapter(bookId, { ...chapter, text: '', recap: '', done: false }, signal, (chars) =>
          noteTask(taskId, `${chars} belgi`),
        );
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          patchBook(bookId, { error: String((err as Error)?.message ?? err) });
        }
      }
    },
  );
}

/* ------------------------------------------------------------------ */
/*  Chiqarish                                                          */
/* ------------------------------------------------------------------ */

/** Butun kitobni markdown matnga yigʻadi — Word/PDF ga chiqarish uchun. */
export function bookToMarkdown(book: Book): string {
  const parts: string[] = [`# ${book.title}`];
  if (book.subtitle) parts.push(`_${book.subtitle}_`);
  if (book.bible.premise) parts.push(`\n> ${book.bible.premise}`);

  parts.push('\n## Mundarija');
  for (const c of book.chapters) parts.push(`${c.number}. ${c.title}`);

  for (const c of book.chapters) {
    if (!c.text) continue;
    parts.push('\n---\n');
    parts.push(c.text);
  }
  return parts.join('\n');
}

/** Kitobdagi rasmlar — hujjatga qoʻshish uchun. */
export function bookImages(book: Book): Array<{ id: string; caption: string }> {
  const out: Array<{ id: string; caption: string }> = [];
  if (book.coverArtifactId) out.push({ id: book.coverArtifactId, caption: book.title });
  for (const c of book.chapters) {
    if (c.imageArtifactId) out.push({ id: c.imageArtifactId, caption: `${c.number}. ${c.title}` });
  }
  return out;
}

export function bookProgress(book: Book): { done: number; total: number; words: number } {
  const done = book.chapters.filter((c) => c.done).length;
  return {
    done,
    total: book.chapters.length,
    words: book.chapters.reduce((sum, c) => sum + c.words, 0),
  };
}
