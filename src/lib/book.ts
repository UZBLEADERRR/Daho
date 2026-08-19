/**
 * Kitob (uzun matn) yozish.
 *
 * Muammo nimada edi: kitob bitta javobda soʻralganda model chiqish
 * chegarasiga urilardi va boblarni yarim tashlab, keyingisiga sakrardi —
 * matn tugamagan boʻlsa ham «tugadi» koʻrinardi. «Shu bobni tuzatib ber»
 * deganda ham model butun matnni qaytadan yozishga urinib, yana uzilardi.
 *
 * Yechim — bob alohida birlik:
 *   1. avval REJA tuziladi (bob nomlari va nima yoritilishi);
 *   2. har bir bob ALOHIDA soʻrovda yoziladi;
 *   3. bob oxirida `<<BOB_TUGADI>>` belgisi talab qilinadi — belgisi
 *      kelmasa matn uzilgan hisoblanadi va uzilgan joydan davom ettiriladi
 *      (bir necha marta, kerak boʻlsa);
 *   4. har bobning holati saqlanadi: tayyor / chala / xato — shuning uchun
 *      aynan bitta bobni qayta yozdirish yoki davom ettirish mumkin.
 */
import { generateJson } from './gemini';
import type { GeminiContent } from './gemini';
import { streamResilient } from './resilient';
import { getState, setState } from './store';
import { noteTask, startTask } from './tasks';
import type { Book, BookChapter } from './types';
import { uid } from './utils';

/** Bob toʻliq yozilganini bildiruvchi belgi. */
const DONE_MARK = '<<BOB_TUGADI>>';
/** Bitta bob uchun eng koʻp davom ettirish soni. */
const MAX_ROUNDS = 8;

export function getBook(id: string): Book | undefined {
  return getState().books.find((b) => b.id === id);
}

function patchBook(id: string, patch: Partial<Book>): void {
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
            chapters: b.chapters.map((c) =>
              c.id === chapterId ? { ...c, ...patch, updatedAt: Date.now() } : c,
            ),
          }
        : b,
    ),
  }));
}

export function countWords(text: string): number {
  const clean = text.replace(/[#*_`>-]/g, ' ').trim();
  return clean ? clean.split(/\s+/).length : 0;
}

/* ------------------------------------------------------------------ */
/*  Reja                                                               */
/* ------------------------------------------------------------------ */

const OUTLINE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    chapters: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          brief: { type: 'STRING', description: 'Bobda nimalar yoritiladi — 1-3 jumla' },
        },
        required: ['title', 'brief'],
      },
    },
  },
  required: ['title', 'chapters'],
};

export interface BookRequest {
  topic: string;
  audience?: string;
  style?: string;
  chapters?: number;
  targetWords?: number;
}

/** Kitob rejasini tuzadi va uni saqlaydi (boblar hali boʻsh). */
export async function createBook(req: BookRequest, signal?: AbortSignal): Promise<Book> {
  const { settings } = getState();
  const count = Math.min(40, Math.max(3, req.chapters ?? 10));
  const audience = req.audience?.trim() || 'qiziquvchi oʻquvchi';
  const style = req.style?.trim() || 'sodda, jonli va misollarga boy';

  const prompt =
    `«${req.topic}» mavzusida oʻzbek tilida KITOB rejasini tuz.\n` +
    `Kitobxon: ${audience}. Uslub: ${style}.\n` +
    `Aynan ${count} ta bob boʻlsin. Boblar mantiqiy ketma-ketlikda: oddiydan murakkabga, ` +
    `har biri oldingisiga tayansin, mavzular takrorlanmasin.\n` +
    `Har bob uchun: title — bobning nomi, brief — bobda nimalar yoritilishi (1-3 jumla, aniq).`;

  const plan = await generateJson<{ title: string; chapters: Array<{ title: string; brief: string }> }>(
    settings.apiKey,
    settings.model,
    prompt,
    OUTLINE_SCHEMA,
    signal,
  );

  const book: Book = {
    id: uid('book'),
    title: plan.title?.trim() || req.topic,
    topic: req.topic,
    audience,
    style,
    targetWords: Math.min(4000, Math.max(300, req.targetWords ?? 900)),
    chapters: (plan.chapters ?? []).slice(0, count).map((c, i) => ({
      id: uid('bob'),
      no: i + 1,
      title: c.title?.trim() || `${i + 1}-bob`,
      brief: c.brief?.trim() ?? '',
      content: '',
      words: 0,
      status: 'kutilmoqda' as const,
      updatedAt: Date.now(),
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  setState((s) => ({ books: [book, ...s.books] }));
  return book;
}

export function deleteBook(id: string): void {
  setState((s) => ({ books: s.books.filter((b) => b.id !== id) }));
}

/* ------------------------------------------------------------------ */
/*  Bob yozish                                                         */
/* ------------------------------------------------------------------ */

function systemFor(book: Book): string {
  return `Sen tajribali muallifsan. Oʻzbek tilida (lotin yozuvida) kitob yozyapsan.

Kitob: «${book.title}»
Mavzu: ${book.topic}
Kitobxon: ${book.audience}
Uslub: ${book.style}

Qoidalar:
- Faqat soʻralgan bobning matnini yoz. Boshqa boblarga oʻtma, ularning
  sarlavhasini yozma, «keyingi bobda…» deb yakunlama.
- Bobni TOʻLIQ yoz: kirish, asosiy qism (bir nechta kichik sarlavha bilan),
  misollar, va yakuniy xulosa. Yarim tashlab ketma.
- Markdown ishlat: \`##\` bob sarlavhasi, \`###\` kichik sarlavhalar, roʻyxatlar,
  qalin urgʻular. Kod bloklaridan foydalanma.
- Suv quyma. Har xatboshi yangi maʼlumot bersin.
- Bobni toʻliq tugatganingdan SOʻNG oxirgi qatorga aynan shu belgini yoz: ${DONE_MARK}
  Belgi faqat bob haqiqatan tugagandan keyin qoʻyiladi — matn oʻrtasida emas.
- Agar javobing uzilib qolsa, keyingi soʻrovda AYNAN uzilgan joydan davom ettirasan:
  qaytadan boshlamaysan, takrorlamaysan.`;
}

function chapterPrompt(book: Book, chapter: BookChapter, extra?: string): string {
  const outline = book.chapters
    .map((c) => `${c.no}. ${c.title}${c.no === chapter.no ? '  ← HOZIR SHU' : ''}`)
    .join('\n');

  const previous = book.chapters.find((c) => c.no === chapter.no - 1);
  const tail = previous?.content
    ? `\n\nOldingi bob («${previous.title}») shunday yakunlangan edi:\n"""\n${previous.content
        .trim()
        .slice(-700)}\n"""\nShu joydan mantiqan davom et, lekin oldingi bobni takrorlama.`
    : '';

  return (
    `Kitobning toʻliq rejasi:\n${outline}\n\n` +
    `Endi ${chapter.no}-bobni yoz: «${chapter.title}».\n` +
    `Bobda yoritilishi kerak: ${chapter.brief}\n` +
    `Taxminiy hajm: ${book.targetWords} soʻz atrofida.` +
    tail +
    (extra ? `\n\nQoʻshimcha koʻrsatma: ${extra}` : '') +
    `\n\nBobning matnini yoz va tugagach ${DONE_MARK} belgisini qoʻy.`
  );
}

interface WriteResult {
  text: string;
  complete: boolean;
  rounds: number;
}

/**
 * Bitta bobni yozadi. Matn uzilib qolsa — uzilgan joydan davom ettiradi,
 * shuning uchun natija chala qolmaydi.
 */
async function runChapter(
  book: Book,
  chapter: BookChapter,
  signal: AbortSignal,
  onProgress: (words: number, round: number) => void,
  extra?: string,
  seed = '',
): Promise<WriteResult> {
  const { settings } = getState();
  const system = systemFor(book);
  const contents: GeminiContent[] = [
    { role: 'user', parts: [{ text: chapterPrompt(book, chapter, extra) }] },
  ];

  let full = seed;
  if (seed) {
    // Davom ettirish: modelga yozilgan qismni koʻrsatamiz.
    contents.push({ role: 'model', parts: [{ text: seed }] });
    contents.push({
      role: 'user',
      parts: [
        {
          text:
            'Matn uzilib qolgan. AYNAN uzilgan joydan davom ettir — qaytadan boshlama, ' +
            `takrorlama, sarlavhani qayta yozma. Bob tugagach ${DONE_MARK} yoz.`,
        },
      ],
    });
  }

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    let piece = '';
    const result = await streamResilient({
      apiKey: settings.apiKey,
      model: settings.model,
      systemInstruction: system,
      contents,
      temperature: 0.85,
      signal,
      allowModelSwap: true,
      onText: (chunk) => {
        piece += chunk;
        onProgress(countWords(full + piece), round);
      },
      rollback: (chars) => {
        piece = piece.slice(0, Math.max(0, piece.length - chars));
      },
    });

    const text = (result.text || piece).trim();
    if (!text) break;

    full = full ? `${full.replace(/\s+$/, '')}\n\n${text}` : text;

    if (full.includes(DONE_MARK)) {
      return { text: full.replace(DONE_MARK, '').trim(), complete: true, rounds: round };
    }

    // Uzilgan — davom ettiramiz.
    contents.push({ role: 'model', parts: [{ text }] });
    contents.push({
      role: 'user',
      parts: [
        {
          text:
            'Davom ettir. AYNAN uzilgan joydan davom et — qaytadan boshlama, takrorlama. ' +
            `Bob tugagach ${DONE_MARK} yoz.`,
        },
      ],
    });
    onProgress(countWords(full), round);
  }

  return { text: full.replace(DONE_MARK, '').trim(), complete: false, rounds: MAX_ROUNDS };
}

/** Bobni yozadi (yoki qayta yozadi) va holatini saqlaydi. */
export async function writeChapter(
  bookId: string,
  chapterId: string,
  options: { extra?: string; append?: boolean } = {},
): Promise<void> {
  const book = getBook(bookId);
  const chapter = book?.chapters.find((c) => c.id === chapterId);
  if (!book || !chapter) return;

  await startTask(
    {
      kind: 'kitob',
      targetId: chapterId,
      title: `${chapter.no}-bob: ${chapter.title}`,
      note: 'boshlandi',
    },
    async (signal, taskId) => {
      patchChapter(bookId, chapterId, { status: 'yozilmoqda', error: undefined });
      try {
        const seed = options.append ? chapter.content : '';
        const result = await runChapter(
          book,
          chapter,
          signal,
          (words, round) =>
            noteTask(taskId, `${words} soʻz${round > 1 ? ` · ${round}-davom` : ''}`),
          options.extra,
          seed,
        );

        patchChapter(bookId, chapterId, {
          content: result.text,
          words: countWords(result.text),
          status: result.complete ? 'tayyor' : 'chala',
          error: result.complete
            ? undefined
            : 'Matn uzilib qoldi — «Davom ettirish» tugmasini bosing',
        });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          patchChapter(bookId, chapterId, {
            status: chapter.content ? 'chala' : 'kutilmoqda',
          });
          return;
        }
        patchChapter(bookId, chapterId, {
          status: 'xato',
          error: String((err as Error)?.message ?? err),
        });
      }
    },
  );
}

/** Barcha yozilmagan boblarni ketma-ket yozadi. */
export async function writeWholeBook(bookId: string): Promise<void> {
  const start = getBook(bookId);
  if (!start) return;

  await startTask(
    { kind: 'kitob', targetId: bookId, title: start.title, note: 'boblar yozilmoqda' },
    async (signal, taskId) => {
      for (const planned of start.chapters) {
        if (signal.aborted) return;
        const fresh = getBook(bookId);
        const chapter = fresh?.chapters.find((c) => c.id === planned.id);
        if (!fresh || !chapter) continue;
        if (chapter.status === 'tayyor') continue;

        noteTask(taskId, `${chapter.no}/${fresh.chapters.length}: ${chapter.title}`);
        patchChapter(bookId, chapter.id, { status: 'yozilmoqda', error: undefined });

        try {
          const result = await runChapter(fresh, chapter, signal, (words, round) =>
            noteTask(
              taskId,
              `${chapter.no}/${fresh.chapters.length} · ${words} soʻz${round > 1 ? ` · ${round}-davom` : ''}`,
            ),
          );
          patchChapter(bookId, chapter.id, {
            content: result.text,
            words: countWords(result.text),
            status: result.complete ? 'tayyor' : 'chala',
            error: result.complete ? undefined : 'Matn uzilib qoldi',
          });
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') {
            patchChapter(bookId, chapter.id, { status: chapter.content ? 'chala' : 'kutilmoqda' });
            return;
          }
          patchChapter(bookId, chapter.id, {
            status: 'xato',
            error: String((err as Error)?.message ?? err),
          });
        }
      }
    },
  );
}

/* ------------------------------------------------------------------ */
/*  Chiqarish                                                          */
/* ------------------------------------------------------------------ */

/** Butun kitobni bitta markdown matnga yigʻadi. */
export function bookMarkdown(book: Book): string {
  const head = `# ${book.title}\n\n`;
  const toc =
    '## Mundarija\n\n' +
    book.chapters.map((c) => `${c.no}. ${c.title}`).join('\n') +
    '\n\n---\n\n';
  const body = book.chapters
    .filter((c) => c.content.trim())
    .map((c) => {
      const text = c.content.trim();
      // Bob sarlavhasi matnda boʻlmasa — qoʻshamiz.
      const hasTitle = new RegExp(`^#{1,3}\\s`).test(text);
      return hasTitle ? text : `## ${c.no}. ${c.title}\n\n${text}`;
    })
    .join('\n\n---\n\n');
  return head + toc + body + '\n';
}

export function bookProgress(book: Book): { done: number; total: number; words: number } {
  return {
    done: book.chapters.filter((c) => c.status === 'tayyor').length,
    total: book.chapters.length,
    words: book.chapters.reduce((sum, c) => sum + c.words, 0),
  };
}

export function renameBook(id: string, title: string): void {
  patchBook(id, { title });
}
